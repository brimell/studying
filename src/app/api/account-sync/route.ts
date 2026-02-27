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
const SYNC_TABLE = supabaseEnv.syncTable;
const MAX_SYNC_KEYS = 500;
const MAX_VALUE_LENGTH = 200_000;

const syncPayloadSchema = z
  .record(z.string().min(1).max(120), z.string().max(MAX_VALUE_LENGTH))
  .superRefine((value, context) => {
    if (Object.keys(value).length <= MAX_SYNC_KEYS) return;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Payload cannot exceed ${MAX_SYNC_KEYS} keys.`,
    });
  });

const putBodySchema = z.object({
  payload: syncPayloadSchema,
  ifUnmodifiedSince: z
    .string()
    .optional()
    .refine((value) => !value || Number.isFinite(new Date(value).getTime()), {
      message: "ifUnmodifiedSince must be a valid date-time string.",
    }),
});

type SyncPayload = z.infer<typeof syncPayloadSchema>;

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

function assertStoredPayload(value: unknown): SyncPayload {
  const parsed = syncPayloadSchema.safeParse(value || {});
  if (parsed.success) return parsed.data;
  throw new ApiRouteError(
    500,
    "INVALID_STORED_SYNC_PAYLOAD",
    "internal",
    "Stored sync payload is invalid."
  );
}

export async function GET(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/account-sync");

  try {
    const { client, userId } = await getUserFromRequest(req);
    const { data, error } = await client
      .from(SYNC_TABLE)
      .select("payload, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new ApiRouteError(
        502,
        "SUPABASE_READ_FAILED",
        "upstream",
        error.message || "Failed to read synced data."
      );
    }

    const payload = assertStoredPayload(data?.payload);
    return apiJson(
      {
        payload,
        updatedAt: data?.updated_at || null,
      },
      context
    );
  } catch (error: unknown) {
    return handleApiError(error, context, "Failed to read synced data.");
  }
}

export async function PUT(req: NextRequest) {
  const context = createApiRequestContext(req, "/api/account-sync");

  try {
    const { client, userId } = await getUserFromRequest(req);
    assertRateLimit({
      key: `account-sync:put:${userId}:${clientAddress(req)}`,
      limit: 45,
      windowMs: 60_000,
    });

    const body = await parseJsonBody(req, putBodySchema);
    const idempotencyKey = req.headers.get("idempotency-key");
    const fingerprint = idempotencyFingerprint(body);
    const replay = checkIdempotencyReplay(`account-sync:put:${userId}`, idempotencyKey, fingerprint);
    if (replay) {
      replay.headers.set("x-request-id", context.requestId);
      return replay;
    }

    const ifUnmodifiedSince =
      body.ifUnmodifiedSince || req.headers.get("if-unmodified-since")?.trim() || null;
    if (ifUnmodifiedSince) {
      const existing = await client
        .from(SYNC_TABLE)
        .select("updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (existing.error) {
        throw new ApiRouteError(
          502,
          "SUPABASE_PRECONDITION_READ_FAILED",
          "upstream",
          existing.error.message || "Failed to validate sync precondition."
        );
      }
      const existingUpdatedAt = existing.data?.updated_at || null;
      if (existingUpdatedAt && existingUpdatedAt !== ifUnmodifiedSince) {
        throw new ApiRouteError(
          409,
          "SYNC_CONFLICT",
          "conflict",
          "Cloud payload changed. Refresh and retry."
        );
      }
    }

    const updatedAt = new Date().toISOString();
    const { error } = await client.from(SYNC_TABLE).upsert(
      {
        user_id: userId,
        payload: body.payload,
        updated_at: updatedAt,
      },
      { onConflict: "user_id" }
    );

    if (error) {
      throw new ApiRouteError(
        502,
        "SUPABASE_WRITE_FAILED",
        "upstream",
        error.message || "Failed to save synced data."
      );
    }

    const responseBody = { ok: true, updatedAt };
    storeIdempotencyResult({
      scope: `account-sync:put:${userId}`,
      idempotencyKey,
      fingerprint,
      status: 200,
      body: responseBody,
    });
    apiLog("info", context, "account_sync_saved", {
      userId,
      keyCount: Object.keys(body.payload).length,
    });
    return apiJson(responseBody, context);
  } catch (error: unknown) {
    return handleApiError(error, context, "Failed to save synced data.");
  }
}
