"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import MuscleModel from "@/components/MuscleModel";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { WorkoutPlannerPayload } from "@/lib/types";
import { computeMuscleFatigue, emptyWorkoutPayload } from "@/lib/workouts";

export default function WorkoutFatigueCard() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [payload, setPayload] = useState<WorkoutPlannerPayload>(emptyWorkoutPayload());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
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
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!session || !supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("No Supabase session.");

        const response = await fetch("/api/workout-planner", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await response.json()) as {
          error?: string;
          payload?: WorkoutPlannerPayload;
        };
        if (!response.ok) throw new Error(json.error || "Failed to fetch workouts.");
        if (!cancelled) setPayload(json.payload || emptyWorkoutPayload());
      } catch (loadError: unknown) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to fetch workouts.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const onRefresh = () => load();
    window.addEventListener("study-stats:refresh-all", onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener("study-stats:refresh-all", onRefresh);
    };
  }, [session, supabase]);

  if (!supabase) return null;

  if (!session) {
    return (
      <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
        <h2 className="text-lg font-semibold mb-2">Workout Fatigue</h2>
        <p className="text-sm text-zinc-500">
          Sign in to Supabase (`☁️ Account Sync`) to see fatigue from your workout logs.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
        <div className="h-28 flex items-center justify-center text-zinc-400 animate-pulse">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-red-200 dark:border-red-900">
        <h2 className="text-lg font-semibold mb-2">Workout Fatigue</h2>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  const scores = computeMuscleFatigue(payload);

  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <MuscleModel scores={scores} title="Muscle Fatigue (Recovery-Weighted)" compact />
    </div>
  );
}
