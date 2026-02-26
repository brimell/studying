import { NextRequest, NextResponse } from "next/server";
import { calendar_v3 } from "googleapis";
import { auth } from "@/lib/auth";
import {
  fetchEventsFromAllCalendars,
  fetchHabitSourceCalendars,
  fetchTrackerCalendars,
  getCalendarClient,
  getLogicalDayBoundaries,
} from "@/lib/calendar";
import { DEFAULT_SUBJECTS } from "@/lib/types";
import type { HabitCompletionDay, HabitDay, HabitDefinition, HabitMode } from "@/lib/types";

const HABIT_CONFIG_SUMMARY = "StudyStats Habit Config";
const HABIT_CONFIG_DATE = "2099-01-01";
const MAX_HABITS = 20;
const MAX_HOURS_PER_DAY = 24;
const DEFAULT_STUDY_HABIT_NAME = "Studying";

interface HabitConfigEntry {
  name: string;
  mode: HabitMode;
  sourceCalendarIds: string[];
  matchTerms: string[];
}

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

function normalizeHabitMode(mode: string): HabitMode {
  return mode === "duration" ? "duration" : "binary";
}

function sanitizeHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(Math.min(MAX_HOURS_PER_DAY, hours) * 100) / 100;
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

function sanitizeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawTerm of terms) {
    const term = rawTerm.trim().toLowerCase();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    normalized.push(term);
  }

  return normalized;
}

function sanitizeCalendarIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawId of ids) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

function sanitizeHabitConfigs(habits: HabitConfigEntry[]): HabitConfigEntry[] {
  const unique: HabitConfigEntry[] = [];
  const seen = new Set<string>();

  for (const rawHabit of habits) {
    const name = normalizeHabitName(rawHabit.name);
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const mode = normalizeHabitMode(rawHabit.mode);
    unique.push({
      name,
      mode,
      sourceCalendarIds:
        mode === "duration" ? sanitizeCalendarIds(rawHabit.sourceCalendarIds || []) : [],
      matchTerms: mode === "duration" ? sanitizeTerms(rawHabit.matchTerms || []) : [],
    });

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

function computeTotalHours(days: HabitCompletionDay[]): number {
  return Math.round(days.reduce((acc, day) => acc + day.hours, 0) * 100) / 100;
}

function parseTermsInput(input: string): string[] {
  return sanitizeTerms(
    input
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean)
  );
}

function getDefaultStudyTerms(): string[] {
  return sanitizeTerms(Object.values(DEFAULT_SUBJECTS).flat());
}

function getDefaultSourceCalendarIds(): string[] {
  return sanitizeCalendarIds((process.env.CALENDAR_IDS || "").split(",").filter(Boolean));
}

function getDefaultHabitConfigs(): HabitConfigEntry[] {
  return [
    {
      name: DEFAULT_STUDY_HABIT_NAME,
      mode: "duration",
      sourceCalendarIds: getDefaultSourceCalendarIds(),
      matchTerms: getDefaultStudyTerms(),
    },
  ];
}

function toErrorResponse(error: unknown, fallback: string): NextResponse {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}

async function ensureAuthenticatedCalendar() {
  const session = await auth();
  const accessToken = (session as unknown as { accessToken?: string } | null)?.accessToken;
  if (!accessToken) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
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
): Promise<{ eventId: string | null; habits: HabitConfigEntry[] }> {
  const response = await calendar.events.list({
    calendarId,
    maxResults: 5,
    singleEvents: false,
    showDeleted: false,
    privateExtendedProperty: ["studyStatsType=habit-config"],
  });

  const event = (response.data.items || []).find((item) => item.status !== "cancelled");
  if (!event) {
    return { eventId: null, habits: getDefaultHabitConfigs() };
  }

  try {
    const parsed = JSON.parse(event.description || "{}") as {
      habits?: unknown;
      habitConfigs?: unknown;
    };

    let habits: HabitConfigEntry[] = [];
    if (Array.isArray(parsed.habitConfigs)) {
      habits = sanitizeHabitConfigs(
        parsed.habitConfigs
          .filter(
            (value): value is Partial<HabitConfigEntry> =>
              typeof value === "object" &&
              value !== null &&
              typeof value.name === "string"
          )
          .map((value) => ({
            name: String(value.name || ""),
            mode: normalizeHabitMode(String(value.mode || "binary")),
            sourceCalendarIds: Array.isArray(value.sourceCalendarIds)
              ? value.sourceCalendarIds.filter((id): id is string => typeof id === "string")
              : [],
            matchTerms: Array.isArray(value.matchTerms)
              ? value.matchTerms.filter((term): term is string => typeof term === "string")
              : [],
          }))
      );
    } else if (Array.isArray(parsed.habits)) {
      habits = sanitizeHabitConfigs(
        parsed.habits
          .filter((value): value is string => typeof value === "string")
          .map((name) => ({
            name,
            mode: "binary" as HabitMode,
            sourceCalendarIds: [],
            matchTerms: [],
          }))
      );
    }

    return {
      eventId: event.id || null,
      habits: habits.length > 0 ? habits : getDefaultHabitConfigs(),
    };
  } catch {
    return {
      eventId: event.id || null,
      habits: getDefaultHabitConfigs(),
    };
  }
}

async function saveHabitConfig(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  habitConfigs: HabitConfigEntry[],
  eventId: string | null
): Promise<void> {
  const nextHabits = sanitizeHabitConfigs(habitConfigs);
  const nextDay = addDays(HABIT_CONFIG_DATE, 1);
  const requestBody: calendar_v3.Schema$Event = {
    summary: HABIT_CONFIG_SUMMARY,
    description: JSON.stringify({
      habits: nextHabits.map((habit) => habit.name),
      habitConfigs: nextHabits,
    }),
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

async function upsertHabitCompletionEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  habit: HabitConfigEntry,
  date: string,
  inputHours: number
): Promise<void> {
  const slug = slugifyHabitName(habit.name);
  const existing = await listHabitCompletionEvents(calendar, calendarId, date, date, slug);
  const hours = habit.mode === "duration" ? sanitizeHours(inputHours) : 1;

  if (hours <= 0) {
    await Promise.all(
      existing
        .filter((event) => Boolean(event.id))
        .map((event) =>
          calendar.events.delete({
            calendarId,
            eventId: event.id as string,
          })
        )
    );
    return;
  }

  const requestBody: calendar_v3.Schema$Event = {
    summary:
      habit.mode === "duration"
        ? `Habit: ${habit.name} (${hours.toFixed(1)}h)`
        : `Habit: ${habit.name}`,
    description: "Tracked by Study Stats",
    start: { date },
    end: { date: addDays(date, 1) },
    visibility: "private",
    transparency: "transparent",
    extendedProperties: {
      private: {
        studyStatsType: "habit-completion",
        habitSlug: slug,
        habitName: habit.name,
        habitMode: habit.mode,
        habitHours: String(hours),
      },
    },
  };

  const firstExisting = existing.find((event) => Boolean(event.id));
  if (firstExisting?.id) {
    await calendar.events.patch({
      calendarId,
      eventId: firstExisting.id,
      requestBody,
    });

    const duplicates = existing.filter(
      (event) => Boolean(event.id) && event.id !== firstExisting.id
    );
    await Promise.all(
      duplicates.map((event) =>
        calendar.events.delete({
          calendarId,
          eventId: event.id as string,
        })
      )
    );
    return;
  }

  await calendar.events.insert({
    calendarId,
    requestBody,
  });
}

async function deleteHabitCompletionEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  habitSlug: string,
  startDate: string,
  endDate: string
): Promise<void> {
  const events = await listHabitCompletionEvents(
    calendar,
    calendarId,
    startDate,
    endDate,
    habitSlug
  );

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

async function buildDurationHoursByDate(
  calendar: calendar_v3.Calendar,
  habit: HabitConfigEntry,
  startDate: string,
  timeMaxIso: string
): Promise<Record<string, number>> {
  if (habit.sourceCalendarIds.length === 0) return {};

  const events = await fetchEventsFromAllCalendars(
    calendar,
    habit.sourceCalendarIds,
    getDateTimeMin(startDate),
    timeMaxIso
  );

  const terms = sanitizeTerms(habit.matchTerms);
  const hoursByDate: Record<string, number> = {};

  for (const event of events) {
    if (event.start.date && !event.start.dateTime) continue;
    const summary = (event.summary || "").toLowerCase();
    if (terms.length > 0 && !terms.some((term) => summary.includes(term))) continue;

    const duration = getEventDuration(event);
    if (duration <= 0) continue;

    const eventStart = new Date(event.start.dateTime || "");
    const { start: logicalDayStart } = getLogicalDayBoundaries(eventStart);
    const dateKey = logicalDayStart.toISOString().slice(0, 10);
    hoursByDate[dateKey] = Math.round(((hoursByDate[dateKey] || 0) + duration) * 100) / 100;
  }

  return hoursByDate;
}

function buildHabitDefinitions(
  habits: HabitConfigEntry[],
  completionEvents: calendar_v3.Schema$Event[],
  durationHoursBySlug: Map<string, Record<string, number>>,
  startDate: string,
  endDate: string
): HabitDefinition[] {
  const dateKeys: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    dateKeys.push(date);
  }

  const completionMap = new Map<string, { completed: boolean; hours: number }>();
  for (const event of completionEvents) {
    const habitSlug = event.extendedProperties?.private?.habitSlug;
    const date = getEventDateKey(event);
    if (!habitSlug || !date) continue;

    const key = `${habitSlug}|${date}`;
    const current = completionMap.get(key) || { completed: false, hours: 0 };
    const rawHours = Number(event.extendedProperties?.private?.habitHours || "0");
    const parsedHours = sanitizeHours(rawHours);

    completionMap.set(key, {
      completed: true,
      hours:
        parsedHours > 0 ? Math.round((current.hours + parsedHours) * 100) / 100 : current.hours,
    });
  }

  return habits.map((habit) => {
    const slug = slugifyHabitName(habit.name);
    const durationMap = durationHoursBySlug.get(slug) || {};
    const days: HabitCompletionDay[] = dateKeys.map((date) => {
      if (habit.mode === "duration") {
        const hours = Math.round((durationMap[date] || 0) * 100) / 100;
        return {
          date,
          completed: hours > 0,
          hours,
          level: hoursToLevel(hours),
        };
      }

      const value = completionMap.get(`${slug}|${date}`);
      const completed = Boolean(value?.completed);
      const hours = completed ? 1 : 0;
      return {
        date,
        completed,
        hours,
        level: hoursToLevel(hours),
      };
    });

    const stats = computeStreaks(days);

    return {
      name: habit.name,
      slug,
      mode: habit.mode,
      sourceCalendarIds: habit.sourceCalendarIds,
      matchTerms: habit.matchTerms,
      days,
      currentStreak: stats.currentStreak,
      longestStreak: stats.longestStreak,
      totalCompleted: stats.totalCompleted,
      totalHours: computeTotalHours(days),
    };
  });
}

function validateDateKey(dateKey: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

function deriveStudyMetrics(days: HabitDay[]) {
  let currentStreak = 0;
  let longestStreak = 0;
  let running = 0;
  let totalDaysStudied = 0;
  let totalHours = 0;

  for (const day of days) {
    totalHours += day.hours;
    if (day.hours > 0) {
      totalDaysStudied += 1;
      running += 1;
      if (running > longestStreak) longestStreak = running;
    } else {
      running = 0;
    }
  }

  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i].hours <= 0) break;
    currentStreak += 1;
  }

  return {
    currentStreak,
    longestStreak,
    totalDaysStudied,
    totalHours: Math.round(totalHours * 100) / 100,
  };
}

export async function GET(req: NextRequest) {
  const authResult = await ensureAuthenticatedCalendar();
  if (authResult.error) return authResult.error;

  const { calendar } = authResult;

  const { searchParams } = new URL(req.url);
  const numWeeks = parseInt(searchParams.get("weeks") || "20", 10);
  const trackerCalendarParam = searchParams.get("trackerCalendarId");
  const numDays = Math.max(1, numWeeks) * 7;

  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - numDays);

  const startDate = timeMin.toISOString().slice(0, 10);
  const endDate = now.toISOString().slice(0, 10);

  try {
    const trackerCalendarId = await resolveWritableTrackerCalendar(
      calendar,
      trackerCalendarParam
    );

    if (!trackerCalendarId) {
      return NextResponse.json({
        days: [],
        currentStreak: 0,
        longestStreak: 0,
        totalDaysStudied: 0,
        totalHours: 0,
        trackerCalendarId: null,
        trackerRange: {
          startDate,
          endDate,
        },
        habits: [],
      });
    }

    const config = await getHabitConfig(calendar, trackerCalendarId);
    const completionEvents = await listHabitCompletionEvents(
      calendar,
      trackerCalendarId,
      startDate,
      endDate
    );

    const durationHabits = config.habits.filter((habit) => habit.mode === "duration");
    const durationMaps = await Promise.all(
      durationHabits.map(async (habit) => {
        const hoursByDate = await buildDurationHoursByDate(
          calendar,
          habit,
          startDate,
          now.toISOString()
        );
        return [slugifyHabitName(habit.name), hoursByDate] as const;
      })
    );

    const durationHoursBySlug = new Map<string, Record<string, number>>(durationMaps);
    const habits = buildHabitDefinitions(
      config.habits,
      completionEvents,
      durationHoursBySlug,
      startDate,
      endDate
    );

    const studyHabit =
      habits.find((habit) => habit.name.toLowerCase() === DEFAULT_STUDY_HABIT_NAME.toLowerCase()) ||
      habits.find((habit) => habit.mode === "duration") ||
      null;

    const days: HabitDay[] = (studyHabit?.days || []).map((day) => ({
      date: day.date,
      hours: day.hours,
      level: day.level,
    }));

    const metrics = deriveStudyMetrics(days);

    return NextResponse.json({
      days,
      currentStreak: metrics.currentStreak,
      longestStreak: metrics.longestStreak,
      totalDaysStudied: metrics.totalDaysStudied,
      totalHours: metrics.totalHours,
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
      habitMode?: HabitMode;
      sourceCalendarIds?: string[];
      matchTerms?: string | string[];
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
    const habitMode = normalizeHabitMode(body.habitMode || "binary");
    if (!habitName) {
      return NextResponse.json({ error: "Habit name is required." }, { status: 400 });
    }

    const sourceCalendarIds = sanitizeCalendarIds(body.sourceCalendarIds || []);
    const matchTerms = Array.isArray(body.matchTerms)
      ? sanitizeTerms(body.matchTerms)
      : typeof body.matchTerms === "string"
        ? parseTermsInput(body.matchTerms)
        : [];

    if (habitMode === "duration" && sourceCalendarIds.length === 0) {
      return NextResponse.json(
        { error: "Select at least one calendar for time tracking habits." },
        { status: 400 }
      );
    }

    const config = await getHabitConfig(calendar, trackerCalendarId);
    const nextHabits = sanitizeHabitConfigs([
      ...config.habits,
      {
        name: habitName,
        mode: habitMode,
        sourceCalendarIds,
        matchTerms,
      },
    ]);

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

export async function PUT(req: NextRequest) {
  const authResult = await ensureAuthenticatedCalendar();
  if (authResult.error) return authResult.error;

  const { calendar } = authResult;

  try {
    const body = (await req.json()) as {
      trackerCalendarId?: string;
      habitName?: string;
      habitMode?: HabitMode;
      sourceCalendarIds?: string[];
      matchTerms?: string | string[];
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

    const sourceCalendarIds = sanitizeCalendarIds(body.sourceCalendarIds || []);
    const matchTerms = Array.isArray(body.matchTerms)
      ? sanitizeTerms(body.matchTerms)
      : typeof body.matchTerms === "string"
        ? parseTermsInput(body.matchTerms)
        : [];

    const config = await getHabitConfig(calendar, trackerCalendarId);
    let found = false;
    const nextHabits = config.habits.map((habit) => {
      if (habit.name.toLowerCase() !== habitName.toLowerCase()) return habit;
      found = true;
      const mode = body.habitMode ? normalizeHabitMode(body.habitMode) : habit.mode;
      return {
        ...habit,
        mode,
        sourceCalendarIds: mode === "duration" ? sourceCalendarIds : [],
        matchTerms: mode === "duration" ? matchTerms : [],
      };
    });

    if (!found) {
      return NextResponse.json({ error: "Habit not found." }, { status: 404 });
    }

    const updatedHabit = nextHabits.find(
      (habit) => habit.name.toLowerCase() === habitName.toLowerCase()
    );
    if (updatedHabit?.mode === "duration" && updatedHabit.sourceCalendarIds.length === 0) {
      return NextResponse.json(
        { error: "Select at least one calendar for time tracking habits." },
        { status: 400 }
      );
    }

    await saveHabitConfig(calendar, trackerCalendarId, nextHabits, config.eventId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Error updating habit config:", error);
    return toErrorResponse(error, "Failed to update habit config");
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
      habitMode?: HabitMode;
      date?: string;
      completed?: boolean;
      hours?: number;
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
    const requestedMode = normalizeHabitMode(body.habitMode || "binary");

    if (!habitName) {
      return NextResponse.json({ error: "Habit name is required." }, { status: 400 });
    }
    if (!validateDateKey(date)) {
      return NextResponse.json({ error: "Date must be in YYYY-MM-DD format." }, { status: 400 });
    }

    const config = await getHabitConfig(calendar, trackerCalendarId);
    let habit = config.habits.find(
      (entry) => entry.name.toLowerCase() === habitName.toLowerCase()
    );

    if (!habit) {
      const nextHabits = sanitizeHabitConfigs([
        ...config.habits,
        {
          name: habitName,
          mode: requestedMode,
          sourceCalendarIds: [],
          matchTerms: [],
        },
      ]);
      await saveHabitConfig(calendar, trackerCalendarId, nextHabits, config.eventId);
      habit = nextHabits.find((entry) => entry.name.toLowerCase() === habitName.toLowerCase());
    }

    if (!habit) {
      return NextResponse.json({ error: "Habit not found." }, { status: 400 });
    }

    if (habit.mode === "duration") {
      return NextResponse.json(
        { error: "Time tracking habits are auto-calculated from calendar scans." },
        { status: 400 }
      );
    }

    const completed = Boolean(body.completed);
    await upsertHabitCompletionEvent(calendar, trackerCalendarId, habit, date, completed ? 1 : 0);
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
      (entry) => entry.name.toLowerCase() !== habitName.toLowerCase()
    );

    await saveHabitConfig(calendar, trackerCalendarId, nextHabits, config.eventId);
    await deleteHabitCompletionEvents(
      calendar,
      trackerCalendarId,
      slugifyHabitName(habitName),
      "2000-01-01",
      "2100-01-01"
    );

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Error deleting habit:", error);
    return toErrorResponse(error, "Failed to delete habit");
  }
}
