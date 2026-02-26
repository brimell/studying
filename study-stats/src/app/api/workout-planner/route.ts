import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseAdminEnv } from "@/lib/env";
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
import {
  defaultWorkoutPlannerPayload,
  emptyWorkoutPayload,
  forceApplyDefaultTemplates,
  sanitizeWorkoutPayload,
} from "@/lib/workouts";

const supabaseEnv = getSupabaseAdminEnv();
const WORKOUT_TABLE = supabaseEnv.workoutTable;
const READ_CACHE_CONTROL = "private, max-age=20, stale-while-revalidate=40";
const workoutPutBodySchema = z.object({
  payload: z.unknown().optional(),
});

function getSupabaseAdminClient() {
  return createClient(supabaseEnv.url, supabaseEnv.serviceRoleKey, {
    auth: { persistSession: false },
  });
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
  const context = createApiRequestContext(req, "/api/workout-planner");

  try {
    const auth = await getUserFromRequest(req);
    const { client, userId } = auth;
    const { data, error } = await client
      .from(WORKOUT_TABLE)
      .select("payload, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new ApiRouteError(
        502,
        "SUPABASE_READ_FAILED",
        "upstream",
        error.message || "Failed to read workout data."
      );
    }

    if (!data) {
      const seeded = defaultWorkoutPlannerPayload();
      return apiJson(
        {
          payload: seeded,
          updatedAt: null,
        },
        context,
        {
          headers: {
            "Cache-Control": READ_CACHE_CONTROL,
          },
        }
      );
    }

    const rawPayload = data.payload || emptyWorkoutPayload();
    const sanitized = sanitizeWorkoutPayload(rawPayload);
    const schemaChanged = JSON.stringify(rawPayload) !== JSON.stringify(sanitized);
    const { payload, changed } = forceApplyDefaultTemplates(sanitized);
    if (schemaChanged || changed) {
      apiLog("info", context, "workout_payload_transformed_on_read", {
        userId,
        schemaChanged,
        templateChanged: changed,
      });
    }

    return apiJson(
      {
        payload,
        updatedAt: data.updated_at || null,
      },
      context,
      {
        headers: {
          "Cache-Control": READ_CACHE_CONTROL,
        },
      }
    );
  } catch (error: unknown) {
    return handleApiError(error, context, "Failed to read workout data.");
  }
}

export async function PUT(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/workout-planner");

  try {
    const auth = await getUserFromRequest(req);
    const { client, userId } = auth;
    assertRateLimit({
      key: `workout-planner:put:${userId}:${clientAddress(req)}`,
      limit: 45,
      windowMs: 60_000,
    });
    const body = await parseJsonBody(req, workoutPutBodySchema);
    const idempotencyKey = req.headers.get("idempotency-key");
    const fingerprint = idempotencyFingerprint(body);
    const replay = checkIdempotencyReplay(
      `workout-planner:put:${userId}`,
      idempotencyKey,
      fingerprint
    );
    if (replay) {
      replay.headers.set("x-request-id", context.requestId);
      return replay;
    }

    const sanitized = sanitizeWorkoutPayload(body.payload);
    const applied = forceApplyDefaultTemplates(sanitized);
    const payload = applied.payload;
    payload.updatedAt = new Date().toISOString();

    const { error } = await client.from(WORKOUT_TABLE).upsert(
      {
        user_id: userId,
        payload,
        updated_at: payload.updatedAt,
      },
      { onConflict: "user_id" }
    );

    if (error) {
      throw new ApiRouteError(
        502,
        "SUPABASE_WRITE_FAILED",
        "upstream",
        error.message || "Failed to save workout data."
      );
    }

    const responseBody = { ok: true, payload, updatedAt: payload.updatedAt };
    storeIdempotencyResult({
      scope: `workout-planner:put:${userId}`,
      idempotencyKey,
      fingerprint,
      status: 200,
      body: responseBody,
    });
    apiLog("info", context, "workout_payload_saved", {
      userId,
      workoutCount: payload.workouts.length,
      weeklyPlanCount: payload.weeklyPlans.length,
    });
    return apiJson(responseBody, context);
  } catch (error: unknown) {
    return handleApiError(error, context, "Failed to save workout data.");
  }
}
