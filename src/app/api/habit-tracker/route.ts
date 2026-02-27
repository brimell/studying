import { NextRequest } from "next/server";
import { calendar_v3 } from "googleapis";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  ApiRouteError,
  apiJson,
  apiLog,
  assertRateLimit,
  checkIdempotencyReplay,
  clientAddress,
  createApiRequestContext,
  handleApiError,
  idempotencyFingerprint,
  parseJsonBody,
  parseQuery,
  storeIdempotencyResult,
} from "@/lib/api-runtime";
import {
  fetchEvents,
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
const DEFAULT_GYM_HABIT_NAME = "Gym";
const PRIVATE_CACHE_CONTROL = "private, max-age=20, stale-while-revalidate=60";

interface HabitConfigEntry {
  name: string;
  mode: HabitMode;
  trackingCalendarId: string | null;
  sourceCalendarIds: string[];
  matchTerms: string[];
}

const habitQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(104).default(20),
  trackerCalendarId: z.string().trim().min(1).optional(),
});

const habitModeSchema = z.enum(["binary", "duration"]);
const trackerCalendarIdSchema = z.string().trim().min(1).optional();
const calendarIdsSchema = z.array(z.string().trim().min(1)).optional();
const matchTermsSchema = z.union([z.string(), z.array(z.string().trim().min(1))]).optional();

const habitPostBodySchema = z.object({
  trackerCalendarId: trackerCalendarIdSchema,
  habitName: z.string().trim().min(1),
  habitMode: habitModeSchema.optional(),
  trackingCalendarId: trackerCalendarIdSchema,
  sourceCalendarIds: calendarIdsSchema,
  matchTerms: matchTermsSchema,
});

const habitPutBodySchema = z.object({
  trackerCalendarId: trackerCalendarIdSchema,
  habitName: z.string().trim().min(1),
  habitMode: habitModeSchema.optional(),
  trackingCalendarId: trackerCalendarIdSchema,
  sourceCalendarIds: calendarIdsSchema,
  matchTerms: matchTermsSchema,
});

const habitPatchBodySchema = z.object({
  trackerCalendarId: trackerCalendarIdSchema,
  habitName: z.string().trim().min(1),
  habitMode: habitModeSchema.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completed: z.boolean().optional(),
  hours: z.number().optional(),
});

const habitDeleteBodySchema = z.object({
  trackerCalendarId: trackerCalendarIdSchema,
  habitName: z.string().trim().min(1),
});

function getEventDuration(event: {
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
}): number {
  if (!event.start || !event.end) return 0;
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

function sanitizeMatchEntries(entries: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  return unique;
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
      trackingCalendarId:
        mode === "binary" ? rawHabit.trackingCalendarId?.trim() || null : null,
      sourceCalendarIds:
        mode === "duration" ? sanitizeCalendarIds(rawHabit.sourceCalendarIds || []) : [],
      matchTerms: mode === "duration" ? sanitizeMatchEntries(rawHabit.matchTerms || []) : [],
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
  const segments = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (segments.length === 0) return [];

  const collected: string[] = [];
  let lastSubjectIndex = -1;
  for (const segment of segments) {
    const separatorIndex = segment.indexOf(":");
    if (separatorIndex >= 0) {
      const subject = segment.slice(0, separatorIndex).trim();
      const rawTerms = segment.slice(separatorIndex + 1);
      const terms = rawTerms
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean);
      if (subject && terms.length > 0) {
        collected.push(`${subject}: ${terms.join(", ")}`);
        lastSubjectIndex = collected.length - 1;
      } else if (subject) {
        collected.push(subject);
        lastSubjectIndex = collected.length - 1;
      } else if (terms.length > 0) {
        collected.push(terms.join(", "));
      }
      continue;
    }

    if (lastSubjectIndex >= 0) {
      const previous = collected[lastSubjectIndex] || "";
      const prevSep = previous.indexOf(":");
      if (prevSep >= 0) {
        const prevSubject = previous.slice(0, prevSep).trim();
        const prevTerms = previous.slice(prevSep + 1).trim();
        const mergedTerms = [prevTerms, segment].filter(Boolean).join(", ");
        collected[lastSubjectIndex] = `${prevSubject}: ${mergedTerms}`;
        continue;
      }
    }

    collected.push(segment);
  }

  return sanitizeMatchEntries(collected);
}

function getDefaultStudyMatchEntries(): string[] {
  return Object.entries(DEFAULT_SUBJECTS).map(
    ([subject, terms]) => `${subject}: ${terms.join(", ")}`
  );
}

function extractSearchTermsFromMatchEntries(matchEntries: string[]): string[] {
  const expanded: string[] = [];
  for (const entry of matchEntries) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex >= 0) {
      const subject = entry.slice(0, separatorIndex).trim();
      const terms = entry
        .slice(separatorIndex + 1)
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean);
      if (subject) expanded.push(subject);
      expanded.push(...terms);
      continue;
    }
    entry
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean)
      .forEach((term) => expanded.push(term));
  }
  return sanitizeTerms(expanded);
}

function getDefaultSourceCalendarIds(): string[] {
  return sanitizeCalendarIds((process.env.CALENDAR_IDS || "").split(",").filter(Boolean));
}

function getDefaultHabitConfigs(): HabitConfigEntry[] {
  return [
    {
      name: DEFAULT_STUDY_HABIT_NAME,
      mode: "duration",
      trackingCalendarId: null,
      sourceCalendarIds: getDefaultSourceCalendarIds(),
      matchTerms: getDefaultStudyMatchEntries(),
    },
    {
      name: DEFAULT_GYM_HABIT_NAME,
      mode: "binary",
      trackingCalendarId: null,
      sourceCalendarIds: [],
      matchTerms: [],
    },
  ];
}

function normalizeUnhandledError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string
): ApiRouteError {
  if (error instanceof ApiRouteError) {
    return error;
  }

  const anyError = error as {
    code?: number;
    response?: { status?: number };
    message?: string;
  };
  const status = anyError?.code || anyError?.response?.status;
  const messageLower = (anyError?.message || "").toLowerCase();
  const isAuthError =
    status === 401 ||
    messageLower.includes("invalid authentication credentials") ||
    messageLower.includes("invalid credentials") ||
    messageLower.includes("login required");
  if (isAuthError) {
    return new ApiRouteError(
      401,
      "GOOGLE_SESSION_EXPIRED",
      "auth",
      "Google session expired. Sign out and sign in with Google again."
    );
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  return new ApiRouteError(500, fallbackCode, "internal", message);
}

async function ensureAuthenticatedCalendar(): Promise<{
  calendar: calendar_v3.Calendar;
  principal: string;
}> {
  const session = await auth();
  const typedSession = session as
    | { accessToken?: string; user?: { email?: string | null } | null }
    | null;
  const accessToken = typedSession?.accessToken;
  if (!accessToken) {
    throw new ApiRouteError(401, "UNAUTHORIZED", "auth", "Unauthorized");
  }

  return {
    calendar: getCalendarClient(accessToken),
    principal: typedSession?.user?.email?.trim().toLowerCase() || "anonymous",
  };
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
    // If a previously-selected calendar is no longer writable/available,
    // fall back to a valid writable calendar instead of returning empty data.
    const defaultCalendarId = process.env.HABIT_TRACKER_CALENDAR_ID;
    if (defaultCalendarId && calendars.some((entry) => entry.id === defaultCalendarId)) {
      return defaultCalendarId;
    }
    return calendars[0].id;
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
            trackingCalendarId:
              typeof value.trackingCalendarId === "string"
                ? value.trackingCalendarId
                : null,
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
            trackingCalendarId: null,
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

function buildDurationHoursByDateFromEvents(
  events: calendar_v3.Schema$Event[],
  terms: string[]
): Record<string, number> {
  const hoursByDate: Record<string, number> = {};

  for (const event of events) {
    if (!event.start || !event.end) continue;
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

async function fetchDurationEventsByCalendarId(
  calendar: calendar_v3.Calendar,
  calendarIds: string[],
  startDate: string,
  timeMaxIso: string
): Promise<Map<string, calendar_v3.Schema$Event[]>> {
  const uniqueCalendarIds = sanitizeCalendarIds(calendarIds);
  const byCalendarId = new Map<string, calendar_v3.Schema$Event[]>();
  if (uniqueCalendarIds.length === 0) return byCalendarId;

  const concurrency = Math.max(1, Math.min(6, uniqueCalendarIds.length));
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < uniqueCalendarIds.length) {
      const index = nextIndex;
      nextIndex += 1;
      const calendarId = uniqueCalendarIds[index];
      const events = await fetchEvents(
        calendar,
        calendarId,
        getDateTimeMin(startDate),
        timeMaxIso
      );
      byCalendarId.set(calendarId, events as calendar_v3.Schema$Event[]);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return byCalendarId;
}

async function listBinaryCompletionEventsByHabit(
  calendar: calendar_v3.Calendar,
  habits: HabitConfigEntry[],
  fallbackCalendarId: string,
  startDate: string,
  endDate: string
): Promise<calendar_v3.Schema$Event[]> {
  const calendarIds = sanitizeCalendarIds(
    habits
      .filter((habit) => habit.mode === "binary")
      .map((habit) => habit.trackingCalendarId || fallbackCalendarId)
  );

  const results = await Promise.all(
    calendarIds.map((calendarId) =>
      listHabitCompletionEvents(calendar, calendarId, startDate, endDate)
    )
  );

  return results.flat();
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
      trackingCalendarId: habit.trackingCalendarId,
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
  const context = createApiRequestContext(req, "/api/habit-tracker");

  try {
    const { calendar } = await ensureAuthenticatedCalendar();
    const query = parseQuery(req, habitQuerySchema);
    const numDays = query.weeks * 7;

    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setDate(timeMin.getDate() - numDays);

    const startDate = timeMin.toISOString().slice(0, 10);
    const endDate = now.toISOString().slice(0, 10);

    const trackerCalendarId = await resolveWritableTrackerCalendar(
      calendar,
      query.trackerCalendarId || null
    );

    if (!trackerCalendarId) {
      return apiJson(
        {
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
        },
        context,
        {
          headers: {
            "Cache-Control": PRIVATE_CACHE_CONTROL,
          },
        }
      );
    }

    const config = await getHabitConfig(calendar, trackerCalendarId);
    const completionEvents = await listBinaryCompletionEventsByHabit(
      calendar,
      config.habits,
      trackerCalendarId,
      startDate,
      endDate
    );

    const durationHabits = config.habits.filter((habit) => habit.mode === "duration");
    const durationEventsByCalendarId = await fetchDurationEventsByCalendarId(
      calendar,
      durationHabits.flatMap((habit) => habit.sourceCalendarIds),
      startDate,
      now.toISOString()
    );

    const durationMaps = durationHabits.map((habit) => {
      const terms = extractSearchTermsFromMatchEntries(habit.matchTerms);
      const events = habit.sourceCalendarIds.flatMap(
        (calendarId) => durationEventsByCalendarId.get(calendarId) || []
      );
      const hoursByDate = buildDurationHoursByDateFromEvents(events, terms);
      return [slugifyHabitName(habit.name), hoursByDate] as const;
    });

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

    return apiJson(
      {
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
      },
      context,
      {
        headers: {
          "Cache-Control": PRIVATE_CACHE_CONTROL,
        },
      }
    );
  } catch (error: unknown) {
    return handleApiError(
      normalizeUnhandledError(
        error,
        "HABIT_TRACKER_GET_FAILED",
        "Failed to fetch habit tracker data."
      ),
      context,
      "Failed to fetch habit tracker data."
    );
  }
}

export async function POST(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/habit-tracker");

  try {
    const { calendar, principal } = await ensureAuthenticatedCalendar();
    assertRateLimit({
      key: `habit-tracker:post:${principal}:${clientAddress(req)}`,
      limit: 30,
      windowMs: 60_000,
    });
    const body = await parseJsonBody(req, habitPostBodySchema);
    const idempotencyKey = req.headers.get("idempotency-key");
    const fingerprint = idempotencyFingerprint(body);
    const replay = checkIdempotencyReplay(
      `habit-tracker:post:${principal}`,
      idempotencyKey,
      fingerprint
    );
    if (replay) {
      replay.headers.set("x-request-id", context.requestId);
      return replay;
    }

    const trackerCalendarId = await resolveWritableTrackerCalendar(
      calendar,
      body.trackerCalendarId || null
    );

    if (!trackerCalendarId) {
      throw new ApiRouteError(
        400,
        "NO_WRITABLE_CALENDAR",
        "validation",
        "Please select a writable Google Calendar."
      );
    }

    const habitName = normalizeHabitName(body.habitName || "");
    const habitMode = normalizeHabitMode(body.habitMode || "binary");
    if (!habitName) {
      throw new ApiRouteError(400, "HABIT_NAME_REQUIRED", "validation", "Habit name is required.");
    }

    const sourceCalendarIds = sanitizeCalendarIds(body.sourceCalendarIds || []);
    const trackingCalendarId =
      habitMode === "binary"
        ? ((body.trackingCalendarId || "").trim() || trackerCalendarId)
        : null;
    let matchTerms = Array.isArray(body.matchTerms)
      ? sanitizeMatchEntries(body.matchTerms)
      : typeof body.matchTerms === "string"
        ? parseTermsInput(body.matchTerms)
        : [];
    if (
      habitMode === "duration" &&
      habitName.toLowerCase() === DEFAULT_STUDY_HABIT_NAME.toLowerCase() &&
      matchTerms.length === 0
    ) {
      matchTerms = getDefaultStudyMatchEntries();
    }

    if (habitMode === "duration" && sourceCalendarIds.length === 0) {
      throw new ApiRouteError(
        400,
        "SOURCE_CALENDARS_REQUIRED",
        "validation",
        "Select at least one calendar for time tracking habits."
      );
    }

    const config = await getHabitConfig(calendar, trackerCalendarId);
    const nextHabits = sanitizeHabitConfigs([
      ...config.habits,
      {
        name: habitName,
        mode: habitMode,
        trackingCalendarId,
        sourceCalendarIds,
        matchTerms,
      },
    ]);

    if (nextHabits.length === config.habits.length) {
      throw new ApiRouteError(409, "HABIT_EXISTS", "conflict", "Habit already exists.");
    }

    await saveHabitConfig(calendar, trackerCalendarId, nextHabits, config.eventId);
    const responseBody = { ok: true };
    storeIdempotencyResult({
      scope: `habit-tracker:post:${principal}`,
      idempotencyKey,
      fingerprint,
      status: 200,
      body: responseBody,
    });
    apiLog("info", context, "habit_created", {
      principal,
      trackerCalendarId,
      habitName,
      habitMode,
    });
    return apiJson(responseBody, context);
  } catch (error: unknown) {
    return handleApiError(
      normalizeUnhandledError(error, "HABIT_TRACKER_POST_FAILED", "Failed to create habit."),
      context,
      "Failed to create habit."
    );
  }
}

export async function PUT(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/habit-tracker");

  try {
    const { calendar, principal } = await ensureAuthenticatedCalendar();
    assertRateLimit({
      key: `habit-tracker:put:${principal}:${clientAddress(req)}`,
      limit: 30,
      windowMs: 60_000,
    });
    const body = await parseJsonBody(req, habitPutBodySchema);
    const idempotencyKey = req.headers.get("idempotency-key");
    const fingerprint = idempotencyFingerprint(body);
    const replay = checkIdempotencyReplay(
      `habit-tracker:put:${principal}`,
      idempotencyKey,
      fingerprint
    );
    if (replay) {
      replay.headers.set("x-request-id", context.requestId);
      return replay;
    }

    const trackerCalendarId = await resolveWritableTrackerCalendar(
      calendar,
      body.trackerCalendarId || null
    );

    if (!trackerCalendarId) {
      throw new ApiRouteError(
        400,
        "NO_WRITABLE_CALENDAR",
        "validation",
        "Please select a writable Google Calendar."
      );
    }

    const habitName = normalizeHabitName(body.habitName || "");
    if (!habitName) {
      throw new ApiRouteError(400, "HABIT_NAME_REQUIRED", "validation", "Habit name is required.");
    }

    const sourceCalendarIds = sanitizeCalendarIds(body.sourceCalendarIds || []);
    const requestedTrackingCalendarId = (body.trackingCalendarId || "").trim();
    const matchTerms = Array.isArray(body.matchTerms)
      ? sanitizeMatchEntries(body.matchTerms)
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
        trackingCalendarId:
          mode === "binary"
            ? requestedTrackingCalendarId || habit.trackingCalendarId || trackerCalendarId
            : null,
        sourceCalendarIds: mode === "duration" ? sourceCalendarIds : [],
        matchTerms: mode === "duration" ? matchTerms : [],
      };
    });

    if (!found) {
      throw new ApiRouteError(404, "HABIT_NOT_FOUND", "validation", "Habit not found.");
    }

    const updatedHabit = nextHabits.find(
      (habit) => habit.name.toLowerCase() === habitName.toLowerCase()
    );
    if (updatedHabit?.mode === "duration" && updatedHabit.sourceCalendarIds.length === 0) {
      throw new ApiRouteError(
        400,
        "SOURCE_CALENDARS_REQUIRED",
        "validation",
        "Select at least one calendar for time tracking habits."
      );
    }

    await saveHabitConfig(calendar, trackerCalendarId, nextHabits, config.eventId);
    const responseBody = { ok: true };
    storeIdempotencyResult({
      scope: `habit-tracker:put:${principal}`,
      idempotencyKey,
      fingerprint,
      status: 200,
      body: responseBody,
    });
    apiLog("info", context, "habit_updated", {
      principal,
      trackerCalendarId,
      habitName,
    });
    return apiJson(responseBody, context);
  } catch (error: unknown) {
    return handleApiError(
      normalizeUnhandledError(
        error,
        "HABIT_TRACKER_PUT_FAILED",
        "Failed to update habit config."
      ),
      context,
      "Failed to update habit config."
    );
  }
}

export async function PATCH(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/habit-tracker");

  try {
    const { calendar, principal } = await ensureAuthenticatedCalendar();
    assertRateLimit({
      key: `habit-tracker:patch:${principal}:${clientAddress(req)}`,
      limit: 90,
      windowMs: 60_000,
    });
    const body = await parseJsonBody(req, habitPatchBodySchema);
    const idempotencyKey = req.headers.get("idempotency-key");
    const fingerprint = idempotencyFingerprint(body);
    const replay = checkIdempotencyReplay(
      `habit-tracker:patch:${principal}`,
      idempotencyKey,
      fingerprint
    );
    if (replay) {
      replay.headers.set("x-request-id", context.requestId);
      return replay;
    }

    const trackerCalendarId = await resolveWritableTrackerCalendar(
      calendar,
      body.trackerCalendarId || null
    );

    if (!trackerCalendarId) {
      throw new ApiRouteError(
        400,
        "NO_WRITABLE_CALENDAR",
        "validation",
        "Please select a writable Google Calendar."
      );
    }

    const habitName = normalizeHabitName(body.habitName || "");
    const date = body.date;
    const requestedMode = normalizeHabitMode(body.habitMode || "binary");

    if (!habitName) {
      throw new ApiRouteError(400, "HABIT_NAME_REQUIRED", "validation", "Habit name is required.");
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
          trackingCalendarId: trackerCalendarId,
          sourceCalendarIds: [],
          matchTerms: [],
        },
      ]);
      await saveHabitConfig(calendar, trackerCalendarId, nextHabits, config.eventId);
      habit = nextHabits.find((entry) => entry.name.toLowerCase() === habitName.toLowerCase());
    }

    if (!habit) {
      throw new ApiRouteError(404, "HABIT_NOT_FOUND", "validation", "Habit not found.");
    }

    if (habit.mode === "duration") {
      throw new ApiRouteError(
        400,
        "DURATION_HABIT_READ_ONLY",
        "validation",
        "Time tracking habits are auto-calculated from calendar scans."
      );
    }

    const completed = Boolean(body.completed);
    const binaryCalendarId = habit.trackingCalendarId || trackerCalendarId;
    await upsertHabitCompletionEvent(calendar, binaryCalendarId, habit, date, completed ? 1 : 0);
    const responseBody = { ok: true };
    storeIdempotencyResult({
      scope: `habit-tracker:patch:${principal}`,
      idempotencyKey,
      fingerprint,
      status: 200,
      body: responseBody,
    });
    apiLog("info", context, "habit_completion_updated", {
      principal,
      trackerCalendarId: binaryCalendarId,
      habitName,
      date,
      completed,
    });
    return apiJson(responseBody, context);
  } catch (error: unknown) {
    return handleApiError(
      normalizeUnhandledError(
        error,
        "HABIT_TRACKER_PATCH_FAILED",
        "Failed to update habit completion."
      ),
      context,
      "Failed to update habit completion."
    );
  }
}

export async function DELETE(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/habit-tracker");

  try {
    const { calendar, principal } = await ensureAuthenticatedCalendar();
    assertRateLimit({
      key: `habit-tracker:delete:${principal}:${clientAddress(req)}`,
      limit: 20,
      windowMs: 60_000,
    });
    const body = await parseJsonBody(req, habitDeleteBodySchema);
    const idempotencyKey = req.headers.get("idempotency-key");
    const fingerprint = idempotencyFingerprint(body);
    const replay = checkIdempotencyReplay(
      `habit-tracker:delete:${principal}`,
      idempotencyKey,
      fingerprint
    );
    if (replay) {
      replay.headers.set("x-request-id", context.requestId);
      return replay;
    }

    const trackerCalendarId = await resolveWritableTrackerCalendar(
      calendar,
      body.trackerCalendarId || null
    );

    if (!trackerCalendarId) {
      throw new ApiRouteError(
        400,
        "NO_WRITABLE_CALENDAR",
        "validation",
        "Please select a writable Google Calendar."
      );
    }

    const habitName = normalizeHabitName(body.habitName || "");
    if (!habitName) {
      throw new ApiRouteError(400, "HABIT_NAME_REQUIRED", "validation", "Habit name is required.");
    }

    const config = await getHabitConfig(calendar, trackerCalendarId);
    const targetHabit = config.habits.find(
      (entry) => entry.name.toLowerCase() === habitName.toLowerCase()
    );
    const nextHabits = config.habits.filter(
      (entry) => entry.name.toLowerCase() !== habitName.toLowerCase()
    );

    await saveHabitConfig(calendar, trackerCalendarId, nextHabits, config.eventId);
    const deleteCalendarIds = sanitizeCalendarIds(
      targetHabit?.mode === "binary"
        ? [trackerCalendarId, targetHabit.trackingCalendarId || ""]
        : [trackerCalendarId]
    );

    await Promise.all(
      deleteCalendarIds.map((calendarId) =>
        deleteHabitCompletionEvents(
          calendar,
          calendarId,
          slugifyHabitName(habitName),
          "2000-01-01",
          "2100-01-01"
        )
      )
    );

    const responseBody = { ok: true };
    storeIdempotencyResult({
      scope: `habit-tracker:delete:${principal}`,
      idempotencyKey,
      fingerprint,
      status: 200,
      body: responseBody,
    });
    apiLog("info", context, "habit_deleted", {
      principal,
      trackerCalendarId,
      habitName,
    });
    return apiJson(responseBody, context);
  } catch (error: unknown) {
    return handleApiError(
      normalizeUnhandledError(error, "HABIT_TRACKER_DELETE_FAILED", "Failed to delete habit."),
      context,
      "Failed to delete habit."
    );
  }
}
