import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const PROJECTION_TABLE = process.env.SUPABASE_STUDY_PROJECTION_TABLE || "study_stats_projection";
type SupabaseAdminClient = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
type AuthResult =
  | { error: NextResponse<{ error: string }> }
  | { client: SupabaseAdminClient; userId: string };

function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

function isRecoverableStorageError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = (error.message || "").toLowerCase();
  return message.includes("does not exist") || message.includes("relation");
}

function toErrorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

async function getUserFromRequest(req: NextRequest): Promise<AuthResult> {
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

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(req: NextRequest) {
  const auth = await getUserFromRequest(req);
  if ("error" in auth) {
    const errorResponse = auth.error;
    const isConfigMissing = errorResponse.status === 500;
    if (isConfigMissing) {
      return NextResponse.json({
        endDate: null,
        hoursPerDay: null,
        updatedAt: null,
        cloudDisabled: true,
      });
    }
    return errorResponse;
  }

  const { client, userId } = auth;
  const { data, error } = await client
    .from(PROJECTION_TABLE)
    .select("end_date, hours_per_day, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isRecoverableStorageError(error)) {
      return NextResponse.json({
        endDate: null,
        hoursPerDay: null,
        updatedAt: null,
        cloudDisabled: true,
      });
    }
    return toErrorResponse(500, error.message || "Failed to read study projection.");
  }

  return NextResponse.json({
    endDate: data?.end_date || null,
    hoursPerDay: typeof data?.hours_per_day === "number" ? data.hours_per_day : null,
    updatedAt: data?.updated_at || null,
  });
}

export async function PUT(req: NextRequest) {
  const auth = await getUserFromRequest(req);
  if ("error" in auth) {
    const errorResponse = auth.error;
    const isConfigMissing = errorResponse.status === 500;
    if (isConfigMissing) {
      return NextResponse.json({ ok: false, cloudDisabled: true });
    }
    return errorResponse;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return toErrorResponse(400, "Invalid JSON body.");
  }

  const endDate = String((body as { endDate?: unknown }).endDate || "");
  const hoursPerDay = Number((body as { hoursPerDay?: unknown }).hoursPerDay);
  if (!isDateKey(endDate)) {
    return toErrorResponse(400, "endDate must be YYYY-MM-DD.");
  }
  if (!Number.isFinite(hoursPerDay) || hoursPerDay < 0 || hoursPerDay > 24) {
    return toErrorResponse(400, "hoursPerDay must be between 0 and 24.");
  }

  const { client, userId } = auth;
  const updatedAt = new Date().toISOString();
  const { error } = await client.from(PROJECTION_TABLE).upsert(
    {
      user_id: userId,
      end_date: endDate,
      hours_per_day: Math.round(hoursPerDay * 100) / 100,
      updated_at: updatedAt,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    if (isRecoverableStorageError(error)) {
      return NextResponse.json({
        ok: false,
        endDate,
        hoursPerDay,
        updatedAt,
        cloudDisabled: true,
      });
    }
    return toErrorResponse(500, error.message || "Failed to save study projection.");
  }

  return NextResponse.json({
    ok: true,
    endDate,
    hoursPerDay: Math.round(hoursPerDay * 100) / 100,
    updatedAt,
  });
}
