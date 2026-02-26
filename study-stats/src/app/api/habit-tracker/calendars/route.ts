import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  fetchHabitSourceCalendars,
  fetchTrackerCalendars,
  getCalendarClient,
} from "@/lib/calendar";

function isGoogleAuthError(error: unknown): boolean {
  const anyError = error as {
    code?: number;
    response?: { status?: number };
    message?: string;
  };
  const status = anyError?.code || anyError?.response?.status;
  if (status === 401) return true;
  const message = (anyError?.message || "").toLowerCase();
  return (
    message.includes("invalid authentication credentials") ||
    message.includes("invalid credentials") ||
    message.includes("login required")
  );
}

export async function GET() {
  const session = await auth();
  const accessToken = (session as unknown as { accessToken?: string } | null)?.accessToken;
  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const calendar = getCalendarClient(accessToken);
    const [trackerCalendars, sourceCalendars] = await Promise.all([
      fetchTrackerCalendars(calendar),
      fetchHabitSourceCalendars(calendar),
    ]);

    const defaultCalendarId =
      (process.env.HABIT_TRACKER_CALENDAR_ID &&
      trackerCalendars.some((entry) => entry.id === process.env.HABIT_TRACKER_CALENDAR_ID)
        ? process.env.HABIT_TRACKER_CALENDAR_ID
        : trackerCalendars[0]?.id) || null;

    const defaultSourceCalendarIds = (process.env.CALENDAR_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((id) => sourceCalendars.some((calendarEntry) => calendarEntry.id === id));

    return NextResponse.json({
      trackerCalendars,
      sourceCalendars,
      defaultTrackerCalendarId: defaultCalendarId,
      defaultSourceCalendarIds,
    });
  } catch (error: unknown) {
    if (isGoogleAuthError(error)) {
      return NextResponse.json(
        { error: "Google session expired. Sign out and sign in with Google again." },
        { status: 401 }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to fetch calendars";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
