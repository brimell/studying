"use client";

import { useMemo } from "react";
import MuscleModel from "@/components/MuscleModel";
import { useWorkoutData } from "@/components/WorkoutDataProvider";
import { computeMuscleFatigue } from "@/lib/workouts";

export default function WorkoutFatigueCard() {
  const { supabase, session, payload, loading, error } = useWorkoutData();
  const scores = useMemo(() => computeMuscleFatigue(payload), [payload]);

  if (!supabase) return null;

  if (!session) {
    return (
      <div className="surface-card p-6">
        <h2 className="text-lg font-semibold mb-2">Workout Fatigue</h2>
        <p className="text-sm text-zinc-500">
          Sign in to Supabase (`☁️ Account Sync`) to see fatigue from your workout logs.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="surface-card p-6">
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

  return (
    <div className="surface-card p-6">
      <MuscleModel scores={scores} title="Muscle Fatigue (Recovery-Weighted)" compact />
    </div>
  );
}
