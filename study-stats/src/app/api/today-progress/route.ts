import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCalendarClient, calculateTodayProgress } from "@/lib/calendar";
import { DEFAULT_SUBJECTS } from "@/lib/types";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || !(session as any).accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = (session as any).accessToken as string;
  const calendar = getCalendarClient(accessToken);
  const calendarIds = (process.env.CALENDAR_IDS || "").split(",").filter(Boolean);

  try {
    const data = await calculateTodayProgress(calendar, calendarIds, DEFAULT_SUBJECTS);
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Error fetching today's progress:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
