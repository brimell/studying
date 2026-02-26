import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCalendarClient, calculateSubjectDistribution } from "@/lib/calendar";
import { DEFAULT_SUBJECTS } from "@/lib/types";

const PRIVATE_CACHE_CONTROL = "private, max-age=60, stale-while-revalidate=180";

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
  const numDays = parseInt(searchParams.get("days") || "365", 10);

  try {
    const data = await calculateSubjectDistribution(
      calendar,
      calendarIds,
      DEFAULT_SUBJECTS,
      numDays
    );
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": PRIVATE_CACHE_CONTROL,
      },
    });
  } catch (err: any) {
    console.error("Error fetching distribution:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
