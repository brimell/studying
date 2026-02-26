import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { fetchTrackerCalendars, getCalendarClient } from "@/lib/calendar";

export async function GET() {
  const session = await auth();
  if (!session || !(session as { accessToken?: string }).accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const accessToken = (session as { accessToken: string }).accessToken;
    const calendar = getCalendarClient(accessToken);
    const calendars = await fetchTrackerCalendars(calendar);

    const defaultCalendarId =
      (process.env.HABIT_TRACKER_CALENDAR_ID &&
      calendars.some((entry) => entry.id === process.env.HABIT_TRACKER_CALENDAR_ID)
        ? process.env.HABIT_TRACKER_CALENDAR_ID
        : calendars[0]?.id) || null;

    return NextResponse.json({
      calendars,
      defaultCalendarId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch calendars";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
