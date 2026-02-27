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
const EXAM_TABLE = supabaseEnv.examCountdownTable;
const examPutBodySchema = z.object({
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  countdownStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
  const context = createApiRequestContext(req, "/api/exam-countdown");

  try {
    const { client, userId } = await getUserFromRequest(req);
    const { data, error } = await client
      .from(EXAM_TABLE)
      .select("exam_date, countdown_start_date, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      if (isRecoverableStorageError(error)) {
        return apiJson(
          {
            examDate: null,
            countdownStartDate: null,
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
        error.message || "Failed to read exam countdown."
      );
    }

    return apiJson(
      {
        examDate: data?.exam_date || null,
        countdownStartDate: data?.countdown_start_date || null,
        updatedAt: data?.updated_at || null,
      },
      context
    );
  } catch (error: unknown) {
    return handleApiError(error, context, "Failed to read exam countdown.");
  }
}

export async function PUT(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/exam-countdown");

  try {
    const { client, userId } = await getUserFromRequest(req);
    await assertRateLimit({
      key: `exam-countdown:put:${userId}:${clientAddress(req)}`,
      limit: 30,
      windowMs: 60_000,
    });

    const body = await parseJsonBody(req, examPutBodySchema);
    const idempotencyKey = req.headers.get("idempotency-key");
    const fingerprint = idempotencyFingerprint(body);
    const replay = await checkIdempotencyReplay(
      `exam-countdown:put:${userId}`,
      idempotencyKey,
      fingerprint
    );
    if (replay) {
      replay.headers.set("x-request-id", context.requestId);
      return replay;
    }

    const updatedAt = new Date().toISOString();
    const { error } = await client.from(EXAM_TABLE).upsert(
      {
        user_id: userId,
        exam_date: body.examDate,
        countdown_start_date: body.countdownStartDate,
        updated_at: updatedAt,
      },
      { onConflict: "user_id" }
    );

    if (error) {
      if (isRecoverableStorageError(error)) {
        const disabledResponse = {
          ok: false,
          examDate: body.examDate,
          countdownStartDate: body.countdownStartDate,
          updatedAt,
          cloudDisabled: true,
        };
        await storeIdempotencyResult({
          scope: `exam-countdown:put:${userId}`,
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
        error.message || "Failed to save exam countdown."
      );
    }

    const responseBody = {
      ok: true,
      examDate: body.examDate,
      countdownStartDate: body.countdownStartDate,
      updatedAt,
    };
    await storeIdempotencyResult({
      scope: `exam-countdown:put:${userId}`,
      idempotencyKey,
      fingerprint,
      status: 200,
      body: responseBody,
    });
    apiLog("info", context, "exam_countdown_saved", {
      userId,
      examDate: body.examDate,
      countdownStartDate: body.countdownStartDate,
    });
    return apiJson(responseBody, context);
  } catch (error: unknown) {
    return handleApiError(error, context, "Failed to save exam countdown.");
  }
}
