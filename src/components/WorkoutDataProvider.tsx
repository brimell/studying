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
import { emptyWorkoutPayload } from "@/lib/workouts";
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

function normalizeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

export function WorkoutDataProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [payload, setPayload] = useState<WorkoutPlannerPayload>(emptyWorkoutPayload());
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
    if (!session) {
      setPayload(emptyWorkoutPayload());
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const nextPayload = await callApi("GET");
      setPayload(nextPayload);
    } catch (refreshError: unknown) {
      setError(normalizeErrorMessage(refreshError, "Failed to load workout planner."));
    } finally {
      setLoading(false);
    }
  }, [callApi, session]);

  const savePayload = useCallback(
    async (nextPayload: WorkoutPlannerPayload): Promise<WorkoutPlannerPayload> => {
      try {
        setSaving(true);
        setError(null);
        const saved = await callApi("PUT", nextPayload);
        setPayload(saved);
        return saved;
      } catch (saveError: unknown) {
        const message = normalizeErrorMessage(saveError, "Failed to save workout planner.");
        setError(message);
        throw new Error(message);
      } finally {
        setSaving(false);
      }
    },
    [callApi]
  );

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setSession(null);
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
    if (!session) return;
    const onRefreshAll = () => {
      void refresh();
    };
    window.addEventListener("study-stats:refresh-all", onRefreshAll);
    return () => window.removeEventListener("study-stats:refresh-all", onRefreshAll);
  }, [refresh, session]);

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
