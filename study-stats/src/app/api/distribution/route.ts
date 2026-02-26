import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCalendarClient, calculateSubjectDistribution } from "@/lib/calendar";
import { DEFAULT_SUBJECTS } from "@/lib/types";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || !(session as any).accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = (session as any).accessToken as string;
  const calendar = getCalendarClient(accessToken);
  const calendarIds = (process.env.CALENDAR_IDS || "").split(",").filter(Boolean);

  const { searchParams } = new URL(req.url);
  const numDays = parseInt(searchParams.get("days") || "365", 10);

  try {
    const data = await calculateSubjectDistribution(
      calendar,
      calendarIds,
      DEFAULT_SUBJECTS,
      numDays
    );
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Error fetching distribution:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
