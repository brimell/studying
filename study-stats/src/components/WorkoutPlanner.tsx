"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import MuscleModel from "@/components/MuscleModel";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type {
  MuscleGroup,
  WorkoutWeekDay,
  WeeklyWorkoutPlan,
  WorkoutExercise,
  WorkoutLogEntry,
  WorkoutPlannerPayload,
  WorkoutTemplate,
} from "@/lib/types";
import { MUSCLE_GROUPS, WORKOUT_WEEK_DAYS } from "@/lib/types";
import { computeMuscleFatigue, emptyWorkoutPayload, MUSCLE_LABELS } from "@/lib/workouts";

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";
const HABIT_WORKOUT_LINKS_STORAGE_KEY = "study-stats.habit-tracker.workout-links";

const DEFAULT_EXERCISE_MUSCLES: MuscleGroup[] = ["chest"];

const WEEKDAY_LABELS: Record<WorkoutWeekDay, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

function emptyWeeklyPlanDays(): Record<WorkoutWeekDay, string[]> {
  return {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
}

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
  const [showCreateWorkoutModal, setShowCreateWorkoutModal] = useState(false);
  const [weeklyPlanName, setWeeklyPlanName] = useState("");
  const [weeklyPlanDays, setWeeklyPlanDays] = useState<Record<WorkoutWeekDay, string[]>>(
    emptyWeeklyPlanDays()
  );
  const [editingWeeklyPlanId, setEditingWeeklyPlanId] = useState<string | null>(null);

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

  const getTrackerCalendarId = async (): Promise<string | null> => {
    const stored = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
    if (stored) return stored;

    try {
      const response = await fetch("/api/habit-tracker/calendars");
      const payload = (await response.json()) as {
        defaultTrackerCalendarId?: string | null;
        trackerCalendars?: { id: string }[];
      };
      if (!response.ok) return null;
      const resolvedId =
        payload.defaultTrackerCalendarId || payload.trackerCalendars?.[0]?.id || null;
      if (resolvedId) window.localStorage.setItem(TRACKER_CALENDAR_STORAGE_KEY, resolvedId);
      return resolvedId;
    } catch {
      return null;
    }
  };

  const syncWorkoutLogToGymHabit = async (date: string): Promise<{
    synced: number;
    failed: string[];
  }> => {
    const linkedHabitNames = (() => {
      const raw = window.localStorage.getItem(HABIT_WORKOUT_LINKS_STORAGE_KEY);
      if (!raw) return ["Gym"];
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return ["Gym"];
        const names = Object.values(parsed as Record<string, unknown>)
          .map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
            const value = entry as { name?: unknown; enabled?: unknown };
            if (typeof value.name !== "string") return null;
            if (value.enabled !== true) return null;
            const normalized = value.name.trim();
            return normalized || null;
          })
          .filter((name): name is string => Boolean(name));
        return names.length > 0 ? [...new Set(names)] : [];
      } catch {
        return ["Gym"];
      }
    })();

    if (linkedHabitNames.length === 0) return { synced: 0, failed: [] };

    const trackerCalendarId = await getTrackerCalendarId();
    if (!trackerCalendarId) {
      return { synced: 0, failed: linkedHabitNames };
    }

    const results = await Promise.allSettled(
      linkedHabitNames.map(async (habitName) => {
        const response = await fetch("/api/habit-tracker", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            trackerCalendarId,
            habitName,
            habitMode: "binary",
            date,
            completed: true,
            hours: 1,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || `Failed to sync "${habitName}"`);
        }

        return habitName;
      })
    );

    const failed: string[] = [];
    let synced = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        synced += 1;
      } else {
        failed.push(result.reason instanceof Error ? result.reason.message : "Habit sync failed");
      }
    }

    if (synced > 0) {
      window.dispatchEvent(new CustomEvent("study-stats:refresh-all"));
    }

    return { synced, failed };
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
    setShowCreateWorkoutModal(false);
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
      weeklyPlans: payload.weeklyPlans.map((plan) => {
        const days = { ...plan.days };
        for (const day of WORKOUT_WEEK_DAYS) {
          days[day] = days[day].filter((id) => id !== workoutId);
        }
        return {
          ...plan,
          days,
        };
      }),
      updatedAt: new Date().toISOString(),
    };
    await persist(nextPayload, `Deleted workout "${workout.name}".`);
  };

  const saveWeeklyPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = weeklyPlanName.trim();
    if (!name) return;

    const hasAssignedDay = WORKOUT_WEEK_DAYS.some((day) => weeklyPlanDays[day].length > 0);
    if (!hasAssignedDay) {
      setError("Assign at least one day to a workout before saving a weekly plan.");
      return;
    }

    const nextWeeklyPlans = (() => {
      if (!editingWeeklyPlanId) {
        const plan: WeeklyWorkoutPlan = {
          id: generateId(),
          name,
          days: { ...weeklyPlanDays },
          createdAt: new Date().toISOString(),
        };
        return [plan, ...payload.weeklyPlans];
      }

      return payload.weeklyPlans.map((plan) =>
        plan.id === editingWeeklyPlanId
          ? {
              ...plan,
              name,
              days: { ...weeklyPlanDays },
            }
          : plan
      );
    })();

    const nextPayload: WorkoutPlannerPayload = {
      ...payload,
      weeklyPlans: nextWeeklyPlans,
      updatedAt: new Date().toISOString(),
    };

    await persist(
      nextPayload,
      editingWeeklyPlanId
        ? `Updated weekly plan "${name}".`
        : `Saved weekly plan "${name}".`
    );
    setEditingWeeklyPlanId(null);
    setWeeklyPlanName("");
    setWeeklyPlanDays(emptyWeeklyPlanDays());
  };

  const startEditingWeeklyPlan = (plan: WeeklyWorkoutPlan) => {
    setEditingWeeklyPlanId(plan.id);
    setWeeklyPlanName(plan.name);
    setWeeklyPlanDays({ ...plan.days });
  };

  const cancelEditingWeeklyPlan = () => {
    setEditingWeeklyPlanId(null);
    setWeeklyPlanName("");
    setWeeklyPlanDays(emptyWeeklyPlanDays());
  };

  const removeWeeklyPlan = async (planId: string) => {
    const target = payload.weeklyPlans.find((plan) => plan.id === planId);
    if (!target) return;

    const confirmed = window.confirm(`Delete weekly plan "${target.name}"?`);
    if (!confirmed) return;

    const nextPayload: WorkoutPlannerPayload = {
      ...payload,
      weeklyPlans: payload.weeklyPlans.filter((plan) => plan.id !== planId),
      updatedAt: new Date().toISOString(),
    };

    await persist(nextPayload, `Deleted weekly plan "${target.name}".`);
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
    const syncResult = await syncWorkoutLogToGymHabit(date);
    if (syncResult.failed.length > 0) {
      setError(
        `Workout logged, but habit sync had issues: ${syncResult.failed.slice(0, 2).join("; ")}`
      );
    } else if (syncResult.synced > 0) {
      setMessage(`Logged "${workout.name}" on ${date} and synced ${syncResult.synced} linked habit(s).`);
    }
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
      weeklyPlans: [],
      updatedAt: new Date().toISOString(),
    };
    return computeMuscleFatigue(draftPayload);
  }, [draftExercises]);
  const workoutById = useMemo(
    () => new Map(payload.workouts.map((workout) => [workout.id, workout])),
    [payload.workouts]
  );
  const workoutScoresById = useMemo(() => {
    const scoreMap = new Map<string, Record<MuscleGroup, number>>();
    const today = todayDateKey();

    for (const workout of payload.workouts) {
      const singleWorkoutPayload: WorkoutPlannerPayload = {
        workouts: [workout],
        logs: [
          {
            id: `preview-${workout.id}`,
            workoutId: workout.id,
            performedOn: today,
          },
        ],
        weeklyPlans: [],
        updatedAt: new Date().toISOString(),
      };

      scoreMap.set(workout.id, computeMuscleFatigue(singleWorkoutPayload));
    }

    return scoreMap;
  }, [payload.workouts]);
  const weeklyPlanSummaries = useMemo(() => {
    const summaries = new Map<
      string,
      {
        scores: Record<MuscleGroup, number>;
        totalByMuscle: Record<MuscleGroup, number>;
        hitDaysByMuscle: Record<MuscleGroup, number>;
        totalLoad: number;
      }
    >();

    for (const plan of payload.weeklyPlans) {
      const totalByMuscle: Record<MuscleGroup, number> = {
        chest: 0,
        back: 0,
        shoulders: 0,
        biceps: 0,
        triceps: 0,
        forearms: 0,
        core: 0,
        glutes: 0,
        quads: 0,
        hamstrings: 0,
        calves: 0,
      };
      const hitDaysByMuscle: Record<MuscleGroup, number> = {
        chest: 0,
        back: 0,
        shoulders: 0,
        biceps: 0,
        triceps: 0,
        forearms: 0,
        core: 0,
        glutes: 0,
        quads: 0,
        hamstrings: 0,
        calves: 0,
      };

      for (const day of WORKOUT_WEEK_DAYS) {
        const workoutIds = plan.days[day];
        if (workoutIds.length === 0) continue;

        const hitToday = new Set<MuscleGroup>();
        for (const workoutId of workoutIds) {
          const workout = workoutById.get(workoutId);
          if (!workout) continue;

          for (const exercise of workout.exercises) {
            const load = Math.max(1, exercise.sets * exercise.reps);
            for (const muscle of exercise.muscles) {
              totalByMuscle[muscle] += load;
              hitToday.add(muscle);
            }
          }
        }
        for (const muscle of hitToday) {
          hitDaysByMuscle[muscle] += 1;
        }
      }

      const totalLoad = MUSCLE_GROUPS.reduce((sum, muscle) => sum + totalByMuscle[muscle], 0);
      const scores: Record<MuscleGroup, number> = {
        chest: 0,
        back: 0,
        shoulders: 0,
        biceps: 0,
        triceps: 0,
        forearms: 0,
        core: 0,
        glutes: 0,
        quads: 0,
        hamstrings: 0,
        calves: 0,
      };

      for (const muscle of MUSCLE_GROUPS) {
        scores[muscle] = totalLoad > 0 ? Math.round((totalByMuscle[muscle] / totalLoad) * 100) : 0;
      }

      summaries.set(plan.id, {
        scores,
        totalByMuscle,
        hitDaysByMuscle,
        totalLoad,
      });
    }

    return summaries;
  }, [payload.weeklyPlans, workoutById]);

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
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Workout Planner</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Build workouts, track sessions by date, and monitor muscle fatigue.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateWorkoutModal(true)}
            className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium transition-colors"
          >
            Create Workout
          </button>
        </div>
      </div>

      {(loading || saving) && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2 text-sm text-zinc-500">
          {loading ? "Loading planner..." : "Saving..."}
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {message && <p className="text-sm text-emerald-600">{message}</p>}

      <MuscleModel scores={fatigueScores} title="Current Muscle Fatigue (Recovery-Weighted)" />

      <div className="grid grid-cols-1 gap-5">
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
                <div className="mt-3">
                  <MuscleModel
                    scores={workoutScoresById.get(workout.id) || fatigueScores}
                    title="Workout Muscle Targets"
                    compact
                  />
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

        <section className="rounded-2xl bg-white dark:bg-zinc-900 p-5 shadow-sm border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">Weekly Workout Plans</h2>

          <form onSubmit={saveWeeklyPlan} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-3">
            <input
              type="text"
              value={weeklyPlanName}
              onChange={(event) => setWeeklyPlanName(event.target.value)}
              placeholder="Plan name (e.g. Weekly Push/Pull/Legs)"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {WORKOUT_WEEK_DAYS.map((day) => (
                <div key={day} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-2 text-xs">
                  <p className="font-medium mb-1">{WEEKDAY_LABELS[day]}</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                    {payload.workouts.length === 0 && <p className="text-zinc-500">No workouts</p>}
                    {payload.workouts.map((workout) => {
                      const checked = weeklyPlanDays[day].includes(workout.id);
                      return (
                        <label key={`${day}-${workout.id}`} className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setWeeklyPlanDays((previous) => ({
                                ...previous,
                                [day]: event.target.checked
                                  ? [...previous[day], workout.id]
                                  : previous[day].filter((id) => id !== workout.id),
                              }))
                            }
                          />
                          <span className="truncate">{workout.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={!weeklyPlanName.trim() || saving || payload.workouts.length === 0}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {editingWeeklyPlanId ? "Update Weekly Plan" : "Save Weekly Plan"}
              </button>
              {editingWeeklyPlanId && (
                <button
                  type="button"
                  onClick={cancelEditingWeeklyPlan}
                  className="px-4 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-sm font-medium"
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </form>

          <div className="mt-4 space-y-3">
            {payload.weeklyPlans.length === 0 && (
              <p className="text-sm text-zinc-500">No weekly plans saved yet.</p>
            )}

            {payload.weeklyPlans.map((plan) => {
              const summary = weeklyPlanSummaries.get(plan.id);
              const nonZeroMuscles = MUSCLE_GROUPS
                .map((muscle) => ({
                  muscle,
                  load: summary?.totalByMuscle[muscle] || 0,
                  hitDays: summary?.hitDaysByMuscle[muscle] || 0,
                  pct: summary?.scores[muscle] || 0,
                }))
                .filter((entry) => entry.load > 0)
                .sort((a, b) => b.load - a.load);
              const missingMuscles = MUSCLE_GROUPS.filter(
                (muscle) => (summary?.totalByMuscle[muscle] || 0) <= 0
              );

              return (
                <div key={plan.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{plan.name}</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEditingWeeklyPlan(plan)}
                        className="px-2 py-1 rounded-md text-xs bg-sky-500 hover:bg-sky-600 text-white"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeWeeklyPlan(plan.id)}
                        className="px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1 text-xs">
                    {WORKOUT_WEEK_DAYS.map((day) => {
                      const workoutNames = plan.days[day]
                        .map((workoutId) => workoutById.get(workoutId)?.name)
                        .filter((name): name is string => Boolean(name));
                      return (
                        <div key={`${plan.id}-${day}`} className="rounded-md bg-zinc-50 dark:bg-zinc-800 px-2 py-1">
                          <p className="font-medium">{WEEKDAY_LABELS[day]}</p>
                          <p className="text-zinc-500 truncate">
                            {workoutNames.length > 0 ? workoutNames.join(", ") : "Rest"}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3">
                    <MuscleModel
                      scores={summary?.scores || fatigueScores}
                      title="Weekly Muscle Groups Hit"
                      compact
                    />
                  </div>

                  <div className="mt-2 text-xs text-zinc-500">
                    Total weekly load: {summary?.totalLoad || 0}
                  </div>

                  <div className="mt-2 grid sm:grid-cols-2 gap-2">
                    {nonZeroMuscles.map(({ muscle, load, hitDays, pct }) => (
                      <div
                        key={`${plan.id}-${muscle}`}
                        className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span>{MUSCLE_LABELS[muscle]}</span>
                          <span className="font-medium">{pct}%</span>
                        </div>
                        <div className="text-zinc-500 mt-1">
                          Hit {hitDays} day{hitDays === 1 ? "" : "s"} • Load {load}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 px-3 py-2 text-xs">
                    <p className="font-medium text-amber-800 dark:text-amber-300">Missing muscle groups</p>
                    <p className="text-amber-700 dark:text-amber-400 mt-1">
                      {missingMuscles.length > 0
                        ? missingMuscles.map((muscle) => MUSCLE_LABELS[muscle]).join(", ")
                        : "None — all tracked muscle groups are hit in this plan."}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {showCreateWorkoutModal && (
        <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 p-5 shadow-xl border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-semibold">Create Workout</h2>
              <button
                type="button"
                onClick={() => setShowCreateWorkoutModal(false)}
                className="px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700"
              >
                Close
              </button>
            </div>

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
          </div>
        </div>
      )}

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
