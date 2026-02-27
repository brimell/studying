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
  defaultDailyTrackerFormData,
  parseDailyTrackerFormData,
  serializeDailyTrackerForDescription,
  type DailyTrackerFormData,
} from "@/lib/daily-tracker";

const trackerPostSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  form: z.unknown().optional(),
  description: z.string().trim().optional(),
  calendarId: z.string().trim().min(1).optional(),
});

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
    "DAILY_TRACKER_POST_FAILED",
    "internal",
    error instanceof Error ? error.message : "Failed to log daily tracker."
  );
}

function buildDailyTrackerSummary(date: string, form: DailyTrackerFormData): string {
  const parts = [`Daily Tracker ${date}`];
  if (form.morningSleepRating !== null) {
    parts.push(`Sleep ${form.morningSleepRating}/10`);
  }
  if (form.moodRating !== null) {
    parts.push(`Mood ${form.moodRating}/10`);
  }
  return parts.join(" | ");
}

function addDays(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

async function findExistingDailyTrackerEvent(
  calendar: ReturnType<typeof getCalendarClient>,
  calendarId: string,
  date: string
): Promise<string | null> {
  const response = await calendar.events.list({
    calendarId,
    timeMin: `${date}T00:00:00.000Z`,
    timeMax: `${addDays(date, 1)}T00:00:00.000Z`,
    singleEvents: true,
    showDeleted: false,
    maxResults: 20,
    privateExtendedProperty: [`studyStatsType=daily-tracker`, `trackerDate=${date}`],
  });

  const match = (response.data.items || []).find((event) => Boolean(event.id));
  return match?.id || null;
}

export async function POST(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/mood-tracker");

  try {
    const session = await auth();
    const accessToken = (session as { accessToken?: string } | null)?.accessToken;
    if (!accessToken) {
      throw new ApiRouteError(401, "UNAUTHORIZED", "auth", "Unauthorized");
    }

    await assertRateLimit({
      key: `daily-tracker:post:${clientAddress(req)}`,
      limit: 20,
      windowMs: 60_000,
    });

    const body = await parseJsonBody(req, trackerPostSchema);
    const form = parseDailyTrackerFormData(body.form || defaultDailyTrackerFormData(body.date), body.date);
    const description = body.description?.trim() || serializeDailyTrackerForDescription(form);

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

    const requestBody = {
      summary: buildDailyTrackerSummary(body.date, form),
      description,
      start: { date: body.date },
      end: { date: addDays(body.date, 1) },
      visibility: "private" as const,
      transparency: "transparent" as const,
      extendedProperties: {
        private: {
          studyStatsType: "daily-tracker",
          trackerDate: body.date,
        },
      },
    };

    const existingEventId = await findExistingDailyTrackerEvent(calendar, selectedCalendar.id, body.date);
    let eventId: string | null = null;

    if (existingEventId) {
      const patched = await calendar.events.patch({
        calendarId: selectedCalendar.id,
        eventId: existingEventId,
        requestBody,
      });
      eventId = patched.data.id || existingEventId;
    } else {
      const inserted = await calendar.events.insert({
        calendarId: selectedCalendar.id,
        requestBody,
      });
      eventId = inserted.data.id || null;
    }

    return apiJson(
      {
        ok: true,
        calendarId: selectedCalendar.id,
        calendarSummary: selectedCalendar.summary,
        eventId,
        date: body.date,
      },
      context
    );
  } catch (error: unknown) {
    return handleApiError(normalizeCalendarError(error), context, "Failed to log daily tracker.");
  }
}
