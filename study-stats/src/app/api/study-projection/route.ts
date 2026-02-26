import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  ApiRouteError,
  apiJson,
  apiLog,
  assertRateLimit,
  checkIdempotencyReplay,
  clientAddress,
  createApiRequestContext,
  handleApiError,
  idempotencyFingerprint,
  parseJsonBody,
  storeIdempotencyResult,
} from "@/lib/api-runtime";
import { getSupabaseAdminEnv } from "@/lib/env";

const supabaseEnv = getSupabaseAdminEnv();
const PROJECTION_TABLE = supabaseEnv.studyProjectionTable;
const projectionPutBodySchema = z.object({
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hoursPerDay: z.number().min(0).max(24),
});

function getSupabaseAdminClient() {
  return createClient(supabaseEnv.url, supabaseEnv.serviceRoleKey, {
    auth: { persistSession: false },
  });
}

function isRecoverableStorageError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = (error.message || "").toLowerCase();
  return message.includes("does not exist") || message.includes("relation");
}

async function getUserFromRequest(req: NextRequest) {
  const client = getSupabaseAdminClient();
  const authHeader = req.headers.get("authorization")?.trim();
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiRouteError(401, "MISSING_BEARER_TOKEN", "auth", "Missing authentication token.");
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new ApiRouteError(401, "EMPTY_BEARER_TOKEN", "auth", "Missing authentication token.");
  }

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    throw new ApiRouteError(401, "INVALID_BEARER_TOKEN", "auth", "Invalid authentication token.");
  }

  return { client, userId: data.user.id };
}

export async function GET(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/study-projection");

  try {
    const { client, userId } = await getUserFromRequest(req);
    const { data, error } = await client
      .from(PROJECTION_TABLE)
      .select("end_date, hours_per_day, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      if (isRecoverableStorageError(error)) {
        return apiJson(
          {
            endDate: null,
            hoursPerDay: null,
            updatedAt: null,
            cloudDisabled: true,
          },
          context
        );
      }

      throw new ApiRouteError(
        502,
        "SUPABASE_READ_FAILED",
        "upstream",
        error.message || "Failed to read study projection."
      );
    }

    return apiJson(
      {
        endDate: data?.end_date || null,
        hoursPerDay: typeof data?.hours_per_day === "number" ? data.hours_per_day : null,
        updatedAt: data?.updated_at || null,
      },
      context
    );
  } catch (error: unknown) {
    return handleApiError(error, context, "Failed to read study projection.");
  }
}

export async function PUT(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/study-projection");

  try {
    const { client, userId } = await getUserFromRequest(req);
    assertRateLimit({
      key: `study-projection:put:${userId}:${clientAddress(req)}`,
      limit: 30,
      windowMs: 60_000,
    });

    const body = await parseJsonBody(req, projectionPutBodySchema);
    const idempotencyKey = req.headers.get("idempotency-key");
    const fingerprint = idempotencyFingerprint(body);
    const replay = checkIdempotencyReplay(
      `study-projection:put:${userId}`,
      idempotencyKey,
      fingerprint
    );
    if (replay) {
      replay.headers.set("x-request-id", context.requestId);
      return replay;
    }

    const updatedAt = new Date().toISOString();
    const roundedHoursPerDay = Math.round(body.hoursPerDay * 100) / 100;
    const { error } = await client.from(PROJECTION_TABLE).upsert(
      {
        user_id: userId,
        end_date: body.endDate,
        hours_per_day: roundedHoursPerDay,
        updated_at: updatedAt,
      },
      { onConflict: "user_id" }
    );

    if (error) {
      if (isRecoverableStorageError(error)) {
        const disabledResponse = {
          ok: false,
          endDate: body.endDate,
          hoursPerDay: roundedHoursPerDay,
          updatedAt,
          cloudDisabled: true,
        };
        storeIdempotencyResult({
          scope: `study-projection:put:${userId}`,
          idempotencyKey,
          fingerprint,
          status: 200,
          body: disabledResponse,
        });
        return apiJson(disabledResponse, context);
      }

      throw new ApiRouteError(
        502,
        "SUPABASE_WRITE_FAILED",
        "upstream",
        error.message || "Failed to save study projection."
      );
    }

    const responseBody = {
      ok: true,
      endDate: body.endDate,
      hoursPerDay: roundedHoursPerDay,
      updatedAt,
    };
    storeIdempotencyResult({
      scope: `study-projection:put:${userId}`,
      idempotencyKey,
      fingerprint,
      status: 200,
      body: responseBody,
    });
    apiLog("info", context, "study_projection_saved", {
      userId,
      endDate: body.endDate,
      hoursPerDay: roundedHoursPerDay,
    });
    return apiJson(responseBody, context);
  } catch (error: unknown) {
    return handleApiError(error, context, "Failed to save study projection.");
  }
}
