"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { WorkoutPlannerPayload } from "@/lib/types";
import {
  defaultWorkoutPlannerPayload,
  emptyWorkoutPayload,
  forceApplyDefaultTemplates,
  sanitizeWorkoutPayload,
} from "@/lib/workouts";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type WorkoutApiMethod = "GET" | "PUT";

interface WorkoutDataContextValue {
  supabase: SupabaseClient | null;
  session: Session | null;
  payload: WorkoutPlannerPayload;
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  savePayload: (nextPayload: WorkoutPlannerPayload) => Promise<WorkoutPlannerPayload>;
}

const WorkoutDataContext = createContext<WorkoutDataContextValue | null>(null);
const WORKOUT_LOCAL_STORAGE_KEY = "study-stats.workout-planner.local-payload.v1";

function normalizeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

function readLocalWorkoutPayload(): WorkoutPlannerPayload {
  if (typeof window === "undefined") return defaultWorkoutPlannerPayload();
  const raw = window.localStorage.getItem(WORKOUT_LOCAL_STORAGE_KEY);
  if (!raw) return defaultWorkoutPlannerPayload();
  try {
    const parsed = JSON.parse(raw) as unknown;
    const sanitized = sanitizeWorkoutPayload(parsed);
    return forceApplyDefaultTemplates(sanitized).payload;
  } catch {
    return defaultWorkoutPlannerPayload();
  }
}

function writeLocalWorkoutPayload(payload: WorkoutPlannerPayload) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WORKOUT_LOCAL_STORAGE_KEY, JSON.stringify(payload));
}

export function WorkoutDataProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [payload, setPayload] = useState<WorkoutPlannerPayload>(defaultWorkoutPlannerPayload());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callApi = useCallback(
    async (method: WorkoutApiMethod, nextPayload?: WorkoutPlannerPayload): Promise<WorkoutPlannerPayload> => {
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in to Supabase to sync workouts.");

      const response = await fetch("/api/workout-planner", {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(method === "PUT" ? { "Content-Type": "application/json" } : {}),
        },
        body: method === "PUT" ? JSON.stringify({ payload: nextPayload }) : undefined,
      });

      const json = (await response.json()) as {
        error?: string;
        payload?: WorkoutPlannerPayload;
      };
      if (!response.ok) throw new Error(json.error || "Workout request failed.");
      return json.payload || emptyWorkoutPayload();
    },
    [supabase]
  );

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const localPayload = readLocalWorkoutPayload();
      setPayload(localPayload);

      if (session && supabase) {
        const nextPayload = await callApi("GET");
        setPayload(nextPayload);
        writeLocalWorkoutPayload(nextPayload);
      }
    } catch (refreshError: unknown) {
      setError(normalizeErrorMessage(refreshError, "Failed to load workout planner."));
    } finally {
      setLoading(false);
    }
  }, [callApi, session, supabase]);

  const savePayload = useCallback(
    async (nextPayload: WorkoutPlannerPayload): Promise<WorkoutPlannerPayload> => {
      const nextLocal = forceApplyDefaultTemplates(sanitizeWorkoutPayload(nextPayload)).payload;
      nextLocal.updatedAt = new Date().toISOString();
      try {
        setSaving(true);
        setError(null);

        // Local storage is always source-of-truth, even when not signed in.
        setPayload(nextLocal);
        writeLocalWorkoutPayload(nextLocal);

        if (session && supabase) {
          const saved = await callApi("PUT", nextLocal);
          setPayload(saved);
          writeLocalWorkoutPayload(saved);
          return saved;
        }

        return nextLocal;
      } catch (saveError: unknown) {
        // Preserve local save success while reporting cloud-sync failure.
        const message = normalizeErrorMessage(
          saveError,
          "Saved locally, but cloud sync for workout planner failed."
        );
        setError(message);
        return nextLocal;
      } finally {
        setSaving(false);
      }
    },
    [callApi, session, supabase]
  );

  useEffect(() => {
    if (!supabase) {
      setPayload(readLocalWorkoutPayload());
      setSession(null);
      setLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setError(null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onRefreshAll = () => {
      void refresh();
    };
    window.addEventListener("study-stats:refresh-all", onRefreshAll);
    return () => window.removeEventListener("study-stats:refresh-all", onRefreshAll);
  }, [refresh]);

  const value = useMemo<WorkoutDataContextValue>(
    () => ({
      supabase,
      session,
      payload,
      loading,
      saving,
      error,
      refresh,
      savePayload,
    }),
    [supabase, session, payload, loading, saving, error, refresh, savePayload]
  );

  return <WorkoutDataContext.Provider value={value}>{children}</WorkoutDataContext.Provider>;
}

export function useWorkoutData(): WorkoutDataContextValue {
  const context = useContext(WorkoutDataContext);
  if (!context) throw new Error("useWorkoutData must be used within WorkoutDataProvider.");
  return context;
}
