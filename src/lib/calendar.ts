import { google, calendar_v3 } from "googleapis";
import type { CalendarEvent, SubjectConfig, TrackerCalendarOption } from "./types";

// ─── Logical Day Boundaries ──────────────────────────────

const DAY_START_HOUR = 3;

interface DayBoundaries {
  start: Date;
  end: Date;
}

export function getLogicalDayBoundaries(date: Date): DayBoundaries {
  const d = new Date(date);
  // If before DAY_START_HOUR, logical day = previous calendar day
  if (d.getHours() < DAY_START_HOUR) {
    d.setDate(d.getDate() - 1);
  }
  const start = new Date(d);
  start.setHours(DAY_START_HOUR, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(end.getMilliseconds() - 1);

  return { start, end };
}

// ─── Google Calendar Client ──────────────────────────────

export function getCalendarClient(accessToken: string): calendar_v3.Calendar {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

// ─── Fetch Events ────────────────────────────────────────

export async function fetchEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  timeMin: string,
  timeMax: string,
  options?: {
    pageSize?: number;
    maxEvents?: number;
  }
): Promise<CalendarEvent[]> {
  const pageSize = Math.max(50, Math.min(1000, options?.pageSize || 500));
  const maxEvents = Math.max(pageSize, options?.maxEvents || 5000);
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  while (events.length < maxEvents) {
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      maxResults: Math.min(pageSize, maxEvents - events.length),
      pageToken,
      singleEvents: true,
      orderBy: "startTime",
    });

    events.push(...((res.data.items || []) as CalendarEvent[]));
    pageToken = res.data.nextPageToken || undefined;
    if (!pageToken) break;
  }

  return events;
}

export async function fetchEventsFromAllCalendars(
  calendar: calendar_v3.Calendar,
  calendarIds: string[],
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const uniqueCalendarIds = [...new Set(calendarIds.filter(Boolean))];
  if (uniqueCalendarIds.length === 0) return [];

  const concurrency = Math.max(1, Math.min(6, uniqueCalendarIds.length));
  const allEvents: CalendarEvent[] = [];
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < uniqueCalendarIds.length) {
      const index = nextIndex;
      nextIndex += 1;
      const events = await fetchEvents(calendar, uniqueCalendarIds[index], timeMin, timeMax);
      allEvents.push(...events);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return allEvents;
}

function mergeOverlappingIntervals(intervals: Array<[Date, Date]>): Array<[Date, Date]> {
  if (intervals.length <= 1) return intervals;

  const sorted = [...intervals].sort((left, right) => left[0].getTime() - right[0].getTime());
  const merged: Array<[Date, Date]> = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const [start, end] = sorted[i];
    const previous = merged[merged.length - 1];
    if (start.getTime() <= previous[1].getTime()) {
      previous[1] = new Date(Math.max(previous[1].getTime(), end.getTime()));
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}

function eventLogicalDateKey(event: CalendarEvent): string | null {
  if (event.start.date && !event.start.dateTime) return event.start.date;
  if (!event.start.dateTime) return null;
  const { start } = getLogicalDayBoundaries(new Date(event.start.dateTime));
  return start.toISOString().slice(0, 10);
}

// ─── Event Matching ──────────────────────────────────────

export function eventMatchesSubjects(
  summary: string,
  subjects: SubjectConfig
): boolean {
  const lower = summary.toLowerCase();
  return Object.values(subjects).some((terms) =>
    terms.some((term) => lower.includes(term.toLowerCase()))
  );
}

export function eventMatchesSubject(
  summary: string,
  terms: string[]
): boolean {
  const lower = summary.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

// ─── Event Duration ──────────────────────────────────────

function getEventDuration(event: CalendarEvent): number {
  if (event.start.date && !event.start.dateTime) return 0; // all-day event
  const start = new Date(event.start.dateTime || event.start.date!);
  const end = new Date(event.end.dateTime || event.end.date!);
  return (end.getTime() - start.getTime()) / (1000 * 3600);
}

function getCompletedEventDuration(event: CalendarEvent, now: Date): number {
  if (event.start.date && !event.start.dateTime) return 0;
  const start = new Date(event.start.dateTime || event.start.date!);
  const end = new Date(event.end.dateTime || event.end.date!);
  if (start > now) return 0;
  const effectiveEnd = end < now ? end : now;
  return (effectiveEnd.getTime() - start.getTime()) / (1000 * 3600);
}

// ─── Today's Progress ────────────────────────────────────

export async function calculateTodayProgress(
  calendar: calendar_v3.Calendar,
  calendarIds: string[],
  subjects: SubjectConfig
) {
  const now = new Date();
  const { start, end } = getLogicalDayBoundaries(now);
  const events = await fetchEventsFromAllCalendars(
    calendar,
    calendarIds,
    start.toISOString(),
    end.toISOString()
  );

  const plannedIntervals: Array<[Date, Date]> = [];
  let totalCompleted = 0;

  for (const event of events) {
    if (event.start.date && !event.start.dateTime) continue;
    const summary = event.summary || "";
    if (!eventMatchesSubjects(summary, subjects)) continue;

    const startAt = new Date(event.start.dateTime || event.start.date!);
    const endAt = new Date(event.end.dateTime || event.end.date!);
    plannedIntervals.push([startAt, endAt]);
    totalCompleted += getCompletedEventDuration(event, now);
  }

  const totalPlanned = mergeOverlappingIntervals(plannedIntervals).reduce(
    (acc, [s, e]) => acc + (e.getTime() - s.getTime()) / (1000 * 3600),
    0
  );

  const percentageCompleted =
    totalPlanned === 0 ? 100 : (totalCompleted / totalPlanned) * 100;

  return { totalPlanned, totalCompleted, percentageCompleted };
}

// ─── Daily Study Time (last N days) ─────────────────────

export async function calculateDailyStudyTime(
  calendar: calendar_v3.Calendar,
  calendarIds: string[],
  subjects: SubjectConfig,
  numDays: number = 30,
  subjectFilter?: string
) {
  const now = new Date();
  const safeNumDays = Math.max(1, numDays);
  const firstDate = new Date(now);
  firstDate.setDate(firstDate.getDate() - (safeNumDays - 1));
  const firstBoundaries = getLogicalDayBoundaries(firstDate);
  const timeMinIso = firstBoundaries.start.toISOString();
  const timeMaxIso = now.toISOString();
  const allEvents = await fetchEventsFromAllCalendars(
    calendar,
    calendarIds,
    timeMinIso,
    timeMaxIso
  );

  const includedDateKeys = new Set<string>();
  const isTodayByDateKey = new Set<string>();
  const entries: { date: string; label: string; hours: number }[] = [];
  const dayHoursByDate = new Map<string, number>();

  for (let i = safeNumDays - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const { start } = getLogicalDayBoundaries(date);
    const dateKey = start.toISOString().slice(0, 10);
    includedDateKeys.add(dateKey);
    if (i === 0) isTodayByDateKey.add(dateKey);
  }

  for (const event of allEvents) {
    if (event.start.date && !event.start.dateTime) continue;
    const summary = event.summary || "";

    if (subjectFilter) {
      const terms = subjects[subjectFilter];
      if (!terms || !eventMatchesSubject(summary, terms)) continue;
    } else if (!eventMatchesSubjects(summary, subjects)) {
      continue;
    }

    const key = eventLogicalDateKey(event);
    if (!key || !includedDateKeys.has(key)) continue;

    const hours = isTodayByDateKey.has(key)
      ? getCompletedEventDuration(event, now)
      : getEventDuration(event);
    if (hours <= 0) continue;

    dayHoursByDate.set(key, (dayHoursByDate.get(key) || 0) + hours);
  }

  for (let i = safeNumDays - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const { start } = getLogicalDayBoundaries(date);
    const dateKey = start.toISOString().slice(0, 10);
    const dayHours = dayHoursByDate.get(dateKey) || 0;

    const label = date.toLocaleDateString("en-GB", {
      month: "short",
      day: "numeric",
    });
    entries.push({
      date: dateKey,
      label,
      hours: Math.round(dayHours * 100) / 100,
    });
  }

  const monthEntries = entries;
  const weekEntries = entries.slice(-7);
  const averageMonth =
    monthEntries.reduce((s, e) => s + e.hours, 0) / monthEntries.length;
  const averageWeek =
    weekEntries.reduce((s, e) => s + e.hours, 0) / weekEntries.length;

  return { entries, averageMonth, averageWeek };
}

// ─── Subject Distribution ────────────────────────────────

export async function calculateSubjectDistribution(
  calendar: calendar_v3.Calendar,
  calendarIds: string[],
  subjects: SubjectConfig,
  numDays: number = 365
) {
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - numDays);

  const allEvents = await fetchEventsFromAllCalendars(
    calendar,
    calendarIds,
    timeMin.toISOString(),
    now.toISOString()
  );

  const subjectTimes: Record<string, number> = {};
  for (const subject of Object.keys(subjects)) {
    subjectTimes[subject] = 0;
  }

  for (const event of allEvents) {
    if (event.start.date && !event.start.dateTime) continue;
    const duration = getEventDuration(event);
    const summary = event.summary || "";
    for (const [subject, terms] of Object.entries(subjects)) {
      if (eventMatchesSubject(summary, terms)) {
        subjectTimes[subject] += duration;
        break;
      }
    }
  }

  const totalHours = Object.values(subjectTimes).reduce((s, h) => s + h, 0);

  return {
    subjectTimes: Object.entries(subjectTimes).map(([subject, hours]) => ({
      subject,
      hours: Math.round(hours * 100) / 100,
    })),
    totalHours: Math.round(totalHours * 100) / 100,
    numDays,
  };
}

// ─── Calendar Names ──────────────────────────────────────

export async function fetchCalendarNames(
  calendar: calendar_v3.Calendar
): Promise<Record<string, string>> {
  const res = await calendar.calendarList.list();
  const map: Record<string, string> = {};
  for (const item of res.data.items || []) {
    if (item.id && item.summary) {
      map[item.id] = item.summary;
    }
  }
  return map;
}

export async function fetchTrackerCalendars(
  calendar: calendar_v3.Calendar
): Promise<TrackerCalendarOption[]> {
  const calendars: TrackerCalendarOption[] = [];
  let pageToken: string | undefined;

  do {
    const res = await calendar.calendarList.list({
      maxResults: 250,
      pageToken,
    });

    for (const item of res.data.items || []) {
      if (!item.id || !item.summary) continue;

      const accessRole = item.accessRole || "reader";
      if (accessRole !== "owner" && accessRole !== "writer") continue;

      calendars.push({
        id: item.id,
        summary: item.summary,
        accessRole,
        primary: Boolean(item.primary),
      });
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  calendars.sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return a.summary.localeCompare(b.summary);
  });

  return calendars;
}

export async function fetchHabitSourceCalendars(
  calendar: calendar_v3.Calendar
): Promise<TrackerCalendarOption[]> {
  const calendars: TrackerCalendarOption[] = [];
  let pageToken: string | undefined;

  do {
    const res = await calendar.calendarList.list({
      maxResults: 250,
      pageToken,
    });

    for (const item of res.data.items || []) {
      if (!item.id || !item.summary) continue;

      const accessRole = item.accessRole || "reader";
      if (
        accessRole !== "owner" &&
        accessRole !== "writer" &&
        accessRole !== "reader"
      ) {
        continue;
      }

      calendars.push({
        id: item.id,
        summary: item.summary,
        accessRole,
        primary: Boolean(item.primary),
      });
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  calendars.sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return a.summary.localeCompare(b.summary);
  });

  return calendars;
}
