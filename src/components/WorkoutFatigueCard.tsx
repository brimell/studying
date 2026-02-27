"use client";

import { useMemo } from "react";
import MuscleModel from "@/components/MuscleModel";
import LoadingIcon from "@/components/LoadingIcon";
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

  if (error) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm border border-red-200">
        <h2 className="text-lg font-semibold mb-2">Workout Fatigue</h2>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="surface-card p-6 relative">
      {loading && (
        <div className="absolute top-3 right-3 z-10">
          <span className="pill-btn text-[11px] px-2 py-1 stat-mono">Updating...</span>
        </div>
      )}
      {loading && !payload.logs.length && !payload.workouts.length ? (
        <div className="h-28 flex items-center justify-center">
          <LoadingIcon />
        </div>
      ) : (
        <MuscleModel scores={scores} title="Muscle Fatigue (Recovery-Weighted)" compact />
      )}
    </div>
  );
}
