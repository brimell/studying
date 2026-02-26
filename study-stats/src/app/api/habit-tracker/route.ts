import { NextRequest, NextResponse } from "next/server";
import { calendar_v3 } from "googleapis";
import { auth } from "@/lib/auth";
import {
  eventMatchesSubjects,
  fetchEventsFromAllCalendars,
  fetchTrackerCalendars,
  getCalendarClient,
  getLogicalDayBoundaries,
} from "@/lib/calendar";
import { DEFAULT_SUBJECTS } from "@/lib/types";
import type { HabitDay, HabitDefinition } from "@/lib/types";

const HABIT_CONFIG_SUMMARY = "StudyStats Habit Config";
const HABIT_CONFIG_DATE = "2099-01-01";
const MAX_HABITS = 20;

function getEventDuration(event: {
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}): number {
  if (event.start.date && !event.start.dateTime) return 0;
  const start = new Date(event.start.dateTime || event.start.date || "");
  const end = new Date(event.end.dateTime || event.end.date || "");
  return (end.getTime() - start.getTime()) / (1000 * 3600);
}

function hoursToLevel(hours: number): 0 | 1 | 2 | 3 | 4 {
  if (hours <= 0) return 0;
  if (hours < 1) return 1;
  if (hours < 3) return 2;
  if (hours < 5) return 3;
  return 4;
}

function normalizeHabitName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function slugifyHabitName(name: string): string {
  const slug = normalizeHabitName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "habit";
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey: string, amount: number): string {
  const date = parseDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDateKey(date);
}

function getDateTimeMin(dateKey: string): string {
  return `${dateKey}T00:00:00.000Z`;
}

function getDateTimeMaxInclusive(dateKey: string): string {
  return `${addDays(dateKey, 1)}T00:00:00.000Z`;
}

function getEventDateKey(event: calendar_v3.Schema$Event): string | null {
  if (event.start?.date) return event.start.date;
  if (event.start?.dateTime) return event.start.dateTime.slice(0, 10);
  return null;
}

function sanitizeHabitNames(habits: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const rawName of habits) {
    const name = normalizeHabitName(rawName);
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(name);
    if (unique.length >= MAX_HABITS) break;
  }

  return unique;
}

function computeStreaks(days: { completed: boolean }[]): {
  currentStreak: number;
  longestStreak: number;
  totalCompleted: number;
} {
  let currentStreak = 0;
  let longestStreak = 0;
  let runningStreak = 0;
  let totalCompleted = 0;

  for (const day of days) {
    if (day.completed) {
      runningStreak += 1;
      totalCompleted += 1;
      if (runningStreak > longestStreak) longestStreak = runningStreak;
    } else {
      runningStreak = 0;
    }
  }

  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (!days[i].completed) break;
    currentStreak += 1;
  }

  return { currentStreak, longestStreak, totalCompleted };
}

function toErrorResponse(error: unknown, fallback: string): NextResponse {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}

async function ensureAuthenticatedCalendar() {
  const session = await auth();
  if (!session || !(session as { accessToken?: string }).accessToken) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const accessToken = (session as { accessToken: string }).accessToken;
  return { calendar: getCalendarClient(accessToken) };
}

async function resolveWritableTrackerCalendar(
  calendar: calendar_v3.Calendar,
  requestedCalendarId?: string | null
): Promise<string | null> {
  const calendars = await fetchTrackerCalendars(calendar);
  if (calendars.length === 0) return null;

  if (requestedCalendarId) {
    const match = calendars.find((entry) => entry.id === requestedCalendarId);
    if (match) return match.id;
    return null;
  }

  const defaultCalendarId = process.env.HABIT_TRACKER_CALENDAR_ID;
  if (defaultCalendarId && calendars.some((entry) => entry.id === defaultCalendarId)) {
    return defaultCalendarId;
  }

  return calendars[0].id;
}

async function getHabitConfig(
  calendar: calendar_v3.Calendar,
  calendarId: string
): Promise<{ eventId: string | null; habits: string[] }> {
  const response = await calendar.events.list({
    calendarId,
    maxResults: 5,
    singleEvents: false,
    showDeleted: false,
    privateExtendedProperty: ["studyStatsType=habit-config"],
  });

  const event = (response.data.items || []).find((item) => item.status !== "cancelled");
  if (!event) {
    return { eventId: null, habits: [] };
  }

  try {
    const parsed = JSON.parse(event.description || "{}") as {
      habits?: unknown;
    };

    const habits = Array.isArray(parsed.habits)
      ? sanitizeHabitNames(parsed.habits.filter((value): value is string => typeof value === "string"))
      : [];

    return {
      eventId: event.id || null,
      habits,
    };
  } catch {
    return {
      eventId: event.id || null,
      habits: [],
    };
  }
}

async function saveHabitConfig(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  habitNames: string[],
  eventId: string | null
): Promise<void> {
  const nextDay = addDays(HABIT_CONFIG_DATE, 1);
  const requestBody: calendar_v3.Schema$Event = {
    summary: HABIT_CONFIG_SUMMARY,
    description: JSON.stringify({ habits: sanitizeHabitNames(habitNames) }),
    start: { date: HABIT_CONFIG_DATE },
    end: { date: nextDay },
    visibility: "private",
    transparency: "transparent",
    extendedProperties: {
      private: {
        studyStatsType: "habit-config",
      },
    },
  };

  if (eventId) {
    await calendar.events.patch({
      calendarId,
      eventId,
      requestBody,
    });
    return;
  }

  await calendar.events.insert({
    calendarId,
    requestBody,
  });
}

async function listHabitCompletionEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  startDate: string,
  endDate: string,
  habitSlug?: string
): Promise<calendar_v3.Schema$Event[]> {
  const privateExtendedProperty = ["studyStatsType=habit-completion"];
  if (habitSlug) {
    privateExtendedProperty.push(`habitSlug=${habitSlug}`);
  }

  const response = await calendar.events.list({
    calendarId,
    timeMin: getDateTimeMin(startDate),
    timeMax: getDateTimeMaxInclusive(endDate),
    maxResults: 5000,
    singleEvents: true,
    orderBy: "startTime",
    showDeleted: false,
    privateExtendedProperty,
  });

  return response.data.items || [];
}

async function createHabitCompletionEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  habitName: string,
  date: string
): Promise<void> {
  const slug = slugifyHabitName(habitName);
  const existing = await listHabitCompletionEvents(calendar, calendarId, date, date, slug);
  if (existing.length > 0) return;

  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `Habit: ${habitName}`,
      description: "Tracked by Study Stats",
      start: { date },
      end: { date: addDays(date, 1) },
      visibility: "private",
      transparency: "transparent",
      extendedProperties: {
        private: {
          studyStatsType: "habit-completion",
          habitSlug: slug,
          habitName,
        },
      },
    },
  });
}

async function deleteHabitCompletionEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  habitName: string,
  startDate: string,
  endDate: string
): Promise<void> {
  const slug = slugifyHabitName(habitName);
  const events = await listHabitCompletionEvents(calendar, calendarId, startDate, endDate, slug);

  await Promise.all(
    events
      .filter((event) => Boolean(event.id))
      .map((event) =>
        calendar.events.delete({
          calendarId,
          eventId: event.id as string,
        })
      )
  );
}

function buildHabitDefinitions(
  habitNames: string[],
  completionEvents: calendar_v3.Schema$Event[],
  startDate: string,
  endDate: string
): HabitDefinition[] {
  const dateKeys: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    dateKeys.push(date);
  }

  const completionSet = new Set<string>();
  for (const event of completionEvents) {
    const habitSlug = event.extendedProperties?.private?.habitSlug;
    const date = getEventDateKey(event);
    if (!habitSlug || !date) continue;
    completionSet.add(`${habitSlug}|${date}`);
  }

  return habitNames.map((name) => {
    const slug = slugifyHabitName(name);
    const days = dateKeys.map((date) => ({
      date,
      completed: completionSet.has(`${slug}|${date}`),
    }));

    const stats = computeStreaks(days);

    return {
      name,
      slug,
      days,
      currentStreak: stats.currentStreak,
      longestStreak: stats.longestStreak,
      totalCompleted: stats.totalCompleted,
    };
  });
}

function validateDateKey(dateKey: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

export async function GET(req: NextRequest) {
  const authResult = await ensureAuthenticatedCalendar();
  if (authResult.error) return authResult.error;

  const { calendar } = authResult;
  const calendarIds = (process.env.CALENDAR_IDS || "").split(",").filter(Boolean);

  const { searchParams } = new URL(req.url);
  const numWeeks = parseInt(searchParams.get("weeks") || "20", 10);
  const trackerCalendarParam = searchParams.get("trackerCalendarId");
  const numDays = Math.max(1, numWeeks) * 7;

  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - numDays);

  try {
    const allEvents = await fetchEventsFromAllCalendars(
      calendar,
      calendarIds,
      timeMin.toISOString(),
      now.toISOString()
    );

    const dateHoursMap: Record<string, number> = {};

    for (const event of allEvents) {
      if (event.start.date && !event.start.dateTime) continue;
      const summary = event.summary || "";
      if (!eventMatchesSubjects(summary, DEFAULT_SUBJECTS)) continue;

      const duration = getEventDuration(event);
      const eventStart = new Date(event.start.dateTime || "");
      const { start: dayStart } = getLogicalDayBoundaries(eventStart);
      const dateKey = dayStart.toISOString().slice(0, 10);

      dateHoursMap[dateKey] = (dateHoursMap[dateKey] || 0) + duration;
    }

    const days: HabitDay[] = [];
    for (let i = numDays - 1; i >= 0; i -= 1) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().slice(0, 10);
      const hours = Math.round((dateHoursMap[dateKey] || 0) * 100) / 100;
      days.push({ date: dateKey, hours, level: hoursToLevel(hours) });
    }

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    let totalDaysStudied = 0;
    let totalHours = 0;

    for (const day of days) {
      totalHours += day.hours;
      if (day.hours > 0) {
        totalDaysStudied += 1;
        tempStreak += 1;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
    }

    for (let i = days.length - 1; i >= 0; i -= 1) {
      if (days[i].hours <= 0) break;
      currentStreak += 1;
    }

    const startDate = days[0]?.date || formatDateKey(new Date());
    const endDate = days[days.length - 1]?.date || formatDateKey(new Date());

    const trackerCalendarId = await resolveWritableTrackerCalendar(
      calendar,
      trackerCalendarParam
    );

    let habits: HabitDefinition[] = [];
    if (trackerCalendarId) {
      const config = await getHabitConfig(calendar, trackerCalendarId);
      const completionEvents = await listHabitCompletionEvents(
        calendar,
        trackerCalendarId,
        startDate,
        endDate
      );
      habits = buildHabitDefinitions(config.habits, completionEvents, startDate, endDate);
    }

    return NextResponse.json({
      days,
      currentStreak,
      longestStreak,
      totalDaysStudied,
      totalHours: Math.round(totalHours * 100) / 100,
      trackerCalendarId,
      trackerRange: {
        startDate,
        endDate,
      },
      habits,
    });
  } catch (error: unknown) {
    console.error("Error fetching habit tracker data:", error);
    return toErrorResponse(error, "Failed to fetch habit tracker data");
  }
}

export async function POST(req: NextRequest) {
  const authResult = await ensureAuthenticatedCalendar();
  if (authResult.error) return authResult.error;

  const { calendar } = authResult;

  try {
    const body = (await req.json()) as {
      trackerCalendarId?: string;
      habitName?: string;
    };

    const trackerCalendarId = await resolveWritableTrackerCalendar(
      calendar,
      body.trackerCalendarId
    );

    if (!trackerCalendarId) {
      return NextResponse.json(
        { error: "Please select a writable Google Calendar." },
        { status: 400 }
      );
    }

    const habitName = normalizeHabitName(body.habitName || "");
    if (!habitName) {
      return NextResponse.json({ error: "Habit name is required." }, { status: 400 });
    }

    const config = await getHabitConfig(calendar, trackerCalendarId);
    const nextHabits = sanitizeHabitNames([...config.habits, habitName]);

    if (nextHabits.length === config.habits.length) {
      return NextResponse.json({ error: "Habit already exists." }, { status: 400 });
    }

    await saveHabitConfig(calendar, trackerCalendarId, nextHabits, config.eventId);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Error creating habit:", error);
    return toErrorResponse(error, "Failed to create habit");
  }
}

export async function PATCH(req: NextRequest) {
  const authResult = await ensureAuthenticatedCalendar();
  if (authResult.error) return authResult.error;

  const { calendar } = authResult;

  try {
    const body = (await req.json()) as {
      trackerCalendarId?: string;
      habitName?: string;
      date?: string;
      completed?: boolean;
    };

    const trackerCalendarId = await resolveWritableTrackerCalendar(
      calendar,
      body.trackerCalendarId
    );

    if (!trackerCalendarId) {
      return NextResponse.json(
        { error: "Please select a writable Google Calendar." },
        { status: 400 }
      );
    }

    const habitName = normalizeHabitName(body.habitName || "");
    const date = body.date || "";
    const completed = Boolean(body.completed);

    if (!habitName) {
      return NextResponse.json({ error: "Habit name is required." }, { status: 400 });
    }
    if (!validateDateKey(date)) {
      return NextResponse.json({ error: "Date must be in YYYY-MM-DD format." }, { status: 400 });
    }

    const config = await getHabitConfig(calendar, trackerCalendarId);
    if (!config.habits.some((entry) => entry.toLowerCase() === habitName.toLowerCase())) {
      const nextHabits = sanitizeHabitNames([...config.habits, habitName]);
      await saveHabitConfig(calendar, trackerCalendarId, nextHabits, config.eventId);
    }

    if (completed) {
      await createHabitCompletionEvent(calendar, trackerCalendarId, habitName, date);
    } else {
      await deleteHabitCompletionEvents(calendar, trackerCalendarId, habitName, date, date);
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Error toggling habit completion:", error);
    return toErrorResponse(error, "Failed to update habit completion");
  }
}

export async function DELETE(req: NextRequest) {
  const authResult = await ensureAuthenticatedCalendar();
  if (authResult.error) return authResult.error;

  const { calendar } = authResult;

  try {
    const body = (await req.json()) as {
      trackerCalendarId?: string;
      habitName?: string;
    };

    const trackerCalendarId = await resolveWritableTrackerCalendar(
      calendar,
      body.trackerCalendarId
    );

    if (!trackerCalendarId) {
      return NextResponse.json(
        { error: "Please select a writable Google Calendar." },
        { status: 400 }
      );
    }

    const habitName = normalizeHabitName(body.habitName || "");
    if (!habitName) {
      return NextResponse.json({ error: "Habit name is required." }, { status: 400 });
    }

    const config = await getHabitConfig(calendar, trackerCalendarId);
    const nextHabits = config.habits.filter(
      (entry) => entry.toLowerCase() !== habitName.toLowerCase()
    );

    await saveHabitConfig(calendar, trackerCalendarId, nextHabits, config.eventId);
    await deleteHabitCompletionEvents(
      calendar,
      trackerCalendarId,
      habitName,
      "2000-01-01",
      "2100-01-01"
    );

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Error deleting habit:", error);
    return toErrorResponse(error, "Failed to delete habit");
  }
}
