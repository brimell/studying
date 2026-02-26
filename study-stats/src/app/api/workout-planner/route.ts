import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  defaultWorkoutPlannerPayload,
  emptyWorkoutPayload,
  sanitizeWorkoutPayload,
} from "@/lib/workouts";

const WORKOUT_TABLE = process.env.SUPABASE_WORKOUT_TABLE || "study_stats_workout_planner";

function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

function toErrorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
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
    .from(WORKOUT_TABLE)
    .select("payload, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return toErrorResponse(500, error.message || "Failed to read workout data.");
  }

  if (!data) {
    const seeded = defaultWorkoutPlannerPayload();
    return NextResponse.json({
      payload: seeded,
      updatedAt: null,
    });
  }

  const payload = sanitizeWorkoutPayload(data?.payload || emptyWorkoutPayload());
  return NextResponse.json({
    payload,
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

  const inputPayload = (body as { payload?: unknown })?.payload;
  const payload = sanitizeWorkoutPayload(inputPayload);
  payload.updatedAt = new Date().toISOString();

  const { client, userId } = auth;
  const { error } = await client.from(WORKOUT_TABLE).upsert(
    {
      user_id: userId,
      payload,
      updated_at: payload.updatedAt,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return toErrorResponse(500, error.message || "Failed to save workout data.");
  }

  return NextResponse.json({ ok: true, payload, updatedAt: payload.updatedAt });
}
