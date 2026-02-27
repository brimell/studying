import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  fetchHabitSourceCalendars,
  fetchTrackerCalendars,
  getCalendarClient,
} from "@/lib/calendar";
import {
  ApiRouteError,
  apiJson,
  createApiRequestContext,
  handleApiError,
} from "@/lib/api-runtime";

const PRIVATE_CACHE_CONTROL = "private, max-age=120, stale-while-revalidate=300";

function normalizeCalendarError(error: unknown): ApiRouteError {
  if (error instanceof ApiRouteError) return error;

  const anyError = error as {
    code?: number;
    response?: { status?: number };
    message?: string;
  };
  const status = anyError?.code || anyError?.response?.status;
  const message = (anyError?.message || "").toLowerCase();
  if (
    status === 401 ||
    message.includes("invalid authentication credentials") ||
    message.includes("invalid credentials") ||
    message.includes("login required")
  ) {
    return new ApiRouteError(
      401,
      "GOOGLE_SESSION_EXPIRED",
      "auth",
      "Google session expired. Sign out and sign in with Google again."
    );
  }

  return new ApiRouteError(
    500,
    "HABIT_CALENDARS_GET_FAILED",
    "internal",
    error instanceof Error ? error.message : "Failed to fetch calendars."
  );
}

export async function GET(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/habit-tracker/calendars");

  try {
    const session = await auth();
    const accessToken = (session as { accessToken?: string } | null)?.accessToken;
    if (!accessToken) {
      throw new ApiRouteError(401, "UNAUTHORIZED", "auth", "Unauthorized");
    }

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

    return apiJson(
      {
        trackerCalendars,
        sourceCalendars,
        defaultTrackerCalendarId: defaultCalendarId,
        defaultSourceCalendarIds,
      },
      context,
      {
        headers: {
          "Cache-Control": PRIVATE_CACHE_CONTROL,
        },
      }
    );
  } catch (error: unknown) {
    return handleApiError(normalizeCalendarError(error), context, "Failed to fetch calendars.");
  }
}
