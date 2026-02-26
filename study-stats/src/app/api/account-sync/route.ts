import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SYNC_TABLE = process.env.SUPABASE_SYNC_TABLE || "study_stats_user_sync";
const MAX_SYNC_KEYS = 500;
const MAX_VALUE_LENGTH = 200_000;

type SyncPayload = Record<string, string>;

function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

function toErrorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function isValidPayload(value: unknown): value is SyncPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_SYNC_KEYS) return false;

  for (const [key, item] of entries) {
    if (typeof key !== "string" || key.length === 0 || key.length > 120) return false;
    if (typeof item !== "string") return false;
    if (item.length > MAX_VALUE_LENGTH) return false;
  }

  return true;
}

async function getUserFromRequest(req: NextRequest) {
  const client = getSupabaseAdminClient();
  if (!client) return { error: toErrorResponse(500, "Supabase is not configured.") };

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: toErrorResponse(401, "Missing authentication token.") };
  }

  const token = authHeader.slice("Bearer ".length);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    return { error: toErrorResponse(401, "Invalid authentication token.") };
  }

  return { client, userId: data.user.id };
}

export async function GET(req: NextRequest) {
  const auth = await getUserFromRequest(req);
  if ("error" in auth) return auth.error;

  const { client, userId } = auth;
  const { data, error } = await client
    .from(SYNC_TABLE)
    .select("payload, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return toErrorResponse(500, error.message || "Failed to read synced data.");
  }

  const payload = data?.payload;
  if (payload && !isValidPayload(payload)) {
    return toErrorResponse(500, "Stored sync payload is invalid.");
  }

  return NextResponse.json({
    payload: payload || {},
    updatedAt: data?.updated_at || null,
  });
}

export async function PUT(req: NextRequest) {
  const auth = await getUserFromRequest(req);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return toErrorResponse(400, "Invalid JSON body.");
  }

  const payload = (body as { payload?: unknown })?.payload;
  if (!isValidPayload(payload)) {
    return toErrorResponse(400, "Payload must be a map of localStorage string values.");
  }

  const { client, userId } = auth;
  const { error } = await client.from(SYNC_TABLE).upsert(
    {
      user_id: userId,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return toErrorResponse(500, error.message || "Failed to save synced data.");
  }

  return NextResponse.json({ ok: true, updatedAt: new Date().toISOString() });
}
