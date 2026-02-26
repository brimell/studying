import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_SYNC_TABLE: z.string().min(1).optional(),
  SUPABASE_WORKOUT_TABLE: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  NEXTAUTH_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  ALERT_FROM_EMAIL: z.string().email().optional(),
  ALERT_TO_EMAIL: z.string().email().optional(),
  CALENDAR_IDS: z.string().optional(),
  HABIT_TRACKER_CALENDAR_ID: z.string().optional(),
});

const parsedEnv = serverEnvSchema.safeParse(process.env);
if (!parsedEnv.success) {
  const details = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment variables: ${details}`);
}

const env = parsedEnv.data;

function requireEnvValue(key: keyof typeof env): string {
  const value = env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export function getGoogleAuthEnv() {
  return {
    clientId: requireEnvValue("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnvValue("GOOGLE_CLIENT_SECRET"),
    nextAuthSecret: requireEnvValue("NEXTAUTH_SECRET"),
  };
}

export function getSupabaseAdminEnv() {
  return {
    url: requireEnvValue("NEXT_PUBLIC_SUPABASE_URL"),
    serviceRoleKey: requireEnvValue("SUPABASE_SERVICE_ROLE_KEY"),
    syncTable: env.SUPABASE_SYNC_TABLE || "study_stats_user_sync",
    workoutTable: env.SUPABASE_WORKOUT_TABLE || "study_stats_workout_planner",
  };
}

export function getAlertEmailEnv() {
  return {
    resendApiKey: env.RESEND_API_KEY,
    alertFromEmail: env.ALERT_FROM_EMAIL,
    alertToEmail: env.ALERT_TO_EMAIL,
  };
}

export const serverEnv = env;
