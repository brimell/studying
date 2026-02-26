import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getCalendarClient,
  fetchEventsFromAllCalendars,
  eventMatchesSubjects,
  getLogicalDayBoundaries,
} from "@/lib/calendar";
import { DEFAULT_SUBJECTS } from "@/lib/types";
import type { HabitDay } from "@/lib/types";

function getEventDuration(event: { start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string } }): number {
  if (event.start.date && !event.start.dateTime) return 0;
  const start = new Date(event.start.dateTime || event.start.date!);
  const end = new Date(event.end.dateTime || event.end.date!);
  return (end.getTime() - start.getTime()) / (1000 * 3600);
}

function hoursToLevel(hours: number): 0 | 1 | 2 | 3 | 4 {
  if (hours <= 0) return 0;
  if (hours < 1) return 1;
  if (hours < 3) return 2;
  if (hours < 5) return 3;
  return 4;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || !(session as any).accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = (session as any).accessToken as string;
  const calendar = getCalendarClient(accessToken);
  const calendarIds = (process.env.CALENDAR_IDS || "").split(",").filter(Boolean);

  const { searchParams } = new URL(req.url);
  const numWeeks = parseInt(searchParams.get("weeks") || "20", 10);
  const numDays = numWeeks * 7;

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

    // Build a map of date -> hours
    const dateHoursMap: Record<string, number> = {};

    for (const event of allEvents) {
      if (event.start.date && !event.start.dateTime) continue;
      const summary = event.summary || "";
      if (!eventMatchesSubjects(summary, DEFAULT_SUBJECTS)) continue;

      const duration = getEventDuration(event);
      const eventStart = new Date(event.start.dateTime!);
      // Use logical day boundaries to assign to correct day
      const { start: dayStart } = getLogicalDayBoundaries(eventStart);
      const dateKey = dayStart.toISOString().slice(0, 10);

      dateHoursMap[dateKey] = (dateHoursMap[dateKey] || 0) + duration;
    }

    // Build days array from oldest to newest
    const days: HabitDay[] = [];
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().slice(0, 10);
      const hours = Math.round((dateHoursMap[dateKey] || 0) * 100) / 100;
      days.push({ date: dateKey, hours, level: hoursToLevel(hours) });
    }

    // Calculate streaks (a "study day" = any day with > 0 hours)
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    let totalDaysStudied = 0;
    let totalHours = 0;

    for (const day of days) {
      totalHours += day.hours;
      if (day.hours > 0) {
        totalDaysStudied++;
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
    }

    // Current streak: count backwards from today
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].hours > 0) {
        currentStreak++;
      } else {
        break;
      }
    }

    return NextResponse.json({
      days,
      currentStreak,
      longestStreak,
      totalDaysStudied,
      totalHours: Math.round(totalHours * 100) / 100,
    });
  } catch (err: any) {
    console.error("Error fetching habit data:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
