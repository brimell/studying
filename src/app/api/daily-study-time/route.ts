import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { calculateDailyStudyTime, getCalendarClient } from "@/lib/calendar";
import { DEFAULT_SUBJECTS } from "@/lib/types";
import {
  ApiRouteError,
  apiJson,
  createApiRequestContext,
  handleApiError,
  parseQuery,
} from "@/lib/api-runtime";

const PRIVATE_CACHE_CONTROL = "private, max-age=30, stale-while-revalidate=120";
const dailyStudyQuerySchema = z.object({
  calendarIds: z.string().optional(),
  days: z.coerce.number().int().min(1).max(730).default(30),
  subject: z.string().trim().min(1).optional(),
});

function resolveCalendarIds(rawValue: string | undefined): string[] {
  const defaultCalendarIds = (process.env.CALENDAR_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const requestedCalendarIds = (rawValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return requestedCalendarIds.length > 0 ? requestedCalendarIds : defaultCalendarIds;
}

function normalizeCalendarError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string
): ApiRouteError {
  if (error instanceof ApiRouteError) return error;

  const anyError = error as {
    code?: number;
    response?: { status?: number };
    message?: string;
  };
  const status = anyError?.code || anyError?.response?.status;
  const messageLower = (anyError?.message || "").toLowerCase();
  if (
    status === 401 ||
    messageLower.includes("invalid authentication credentials") ||
    messageLower.includes("invalid credentials") ||
    messageLower.includes("login required")
  ) {
    return new ApiRouteError(
      401,
      "GOOGLE_SESSION_EXPIRED",
      "auth",
      "Google session expired. Sign out and sign in with Google again."
    );
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  return new ApiRouteError(500, fallbackCode, "internal", message);
}

export async function GET(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/daily-study-time");

  try {
    const session = await auth();
    const accessToken = (session as { accessToken?: string } | null)?.accessToken;
    if (!accessToken) {
      throw new ApiRouteError(401, "UNAUTHORIZED", "auth", "Unauthorized");
    }

    const query = parseQuery(req, dailyStudyQuerySchema);
    const calendarIds = resolveCalendarIds(query.calendarIds);
    const calendar = getCalendarClient(accessToken);
    const data = await calculateDailyStudyTime(
      calendar,
      calendarIds,
      DEFAULT_SUBJECTS,
      query.days,
      query.subject
    );
    return apiJson(data, context, {
      headers: {
        "Cache-Control": PRIVATE_CACHE_CONTROL,
      },
    });
  } catch (error: unknown) {
    return handleApiError(
      normalizeCalendarError(error, "DAILY_STUDY_TIME_GET_FAILED", "Failed to fetch daily study time."),
      context,
      "Failed to fetch daily study time."
    );
  }
}
