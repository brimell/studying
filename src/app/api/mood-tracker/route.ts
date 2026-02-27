import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  ApiRouteError,
  apiJson,
  assertRateLimit,
  clientAddress,
  createApiRequestContext,
  handleApiError,
  parseJsonBody,
} from "@/lib/api-runtime";
import { fetchTrackerCalendars, getCalendarClient } from "@/lib/calendar";
import {
  MOOD_RATING_MAX,
  MOOD_RATING_MIN,
  MOOD_VALUES,
  moodToRating,
  type MoodValue,
} from "@/lib/mood-tracker";

const moodPostSchema = z.object({
  mood: z.enum(MOOD_VALUES),
  rating: z.number().int().min(MOOD_RATING_MIN).max(MOOD_RATING_MAX).optional(),
  calendarId: z.string().trim().min(1).optional(),
  loggedAt: z
    .string()
    .datetime({ offset: true })
    .optional(),
});

function moodLabel(mood: MoodValue): string {
  switch (mood) {
    case "angry":
      return "Angry";
    case "sad":
      return "Sad";
    case "ok":
      return "OK";
    case "good":
      return "Good";
    case "happy":
      return "Happy";
    default:
      return "Mood";
  }
}

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
    "MOOD_TRACKER_POST_FAILED",
    "internal",
    error instanceof Error ? error.message : "Failed to log mood."
  );
}

export async function POST(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/mood-tracker");

  try {
    const session = await auth();
    const accessToken = (session as { accessToken?: string } | null)?.accessToken;
    if (!accessToken) {
      throw new ApiRouteError(401, "UNAUTHORIZED", "auth", "Unauthorized");
    }

    assertRateLimit({
      key: `mood-tracker:post:${clientAddress(req)}`,
      limit: 20,
      windowMs: 60_000,
    });

    const body = await parseJsonBody(req, moodPostSchema);
    const calendar = getCalendarClient(accessToken);
    const writableCalendars = await fetchTrackerCalendars(calendar);

    if (writableCalendars.length === 0) {
      throw new ApiRouteError(
        400,
        "NO_WRITABLE_CALENDAR",
        "validation",
        "No writable Google Calendar available."
      );
    }

    const selectedCalendar = body.calendarId
      ? writableCalendars.find((entry) => entry.id === body.calendarId)
      : writableCalendars.find((entry) => entry.primary) || writableCalendars[0];

    if (!selectedCalendar) {
      throw new ApiRouteError(
        400,
        "INVALID_CALENDAR",
        "validation",
        "Selected calendar is not writable."
      );
    }

    const loggedAt = body.loggedAt ? new Date(body.loggedAt) : new Date();
    if (Number.isNaN(loggedAt.getTime())) {
      throw new ApiRouteError(400, "INVALID_LOGGED_AT", "validation", "Invalid loggedAt date.");
    }

    const endAt = new Date(loggedAt.getTime() + 15 * 60 * 1000);
    const rating = body.rating ?? moodToRating(body.mood);

    const inserted = await calendar.events.insert({
      calendarId: selectedCalendar.id,
      requestBody: {
        summary: `Mood: ${moodLabel(body.mood)} (${rating}/10)`,
        description: `Logged from Dashboard mood tracker at ${loggedAt.toISOString()}`,
        start: { dateTime: loggedAt.toISOString() },
        end: { dateTime: endAt.toISOString() },
        visibility: "private",
        transparency: "transparent",
        extendedProperties: {
          private: {
            studyStatsType: "mood-log",
            mood: body.mood,
            rating: String(rating),
          },
        },
      },
    });

    return apiJson(
      {
        ok: true,
        calendarId: selectedCalendar.id,
        calendarSummary: selectedCalendar.summary,
        eventId: inserted.data.id || null,
        loggedAt: loggedAt.toISOString(),
      },
      context
    );
  } catch (error: unknown) {
    return handleApiError(normalizeCalendarError(error), context, "Failed to log mood.");
  }
}
