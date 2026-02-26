import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCalendarClient, calculateTodayProgress } from "@/lib/calendar";
import { DEFAULT_SUBJECTS } from "@/lib/types";

const PRIVATE_CACHE_CONTROL = "private, max-age=30, stale-while-revalidate=120";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || !(session as any).accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = (session as any).accessToken as string;
  const calendar = getCalendarClient(accessToken);
  const defaultCalendarIds = (process.env.CALENDAR_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const { searchParams } = new URL(req.url);
  const requestedCalendarIds = (searchParams.get("calendarIds") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const calendarIds = requestedCalendarIds.length > 0 ? requestedCalendarIds : defaultCalendarIds;

  try {
    const data = await calculateTodayProgress(calendar, calendarIds, DEFAULT_SUBJECTS);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": PRIVATE_CACHE_CONTROL,
      },
    });
  } catch (err: any) {
    console.error("Error fetching today's progress:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
