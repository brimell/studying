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
  timeMax: string
): Promise<CalendarEvent[]> {
  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    maxResults: 10000,
    singleEvents: true,
    orderBy: "startTime",
  });
  return (res.data.items || []) as CalendarEvent[];
}

export async function fetchEventsFromAllCalendars(
  calendar: calendar_v3.Calendar,
  calendarIds: string[],
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  const allEvents: CalendarEvent[] = [];
  for (const id of calendarIds) {
    const events = await fetchEvents(calendar, id, timeMin, timeMax);
    allEvents.push(...events);
  }
  return allEvents;
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

  let totalPlanned = 0;
  let totalCompleted = 0;

  for (const calendarId of calendarIds) {
    // Planned: all events today
    const plannedEvents = await fetchEvents(
      calendar,
      calendarId,
      start.toISOString(),
      end.toISOString()
    );

    // Merge overlapping intervals for planned time
    const intervals: [Date, Date][] = [];
    for (const event of plannedEvents) {
      if (event.start.date && !event.start.dateTime) continue;
      const summary = event.summary || "";
      if (!eventMatchesSubjects(summary, subjects)) continue;

      const s = new Date(event.start.dateTime!);
      const e = new Date(event.end.dateTime!);
      let merged = false;
      for (let i = 0; i < intervals.length; i++) {
        const [is, ie] = intervals[i];
        if (Math.max(s.getTime(), is.getTime()) < Math.min(e.getTime(), ie.getTime())) {
          intervals[i] = [
            new Date(Math.min(s.getTime(), is.getTime())),
            new Date(Math.max(e.getTime(), ie.getTime())),
          ];
          merged = true;
          break;
        }
      }
      if (!merged) intervals.push([s, e]);
    }
    totalPlanned += intervals.reduce(
      (acc, [s, e]) => acc + (e.getTime() - s.getTime()) / (1000 * 3600),
      0
    );

    // Completed: events up to now
    const completedEvents = await fetchEvents(
      calendar,
      calendarId,
      start.toISOString(),
      now.toISOString()
    );
    for (const event of completedEvents) {
      if (event.start.date && !event.start.dateTime) continue;
      const summary = event.summary || "";
      if (!eventMatchesSubjects(summary, subjects)) continue;
      totalCompleted += getCompletedEventDuration(event, now);
    }
  }

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
  const entries: { date: string; label: string; hours: number }[] = [];

  for (let i = numDays - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const { start, end } = getLogicalDayBoundaries(date);

    let dayHours = 0;
    for (const calendarId of calendarIds) {
      const isToday = i === 0;
      const timeMax = isToday ? now.toISOString() : end.toISOString();
      const events = await fetchEvents(
        calendar,
        calendarId,
        start.toISOString(),
        timeMax
      );

      for (const event of events) {
        if (event.start.date && !event.start.dateTime) continue;
        const summary = event.summary || "";

        if (subjectFilter) {
          const terms = subjects[subjectFilter];
          if (!terms || !eventMatchesSubject(summary, terms)) continue;
        } else {
          if (!eventMatchesSubjects(summary, subjects)) continue;
        }

        if (isToday) {
          dayHours += getCompletedEventDuration(event, now);
        } else {
          dayHours += getEventDuration(event);
        }
      }
    }

    const label = date.toLocaleDateString("en-GB", {
      month: "short",
      day: "numeric",
    });
    entries.push({
      date: date.toISOString().slice(0, 10),
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
