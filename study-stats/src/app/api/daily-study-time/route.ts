import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCalendarClient, calculateDailyStudyTime } from "@/lib/calendar";
import { DEFAULT_SUBJECTS } from "@/lib/types";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || !(session as any).accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = (session as any).accessToken as string;
  const calendar = getCalendarClient(accessToken);
  const { searchParams } = new URL(req.url);
  const defaultCalendarIds = (process.env.CALENDAR_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const requestedCalendarIds = (searchParams.get("calendarIds") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const calendarIds = requestedCalendarIds.length > 0 ? requestedCalendarIds : defaultCalendarIds;
  const numDays = parseInt(searchParams.get("days") || "30", 10);
  const subject = searchParams.get("subject") || undefined;

  try {
    const data = await calculateDailyStudyTime(
      calendar,
      calendarIds,
      DEFAULT_SUBJECTS,
      numDays,
      subject
    );
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Error fetching daily study time:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
