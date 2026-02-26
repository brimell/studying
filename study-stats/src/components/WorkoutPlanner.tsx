"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import MuscleModel from "@/components/MuscleModel";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type {
  MuscleGroup,
  WorkoutExercise,
  WorkoutLogEntry,
  WorkoutPlannerPayload,
  WorkoutTemplate,
} from "@/lib/types";
import { MUSCLE_GROUPS } from "@/lib/types";
import { computeMuscleFatigue, emptyWorkoutPayload, MUSCLE_LABELS } from "@/lib/workouts";

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_EXERCISE_MUSCLES: MuscleGroup[] = ["chest"];

export default function WorkoutPlanner() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [payload, setPayload] = useState<WorkoutPlannerPayload>(emptyWorkoutPayload());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newWorkoutName, setNewWorkoutName] = useState("");
  const [draftExercises, setDraftExercises] = useState<WorkoutExercise[]>([]);
  const [exerciseName, setExerciseName] = useState("");
  const [exerciseSets, setExerciseSets] = useState(3);
  const [exerciseReps, setExerciseReps] = useState(10);
  const [exerciseMuscles, setExerciseMuscles] = useState<MuscleGroup[]>(DEFAULT_EXERCISE_MUSCLES);

  const [logDateByWorkout, setLogDateByWorkout] = useState<Record<string, string>>({});

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

  const callApi = async (method: "GET" | "PUT", nextPayload?: WorkoutPlannerPayload) => {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Sign in to Supabase to save workouts.");

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

    if (!response.ok) throw new Error(json.error || "Request failed.");
    return json.payload || emptyWorkoutPayload();
  };

  useEffect(() => {
    if (!session) {
      setLoading(false);
      setPayload(emptyWorkoutPayload());
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        setError(null);
        setLoading(true);
        const nextPayload = await callApi("GET");
        if (!cancelled) setPayload(nextPayload);
      } catch (loadError: unknown) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load workout planner.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const persist = async (nextPayload: WorkoutPlannerPayload, successMessage?: string) => {
    try {
      setSaving(true);
      setError(null);
      setMessage(null);
      const saved = await callApi("PUT", nextPayload);
      setPayload(saved);
      if (successMessage) setMessage(successMessage);
    } catch (persistError: unknown) {
      setError(persistError instanceof Error ? persistError.message : "Failed to save workout data.");
    } finally {
      setSaving(false);
    }
  };

  const addExerciseToDraft = () => {
    const name = exerciseName.trim();
    if (!name || exerciseMuscles.length === 0) return;

    const next: WorkoutExercise = {
      id: generateId(),
      name,
      muscles: exerciseMuscles,
      sets: Math.max(1, Math.min(30, exerciseSets)),
      reps: Math.max(1, Math.min(100, exerciseReps)),
    };
    setDraftExercises((previous) => [...previous, next]);
    setExerciseName("");
    setExerciseSets(3);
    setExerciseReps(10);
    setExerciseMuscles(DEFAULT_EXERCISE_MUSCLES);
  };

  const removeDraftExercise = (exerciseId: string) => {
    setDraftExercises((previous) => previous.filter((exercise) => exercise.id !== exerciseId));
  };

  const saveWorkout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newWorkoutName.trim();
    if (!name || draftExercises.length === 0) return;

    const workout: WorkoutTemplate = {
      id: generateId(),
      name,
      createdAt: new Date().toISOString(),
      exercises: draftExercises,
    };

    const nextPayload: WorkoutPlannerPayload = {
      ...payload,
      workouts: [workout, ...payload.workouts],
      updatedAt: new Date().toISOString(),
    };

    await persist(nextPayload, `Saved workout "${name}".`);
    setNewWorkoutName("");
    setDraftExercises([]);
  };

  const removeWorkout = async (workoutId: string) => {
    const workout = payload.workouts.find((entry) => entry.id === workoutId);
    if (!workout) return;

    const confirmed = window.confirm(
      `Delete "${workout.name}" and all logs linked to it?`
    );
    if (!confirmed) return;

    const nextPayload: WorkoutPlannerPayload = {
      ...payload,
      workouts: payload.workouts.filter((entry) => entry.id !== workoutId),
      logs: payload.logs.filter((log) => log.workoutId !== workoutId),
      updatedAt: new Date().toISOString(),
    };
    await persist(nextPayload, `Deleted workout "${workout.name}".`);
  };

  const logWorkout = async (workout: WorkoutTemplate) => {
    const date = logDateByWorkout[workout.id] || todayDateKey();
    const nextLog: WorkoutLogEntry = {
      id: generateId(),
      workoutId: workout.id,
      performedOn: date,
    };
    const nextPayload: WorkoutPlannerPayload = {
      ...payload,
      logs: [nextLog, ...payload.logs].sort((a, b) => b.performedOn.localeCompare(a.performedOn)),
      updatedAt: new Date().toISOString(),
    };
    await persist(nextPayload, `Logged "${workout.name}" on ${date}.`);
  };

  const removeLog = async (logId: string) => {
    const nextPayload: WorkoutPlannerPayload = {
      ...payload,
      logs: payload.logs.filter((log) => log.id !== logId),
      updatedAt: new Date().toISOString(),
    };
    await persist(nextPayload, "Workout log removed.");
  };

  const fatigueScores = useMemo(() => computeMuscleFatigue(payload), [payload]);
  const draftMuscleScores = useMemo(() => {
    const workout: WorkoutTemplate = {
      id: "draft",
      name: "Draft",
      createdAt: new Date().toISOString(),
      exercises: draftExercises,
    };
    const draftPayload: WorkoutPlannerPayload = {
      workouts: [workout],
      logs: [
        {
          id: "draft-log",
          workoutId: "draft",
          performedOn: todayDateKey(),
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    return computeMuscleFatigue(draftPayload);
  }, [draftExercises]);
  const workoutById = useMemo(
    () => new Map(payload.workouts.map((workout) => [workout.id, workout])),
    [payload.workouts]
  );

  if (!supabase) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5">
        <p className="text-sm text-zinc-500">
          Supabase is not configured. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5">
        <h2 className="text-lg font-semibold mb-2">Workout Planner</h2>
        <p className="text-sm text-zinc-500">
          Sign in via `☁️ Account Sync` to save workouts in Supabase and sync across devices.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
        <h1 className="text-2xl font-bold">Workout Planner</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Build workouts, track sessions by date, and monitor muscle fatigue.
        </p>
      </div>

      {(loading || saving) && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2 text-sm text-zinc-500">
          {loading ? "Loading planner..." : "Saving..."}
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {message && <p className="text-sm text-emerald-600">{message}</p>}

      <MuscleModel scores={fatigueScores} title="Current Muscle Fatigue (Last 7 Days)" />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="rounded-2xl bg-white dark:bg-zinc-900 p-5 shadow-sm border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">Create Workout</h2>
          <div className="mb-3">
            <MuscleModel scores={draftMuscleScores} title="Draft Workout Muscle Targets" compact />
          </div>
          <form onSubmit={saveWorkout} className="space-y-3">
            <input
              type="text"
              value={newWorkoutName}
              onChange={(event) => setNewWorkoutName(event.target.value)}
              placeholder="Workout name (e.g. Push Day)"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
            />

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
              <p className="text-sm font-medium">Add Exercise</p>
              <input
                type="text"
                value={exerciseName}
                onChange={(event) => setExerciseName(event.target.value)}
                placeholder="Exercise name"
                className="w-full border rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={exerciseSets}
                  min={1}
                  max={30}
                  onChange={(event) => setExerciseSets(Number(event.target.value))}
                  placeholder="Sets"
                  className="border rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
                />
                <input
                  type="number"
                  value={exerciseReps}
                  min={1}
                  max={100}
                  onChange={(event) => setExerciseReps(Number(event.target.value))}
                  placeholder="Reps"
                  className="border rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {MUSCLE_GROUPS.map((muscle) => (
                  <label key={muscle} className="text-xs flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={exerciseMuscles.includes(muscle)}
                      onChange={(event) => {
                        setExerciseMuscles((previous) =>
                          event.target.checked
                            ? [...previous, muscle]
                            : previous.filter((entry) => entry !== muscle)
                        );
                      }}
                    />
                    <span>{MUSCLE_LABELS[muscle]}</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={addExerciseToDraft}
                className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
              >
                Add Exercise
              </button>
            </div>

            <div className="space-y-2">
              {draftExercises.length === 0 && (
                <p className="text-xs text-zinc-500">No exercises added yet.</p>
              )}
              {draftExercises.map((exercise) => (
                <div
                  key={exercise.id}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{exercise.name}</p>
                    <button
                      type="button"
                      onClick={() => removeDraftExercise(exercise.id)}
                      className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700"
                    >
                      🗑️
                    </button>
                  </div>
                  <p className="text-zinc-500">
                    {exercise.sets} sets x {exercise.reps} reps •{" "}
                    {exercise.muscles.map((muscle) => MUSCLE_LABELS[muscle]).join(", ")}
                  </p>
                </div>
              ))}
            </div>

            <button
              type="submit"
              disabled={!newWorkoutName.trim() || draftExercises.length === 0 || saving}
              className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              Save Workout
            </button>
          </form>
        </section>

        <section className="rounded-2xl bg-white dark:bg-zinc-900 p-5 shadow-sm border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">Saved Workouts</h2>
          <div className="space-y-3">
            {payload.workouts.length === 0 && (
              <p className="text-sm text-zinc-500">No workouts saved yet.</p>
            )}
            {payload.workouts.map((workout) => (
              <div key={workout.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{workout.name}</p>
                  <button
                    type="button"
                    onClick={() => removeWorkout(workout.id)}
                    className="px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700"
                  >
                    🗑️
                  </button>
                </div>
                <div className="mt-2 space-y-1">
                  {workout.exercises.map((exercise) => (
                    <p key={exercise.id} className="text-xs text-zinc-500">
                      {exercise.name}: {exercise.sets}x{exercise.reps} •{" "}
                      {exercise.muscles.map((muscle) => MUSCLE_LABELS[muscle]).join(", ")}
                    </p>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="date"
                    value={logDateByWorkout[workout.id] || todayDateKey()}
                    onChange={(event) =>
                      setLogDateByWorkout((previous) => ({
                        ...previous,
                        [workout.id]: event.target.value,
                      }))
                    }
                    className="border rounded-lg px-2 py-1 text-xs bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
                  />
                  <button
                    type="button"
                    onClick={() => logWorkout(workout)}
                    disabled={saving}
                    className="px-2 py-1 rounded-md text-xs bg-emerald-500 hover:bg-emerald-600 text-white"
                  >
                    Log Workout
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl bg-white dark:bg-zinc-900 p-5 shadow-sm border border-zinc-200 dark:border-zinc-800">
        <h2 className="text-lg font-semibold mb-3">Workout History</h2>
        <div className="space-y-2">
          {payload.logs.length === 0 && <p className="text-sm text-zinc-500">No logged workouts yet.</p>}
          {payload.logs.map((log) => {
            const workout = workoutById.get(log.workoutId);
            return (
              <div
                key={log.id}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 flex items-center justify-between gap-2"
              >
                <div>
                  <p className="text-sm font-medium">{workout?.name || "Deleted workout"}</p>
                  <p className="text-xs text-zinc-500">{log.performedOn}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeLog(log.id)}
                  className="px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700"
                >
                  🗑️
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
