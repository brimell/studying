"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MuscleModel from "@/components/MuscleModel";
import { useWorkoutData } from "@/components/WorkoutDataProvider";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/scroll-lock";
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
import {
  computeMuscleFatigue,
  EXERCISE_MUSCLE_MAP,
  getPolicyRestSeconds,
  LEG_EXERCISE_REST_SECONDS,
  MUSCLE_LABELS,
  STANDARD_REST_SECONDS,
  UI_MUSCLE_GROUPS,
} from "@/lib/workouts";
import {
  DAILY_TRACKER_ENTRIES_STORAGE_KEY,
  DAILY_TRACKER_UPDATED_EVENT,
  parseDailyTrackerEntries,
  type DailyTrackerEntry,
} from "@/lib/daily-tracker";

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";
const HABIT_WORKOUT_LINKS_STORAGE_KEY = "study-stats.habit-tracker.workout-links";

const DEFAULT_EXERCISE_MUSCLES: MuscleGroup[] = ["pectoralis-major"];
const DEFAULT_REST_SECONDS = STANDARD_REST_SECONDS;

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

function createMuscleNumberMap(initialValue = 0): Record<MuscleGroup, number> {
  return Object.fromEntries(MUSCLE_GROUPS.map((muscle) => [muscle, initialValue])) as Record<
    MuscleGroup,
    number
  >;
}

function sameMuscleList(left: MuscleGroup[], right: MuscleGroup[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function computeWorkoutLoadPoints(workout: WorkoutTemplate): Record<MuscleGroup, number> {
  const byMuscle = createMuscleNumberMap(0);
  for (const exercise of workout.exercises) {
    const load = Math.max(1, exercise.sets * exercise.reps);
    for (const muscle of exercise.muscles) {
      byMuscle[muscle] += load;
    }
  }
  return byMuscle;
}

function getExerciseEstimatedWorkSeconds(exercise: WorkoutExercise): number {
  const mapped = EXERCISE_MUSCLE_MAP.get(exercise.id);
  const perSetSeconds =
    mapped?.timeSeconds && mapped.timeSeconds > 0
      ? mapped.timeSeconds
      : Math.max(20, Math.round(exercise.reps * 2.5));
  return perSetSeconds * Math.max(1, exercise.sets);
}

function estimateWorkoutDurationSeconds(workout: WorkoutTemplate): number {
  let total = 0;
  for (const exercise of workout.exercises) {
    total += getExerciseEstimatedWorkSeconds(exercise);
    const restBetweenSets = Math.max(0, exercise.sets - 1);
    if (restBetweenSets === 0) continue;
    total += restBetweenSets * Math.max(0, exercise.restSeconds ?? DEFAULT_REST_SECONDS);
  }
  return total;
}

function formatEstimatedDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remSeconds = safe % 60;
  if (minutes === 0) return `${remSeconds}s`;
  if (remSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remSeconds}s`;
}

function formatRestTimer(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

interface KnownExerciseOption {
  id: string;
  name: string;
  muscles: MuscleGroup[];
  timeSeconds: number;
  searchableName: string;
}

interface InjuryInsight {
  id: string;
  type: "warning" | "tip";
  title: string;
  detail: string;
}

type WorkoutRunnerPhase = "work" | "rest" | "complete";

type WorkoutRunnerState = {
  workoutId: string;
  exerciseIndex: number;
  setIndex: number;
  phase: WorkoutRunnerPhase;
  restRemaining: number;
};

type DailyTrackerOrganRegionKey =
  | "heart"
  | "lungs"
  | "brain"
  | "nervous-system"
  | "digestive-system"
  | "liver-gallbladder"
  | "kidneys-bladder"
  | "endocrine-system"
  | "immune-system";

function computeDailyTrackerOrganImpact(entries: DailyTrackerEntry[]): {
  scores: Partial<Record<DailyTrackerOrganRegionKey, number>>;
  notes: string[];
} {
  if (entries.length === 0) return { scores: {}, notes: [] };

  const now = Date.now();
  const lookbackMs = 1000 * 60 * 60 * 24 * 5;
  const raw: Record<DailyTrackerOrganRegionKey, number> = {
    heart: 0,
    lungs: 0,
    brain: 0,
    "nervous-system": 0,
    "digestive-system": 0,
    "liver-gallbladder": 0,
    "kidneys-bladder": 0,
    "endocrine-system": 0,
    "immune-system": 0,
  };
  const notes = new Set<string>();

  const add = (region: DailyTrackerOrganRegionKey, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    raw[region] += value;
  };

  for (const entry of entries) {
    const loggedMs = new Date(entry.loggedAt).getTime();
    if (!Number.isFinite(loggedMs)) continue;
    const ageMs = now - loggedMs;
    if (ageMs < 0 || ageMs > lookbackMs) continue;
    const recencyWeight = Math.exp(-ageMs / (1000 * 60 * 60 * 48));
    const form = entry.form;

    if (typeof form.alcohol === "number" && form.alcohol > 0) {
      const intensity = form.alcohol / 10;
      add("liver-gallbladder", 100 * intensity * recencyWeight);
      add("digestive-system", 58 * intensity * recencyWeight);
      add("kidneys-bladder", 46 * intensity * recencyWeight);
      add("heart", 34 * intensity * recencyWeight);
      add("brain", 28 * intensity * recencyWeight);
      if (form.alcohol >= 4) {
        notes.add("Alcohol logs increase liver/gallbladder and digestive load.");
      }
    }

    if (typeof form.caffeineMg === "number" && form.caffeineMg > 0) {
      const intensity = form.caffeineMg / 200;
      add("nervous-system", 82 * intensity * recencyWeight);
      add("heart", 72 * intensity * recencyWeight);
      add("endocrine-system", 36 * intensity * recencyWeight);
      add("kidneys-bladder", 30 * intensity * recencyWeight);
      if (form.caffeineMg >= 150) {
        notes.add("Higher caffeine shifts impact toward heart and nervous system.");
      }
    }

    if (typeof form.morningSleepRating === "number") {
      const deficit = Math.max(0, (10 - form.morningSleepRating) / 10);
      add("brain", 76 * deficit * recencyWeight);
      add("nervous-system", 70 * deficit * recencyWeight);
      add("immune-system", 56 * deficit * recencyWeight);
      add("endocrine-system", 42 * deficit * recencyWeight);
      if (form.morningSleepRating <= 4) {
        notes.add("Low sleep ratings increase brain, nervous, and immune strain.");
      }
    }

    if (typeof form.fatigue === "number" && form.fatigue > 0) {
      const intensity = form.fatigue / 10;
      add("nervous-system", 45 * intensity * recencyWeight);
      add("immune-system", 36 * intensity * recencyWeight);
      add("endocrine-system", 31 * intensity * recencyWeight);
    }

    if (typeof form.headache === "number" && form.headache > 0) {
      add("brain", 72 * (form.headache / 4) * recencyWeight);
    }

    if (typeof form.coughing === "number" && form.coughing > 0) {
      add("lungs", 82 * (form.coughing / 10) * recencyWeight);
      if (form.coughing >= 6) {
        notes.add("Coughing logs strongly impact lung-related systems.");
      }
    }

    const emotionalLoad = ["stressed", "anxious", "angry", "depressed", "lonely"].filter((emotion) =>
      form.emotions.includes(emotion)
    ).length;
    if (emotionalLoad > 0) {
      const intensity = Math.min(1, emotionalLoad / 3);
      add("nervous-system", 66 * intensity * recencyWeight);
      add("heart", 44 * intensity * recencyWeight);
      add("endocrine-system", 34 * intensity * recencyWeight);
      add("digestive-system", 24 * intensity * recencyWeight);
    }

    if (form.school.includes("exam")) {
      add("nervous-system", 34 * recencyWeight);
      add("heart", 18 * recencyWeight);
    }

    if (form.events.includes("party")) {
      add("liver-gallbladder", 26 * recencyWeight);
      add("heart", 14 * recencyWeight);
    }

    if (form.otherFactors.includes("not well (sick)")) {
      add("immune-system", 80 * recencyWeight);
      add("lungs", 26 * recencyWeight);
    }
  }

  const maxRaw = Math.max(...Object.values(raw));
  if (maxRaw <= 0) return { scores: {}, notes: [] };

  const scores: Partial<Record<DailyTrackerOrganRegionKey, number>> = {};
  (Object.keys(raw) as DailyTrackerOrganRegionKey[]).forEach((region) => {
    if (raw[region] <= 0) return;
    scores[region] = Math.round((raw[region] / maxRaw) * 100);
  });

  return { scores, notes: [...notes] };
}

function getNextWorkoutSetPosition(
  workout: WorkoutTemplate,
  currentExerciseIndex: number,
  currentSetIndex: number
): { exerciseIndex: number; setIndex: number } | null {
  const currentExercise = workout.exercises[currentExerciseIndex];
  if (!currentExercise) return null;

  if (currentSetIndex + 1 < Math.max(1, currentExercise.sets)) {
    return { exerciseIndex: currentExerciseIndex, setIndex: currentSetIndex + 1 };
  }

  for (
    let exerciseIndex = currentExerciseIndex + 1;
    exerciseIndex < workout.exercises.length;
    exerciseIndex += 1
  ) {
    const candidate = workout.exercises[exerciseIndex];
    if (!candidate) continue;
    if (Math.max(1, candidate.sets) <= 0) continue;
    return { exerciseIndex, setIndex: 0 };
  }

  return null;
}

function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  if (target.includes(query)) {
    let score = 500 - (target.length - query.length);
    if (target.startsWith(query)) score += 200;
    return score;
  }

  let queryIndex = 0;
  let score = 0;
  let lastMatchIndex = -2;

  for (let targetIndex = 0; targetIndex < target.length && queryIndex < query.length; targetIndex += 1) {
    if (query[queryIndex] !== target[targetIndex]) continue;

    score += lastMatchIndex + 1 === targetIndex ? 10 : 4;
    if (targetIndex === 0 || target[targetIndex - 1] === " ") {
      score += 6;
    }
    lastMatchIndex = targetIndex;
    queryIndex += 1;
  }

  if (queryIndex !== query.length) return -1;
  return score - (target.length - query.length);
}

export default function WorkoutPlanner() {
  const { session, payload, loading, saving, error: sharedError, savePayload } =
    useWorkoutData();
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newWorkoutName, setNewWorkoutName] = useState("");
  const [draftExercises, setDraftExercises] = useState<WorkoutExercise[]>([]);
  const [exerciseSearch, setExerciseSearch] = useState("");
  const [exerciseName, setExerciseName] = useState("");
  const [exerciseSets, setExerciseSets] = useState(3);
  const [exerciseReps, setExerciseReps] = useState(10);
  const [exerciseMuscles, setExerciseMuscles] = useState<MuscleGroup[]>(DEFAULT_EXERCISE_MUSCLES);
  const [showCustomExerciseForm, setShowCustomExerciseForm] = useState(false);
  const [showCreateWorkoutModal, setShowCreateWorkoutModal] = useState(false);
  const [previewWorkoutId, setPreviewWorkoutId] = useState<string | null>(null);
  const [exerciseInfoVisible, setExerciseInfoVisible] = useState<Record<string, boolean>>({});
  const [highlightedMusclesByWorkout, setHighlightedMusclesByWorkout] = useState<
    Record<string, MuscleGroup[]>
  >({});
  const [hoveredExerciseMusclesByWorkout, setHoveredExerciseMusclesByWorkout] = useState<
    Record<string, MuscleGroup[]>
  >({});
  const [hoveredExerciseKeyByWorkout, setHoveredExerciseKeyByWorkout] = useState<
    Record<string, string | null>
  >({});
  const [previewHighlightedMuscles, setPreviewHighlightedMuscles] = useState<MuscleGroup[]>([]);
  const [previewHoveredExerciseMuscles, setPreviewHoveredExerciseMuscles] = useState<MuscleGroup[]>(
    []
  );
  const [previewHoveredExerciseKey, setPreviewHoveredExerciseKey] = useState<string | null>(null);
  const [runnerState, setRunnerState] = useState<WorkoutRunnerState | null>(null);
  const [weeklyPlanName, setWeeklyPlanName] = useState("");
  const [weeklyPlanDays, setWeeklyPlanDays] = useState<Record<WorkoutWeekDay, string[]>>(
    emptyWeeklyPlanDays()
  );
  const [editingWeeklyPlanId, setEditingWeeklyPlanId] = useState<string | null>(null);
  const weeklyPlanSectionRef = useRef<HTMLElement | null>(null);
  const [weeklyPlanSummariesVisible, setWeeklyPlanSummariesVisible] = useState(false);

  const [logDateByWorkout, setLogDateByWorkout] = useState<Record<string, string>>({});
  const [dailyTrackerEntries, setDailyTrackerEntries] = useState<DailyTrackerEntry[]>([]);

  useEffect(() => {
    const syncEntries = () => {
      const parsed = parseDailyTrackerEntries(
        window.localStorage.getItem(DAILY_TRACKER_ENTRIES_STORAGE_KEY)
      );
      setDailyTrackerEntries(parsed);
    };

    syncEntries();
    window.addEventListener(DAILY_TRACKER_UPDATED_EVENT, syncEntries);
    window.addEventListener("storage", syncEntries);
    return () => {
      window.removeEventListener(DAILY_TRACKER_UPDATED_EVENT, syncEntries);
      window.removeEventListener("storage", syncEntries);
    };
  }, []);

  const setWorkoutHighlightedMuscles = (workoutId: string, muscles: MuscleGroup[]) => {
    setHighlightedMusclesByWorkout((previous) => {
      const current = previous[workoutId] || [];
      if (sameMuscleList(current, muscles)) return previous;
      return {
        ...previous,
        [workoutId]: muscles,
      };
    });
  };

  const setWorkoutHoveredMuscles = (workoutId: string, muscles: MuscleGroup[]) => {
    setHoveredExerciseMusclesByWorkout((previous) => {
      const current = previous[workoutId] || [];
      if (sameMuscleList(current, muscles)) return previous;
      return {
        ...previous,
        [workoutId]: muscles,
      };
    });
  };

  const setPreviewHoveredMuscles = (muscles: MuscleGroup[]) => {
    setPreviewHoveredExerciseMuscles((previous) => {
      if (sameMuscleList(previous, muscles)) return previous;
      return muscles;
    });
  };

  useEffect(() => {
    if (!showCreateWorkoutModal && !previewWorkoutId && !runnerState?.workoutId) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [previewWorkoutId, runnerState?.workoutId, showCreateWorkoutModal]);

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
            // Backward compatibility: missing `enabled` means enabled.
            if (typeof value.enabled === "boolean" && value.enabled === false) return null;
            const normalized = value.name.trim();
            return normalized || null;
          })
          .filter((name): name is string => Boolean(name));
        return names.length > 0 ? [...new Set(names)] : ["Gym"];
      } catch {
        return ["Gym"];
      }
    })();

    if (linkedHabitNames.length === 0) return { synced: 0, failed: [] };

    const trackerCalendarId = await getTrackerCalendarId();
    if (!trackerCalendarId) {
      return { synced: 0, failed: linkedHabitNames };
    }

    const fallbackHabitName = (() => {
      const fallbackByKeyword = linkedHabitNames.find((name) =>
        /(gym|workout|training)/i.test(name)
      );
      return fallbackByKeyword || linkedHabitNames[0] || "Gym";
    })();

    const results = await Promise.allSettled(
      [...new Set([fallbackHabitName, ...linkedHabitNames])].map(async (habitName) => {
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

  const persist = async (nextPayload: WorkoutPlannerPayload, successMessage?: string) => {
    try {
      setActionError(null);
      setMessage(null);
      await savePayload(nextPayload);
      if (successMessage) setMessage(successMessage);
    } catch (persistError: unknown) {
      setActionError(
        persistError instanceof Error ? persistError.message : "Failed to save workout data."
      );
    }
  };

  const knownExercises = useMemo<KnownExerciseOption[]>(
    () =>
      Array.from(EXERCISE_MUSCLE_MAP.values())
        .map((entry) => ({
          id: entry.exerciseId,
          name: entry.exerciseName,
          muscles: entry.muscles.map((muscle) => muscle.id as MuscleGroup),
          timeSeconds: entry.timeSeconds,
          searchableName: entry.exerciseName.trim().toLowerCase(),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    []
  );

  const deferredExerciseSearch = useDeferredValue(exerciseSearch);

  const filteredKnownExercises = useMemo(() => {
    const query = deferredExerciseSearch.trim().toLowerCase();
    if (!query) return knownExercises.slice(0, 12);
    return knownExercises
      .map((exercise) => ({
        exercise,
        score: fuzzyScore(query, exercise.searchableName),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 12)
      .map((entry) => entry.exercise);
  }, [deferredExerciseSearch, knownExercises]);

  const addKnownExerciseToDraft = (exercise: { id: string; name: string; muscles: MuscleGroup[] }) => {
    if (exercise.muscles.length === 0) return;
    const next: WorkoutExercise = {
      id: generateId(),
      name: exercise.name,
      muscles: exercise.muscles,
      sets: Math.max(1, Math.min(30, exerciseSets)),
      reps: Math.max(1, Math.min(100, exerciseReps)),
      restSeconds: getPolicyRestSeconds(exercise.muscles),
    };
    setDraftExercises((previous) => [...previous, next]);
    setExerciseSearch("");
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
      restSeconds: getPolicyRestSeconds(exerciseMuscles),
    };
    setDraftExercises((previous) => [...previous, next]);
    setExerciseName("");
    setExerciseSets(3);
    setExerciseReps(10);
    setExerciseMuscles(DEFAULT_EXERCISE_MUSCLES);
  };

  const updateDraftExercise = (
    exerciseId: string,
    field: "sets" | "reps",
    value: number
  ) => {
    setDraftExercises((previous) =>
      previous.map((exercise) => {
        if (exercise.id !== exerciseId) return exercise;
        if (field === "sets") {
          return { ...exercise, sets: Math.max(1, Math.min(30, Math.round(value))) };
        }
        if (field === "reps") {
          return { ...exercise, reps: Math.max(1, Math.min(100, Math.round(value))) };
        }
        return exercise;
      })
    );
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
    setExerciseSearch("");
    setShowCustomExerciseForm(false);
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
      setActionError("Assign at least one day to a workout before saving a weekly plan.");
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
      setActionError(
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

  useEffect(() => {
    if (weeklyPlanSummariesVisible) return;
    const node = weeklyPlanSectionRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setWeeklyPlanSummariesVisible(true);
        observer.disconnect();
      },
      { rootMargin: "180px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [weeklyPlanSummariesVisible]);

  const workouts = payload.workouts;
  const logs = payload.logs;
  const weeklyPlans = payload.weeklyPlans;
  const activeWeeklyPlan = weeklyPlans[0] || null;

  const fatigueScores = useMemo(
    () =>
      computeMuscleFatigue({
        workouts,
        logs,
        weeklyPlans: [],
        updatedAt: payload.updatedAt,
      }),
    [logs, payload.updatedAt, workouts]
  );
  const workoutLoadById = useMemo(() => {
    const loadMap = new Map<string, Record<MuscleGroup, number>>();
    for (const workout of workouts) {
      loadMap.set(workout.id, computeWorkoutLoadPoints(workout));
    }
    return loadMap;
  }, [workouts]);
  const currentLoadPoints = useMemo(() => {
    const byMuscle = createMuscleNumberMap(0);
    for (const log of logs) {
      const workoutLoad = workoutLoadById.get(log.workoutId);
      if (!workoutLoad) continue;
      for (const muscle of MUSCLE_GROUPS) {
        byMuscle[muscle] += workoutLoad[muscle];
      }
    }
    return byMuscle;
  }, [logs, workoutLoadById]);
  const dailyTrackerOrganImpact = useMemo(
    () => computeDailyTrackerOrganImpact(dailyTrackerEntries),
    [dailyTrackerEntries]
  );
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
  const draftLoadPoints = useMemo(
    () =>
      computeWorkoutLoadPoints({
        id: "draft",
        name: "Draft",
        createdAt: new Date().toISOString(),
        exercises: draftExercises,
      }),
    [draftExercises]
  );
  const workoutById = useMemo(
    () => new Map(workouts.map((workout) => [workout.id, workout])),
    [workouts]
  );
  const previewWorkout = useMemo(
    () => (previewWorkoutId ? workoutById.get(previewWorkoutId) || null : null),
    [previewWorkoutId, workoutById]
  );
  const runnerWorkout = runnerState?.workoutId ? workoutById.get(runnerState.workoutId) || null : null;
  const isRunnerResting = runnerState?.phase === "rest";

  useEffect(() => {
    if (!isRunnerResting) return;

    const intervalId = window.setInterval(() => {
      setRunnerState((previous) => {
        if (!previous || previous.phase !== "rest") return previous;
        if (previous.restRemaining <= 1) {
          return {
            ...previous,
            phase: "work",
            restRemaining: 0,
          };
        }
        return {
          ...previous,
          restRemaining: previous.restRemaining - 1,
        };
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isRunnerResting]);

  const startWorkoutRunner = (workout: WorkoutTemplate) => {
    if (workout.exercises.length === 0) return;
    setRunnerState({
      workoutId: workout.id,
      exerciseIndex: 0,
      setIndex: 0,
      phase: "work",
      restRemaining: 0,
    });
  };

  const completeCurrentRunnerSet = () => {
    setRunnerState((previous) => {
      if (!previous || previous.phase !== "work") return previous;
      const workout = workoutById.get(previous.workoutId);
      if (!workout) return null;

      const currentExercise = workout.exercises[previous.exerciseIndex];
      if (!currentExercise) return null;

      const nextPosition = getNextWorkoutSetPosition(
        workout,
        previous.exerciseIndex,
        previous.setIndex
      );
      if (!nextPosition) {
        return {
          ...previous,
          phase: "complete",
          restRemaining: 0,
        };
      }

      const restSeconds = Math.max(0, currentExercise.restSeconds ?? DEFAULT_REST_SECONDS);
      return {
        ...previous,
        exerciseIndex: nextPosition.exerciseIndex,
        setIndex: nextPosition.setIndex,
        phase: restSeconds > 0 ? "rest" : "work",
        restRemaining: restSeconds,
      };
    });
  };
  const nextScheduledWorkouts = useMemo(() => {
    if (!activeWeeklyPlan) return null;

    const daysPerWorkout = new Map<string, number>();
    for (const day of WORKOUT_WEEK_DAYS) {
      for (const workoutId of activeWeeklyPlan.days[day]) {
        daysPerWorkout.set(workoutId, (daysPerWorkout.get(workoutId) || 0) + 1);
      }
    }

    // Workouts assigned every day (for example stretching/warm-up) should not
    // advance the main weekly progression order.
    const alwaysOnWorkoutIds = new Set(
      [...daysPerWorkout.entries()]
        .filter(([, dayCount]) => dayCount >= WORKOUT_WEEK_DAYS.length)
        .map(([workoutId]) => workoutId)
    );

    const fullSequence = WORKOUT_WEEK_DAYS.flatMap((day) =>
      activeWeeklyPlan.days[day].map((workoutId) => ({
        day,
        workoutId,
      }))
    );
    if (fullSequence.length === 0) return null;

    const sequence = fullSequence.filter((entry) => !alwaysOnWorkoutIds.has(entry.workoutId));
    const progressionSequence = sequence.length > 0 ? sequence : fullSequence;

    const lastLogged = logs.find((log) =>
      progressionSequence.some((entry) => entry.workoutId === log.workoutId)
    );
    if (!lastLogged) {
      const firstDay = progressionSequence[0].day;
      return {
        planName: activeWeeklyPlan.name,
        day: firstDay,
        workoutIds: activeWeeklyPlan.days[firstDay],
      };
    }

    let lastIndex = -1;
    for (let index = progressionSequence.length - 1; index >= 0; index -= 1) {
      if (progressionSequence[index].workoutId === lastLogged.workoutId) {
        lastIndex = index;
        break;
      }
    }

    const nextIndex = lastIndex >= 0 ? (lastIndex + 1) % progressionSequence.length : 0;
    const nextDay = progressionSequence[nextIndex].day;
    return {
      planName: activeWeeklyPlan.name,
      day: nextDay,
      workoutIds: activeWeeklyPlan.days[nextDay],
    };
  }, [activeWeeklyPlan, logs]);
  const workoutScoresById = useMemo(() => {
    const scoreMap = new Map<string, Record<MuscleGroup, number>>();
    const today = todayDateKey();

    for (const workout of workouts) {
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
  }, [workouts]);
  const injuryInsights = useMemo<InjuryInsight[]>(() => {
    const insights: InjuryInsight[] = [];
    const today = todayDateKey();

    // History-based signal: uninterrupted recent training streak.
    const uniqueLogDates = [...new Set(logs.map((log) => log.performedOn))].sort();
    let consecutiveTrainingDays = 0;
    if (uniqueLogDates.length > 0) {
      let cursor = uniqueLogDates[uniqueLogDates.length - 1];
      const keySet = new Set(uniqueLogDates);
      while (keySet.has(cursor)) {
        consecutiveTrainingDays += 1;
        cursor = addDays(cursor, -1);
      }
    }
    if (consecutiveTrainingDays >= 4) {
      insights.push({
        id: "streak-recovery",
        type: "warning",
        title: "Recovery Window Needed",
        detail: `You have trained ${consecutiveTrainingDays} consecutive days. Schedule a lower-load or recovery day to reduce overuse risk.`,
      });
    }

    // History-based signal: highly fatigued muscle groups.
    const highFatigueMuscles = Object.entries(fatigueScores)
      .filter(([, score]) => score >= 70)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([muscle]) => muscle as MuscleGroup);
    if (highFatigueMuscles.length > 0) {
      insights.push({
        id: "high-fatigue-muscles",
        type: "warning",
        title: "High Fatigue Detected",
        detail: `Top high-fatigue muscles: ${highFatigueMuscles
          .map((muscle) => MUSCLE_LABELS[muscle])
          .join(", ")}. Reduce volume/intensity or shift to less-stressed groups.`,
      });
    }

    // Exercise-selection signal: upcoming scheduled workout overlaps with current high fatigue.
    if (nextScheduledWorkouts && nextScheduledWorkouts.workoutIds.length > 0) {
      const nextWorkoutMuscles = new Set<MuscleGroup>();
      for (const workoutId of nextScheduledWorkouts.workoutIds) {
        const workout = workoutById.get(workoutId);
        if (!workout) continue;
        for (const exercise of workout.exercises) {
          for (const muscle of exercise.muscles) {
            nextWorkoutMuscles.add(muscle);
          }
        }
      }
      const overlap = [...nextWorkoutMuscles].filter(
        (muscle) => (fatigueScores[muscle] || 0) >= 60
      );
      if (overlap.length > 0) {
        insights.push({
          id: "next-workout-overlap",
          type: "warning",
          title: "Upcoming Overlap Risk",
          detail: `Next planned workout still targets fatigued muscles: ${overlap
            .slice(0, 3)
            .map((muscle) => MUSCLE_LABELS[muscle])
            .join(", ")}.`,
        });
      }
    }

    // Exercise-selection signal: draft rest intervals.
    const lowRestExercises = draftExercises.filter(
      (exercise) => (exercise.restSeconds ?? DEFAULT_REST_SECONDS) < 45
    );
    if (lowRestExercises.length > 0) {
      insights.push({
        id: "low-rest-draft",
        type: "warning",
        title: "Very Short Rest Intervals",
        detail: `${lowRestExercises.length} draft exercise(s) have rest below 45s. Consider longer rest for heavy compound movements.`,
      });
    } else if (draftExercises.length > 0) {
      insights.push({
        id: "draft-rest-ok",
        type: "tip",
        title: "Draft Rest Intervals Look Balanced",
        detail: "Your current draft uses moderate rest. Keep heavier lifts at higher rest to protect form.",
      });
    }

    // Generic preventive tip based on recent activity volume.
    const logsLast7Days = logs.filter((log) => log.performedOn >= addDays(today, -6)).length;
    if (logsLast7Days >= 5) {
      insights.push({
        id: "weekly-volume-tip",
        type: "tip",
        title: "High Weekly Frequency",
        detail: `You logged ${logsLast7Days} workouts in the last 7 days. Prioritize sleep, hydration, and easier accessory work between intense days.`,
      });
    }

    return insights.slice(0, 5);
  }, [draftExercises, fatigueScores, logs, nextScheduledWorkouts, workoutById]);
  const weeklyPlanSummaries = useMemo(() => {
    if (!weeklyPlanSummariesVisible) return new Map();
    const summaries = new Map<
      string,
      {
        scores: Record<MuscleGroup, number>;
        totalByMuscle: Record<MuscleGroup, number>;
        hitDaysByMuscle: Record<MuscleGroup, number>;
        totalLoad: number;
      }
    >();

    for (const plan of weeklyPlans) {
      const totalByMuscle = createMuscleNumberMap(0);
      const hitDaysByMuscle = createMuscleNumberMap(0);

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
      const scores = createMuscleNumberMap(0);

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
  }, [weeklyPlanSummariesVisible, weeklyPlans, workoutById]);

  return (
    <div className="space-y-5">
      <div className="surface-card p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Gym</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Build custom routines with exercises, sets, reps, and rest intervals.{" "}
              {session ? "Auto-synced to cloud when available." : "Saved locally on this device."}
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

      <section className="surface-card p-5">
        <h2 className="text-lg font-semibold mb-2">Next Workout(s)</h2>
        {!nextScheduledWorkouts && (
          <p className="text-sm text-zinc-500">
            Add a weekly workout plan to see the next workouts in sequence.
          </p>
        )}
        {nextScheduledWorkouts && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500">
              Plan: {nextScheduledWorkouts.planName} • Next day: {WEEKDAY_LABELS[nextScheduledWorkouts.day]}
            </p>
            {nextScheduledWorkouts.workoutIds.length === 0 && (
              <p className="text-sm text-zinc-500">No workouts assigned on this day.</p>
            )}
            {nextScheduledWorkouts.workoutIds.map((workoutId, index) => {
              const workout = workoutById.get(workoutId);
              if (!workout) return null;
              const date = logDateByWorkout[workout.id] || todayDateKey();
              return (
                <div
                  key={`next-${workoutId}-${index}`}
                  className="rounded-md bg-zinc-50/70 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{workout.name}</p>
                      <p className="text-xs text-zinc-500">
                        {workout.exercises.length} exercise{workout.exercises.length === 1 ? "" : "s"} • ~
                        {formatEstimatedDuration(estimateWorkoutDurationSeconds(workout))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={date}
                        onChange={(event) =>
                          setLogDateByWorkout((previous) => ({
                            ...previous,
                            [workout.id]: event.target.value,
                          }))
                        }
                        className="border rounded-lg px-2 py-1 text-xs bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => startWorkoutRunner(workout)}
                        className="px-2 py-1 rounded-md text-xs bg-indigo-500 hover:bg-indigo-600 text-white"
                      >
                        Start
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewHoveredMuscles([]);
                          setPreviewHoveredExerciseKey(null);
                          setPreviewHighlightedMuscles([]);
                          setPreviewWorkoutId(workout.id);
                        }}
                        className="px-2 py-1 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300"
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => logWorkout(workout)}
                        disabled={saving}
                        className="px-2 py-1 rounded-md text-xs bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white"
                      >
                        Log Workout
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="surface-card p-5">
        <h2 className="text-lg font-semibold mb-2">Injury Prevention</h2>
        {injuryInsights.length === 0 && (
          <p className="text-sm text-zinc-500">
            Add workouts or logs to receive risk warnings and prevention tips.
          </p>
        )}
        {injuryInsights.length > 0 && (
          <div className="space-y-2">
            {injuryInsights.map((insight) => (
              <div
                key={insight.id}
                className={`rounded-md px-3 py-2 ${
                  insight.type === "warning"
                    ? "bg-amber-50/70"
                    : "bg-emerald-50/70"
                }`}
              >
                <p className="text-sm font-semibold">{insight.title}</p>
                <p className="text-xs text-zinc-600 mt-0.5">{insight.detail}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {(loading || saving) && (
        <div className="rounded-xl bg-zinc-50 px-4 py-2 text-sm text-zinc-500">
          {loading ? "Loading planner..." : "Saving..."}
        </div>
      )}
      {(actionError || sharedError) && (
        <p className="text-sm text-red-500">{actionError || sharedError}</p>
      )}
      {message && <p className="text-sm text-emerald-600">{message}</p>}

      <MuscleModel
        scores={fatigueScores}
        loadPoints={currentLoadPoints}
        title="Current Muscle Fatigue (Recovery-Weighted)"
        lazyOverlayRender={false}
        forceSimplifiedOverlays
        showOrganPanel={false}
      />

      <section className="rounded-xl bg-white p-3 shadow-sm space-y-1.5">
        <p className="text-[11px] text-zinc-500">
          Organ impact combines workouts with daily tracker factors.
        </p>
        <MuscleModel
          scores={fatigueScores}
          loadPoints={currentLoadPoints}
          title="Organ Impact"
          compact
          organOnly
          extraOrganScores={dailyTrackerOrganImpact.scores}
          extraOrganNotes={dailyTrackerOrganImpact.notes}
        />
      </section>

      <div className="grid grid-cols-1 gap-5">
        <section
          ref={weeklyPlanSectionRef}
          className="rounded-2xl bg-white p-5 shadow-sm"
        >
          <h2 className="text-lg font-semibold mb-3">Saved Workouts</h2>
          <div className="space-y-3">
            {payload.workouts.length === 0 && (
              <p className="text-sm text-zinc-500">No workouts saved yet.</p>
            )}
            {payload.workouts.map((workout) => {
              const activeHighlightedMuscles =
                (hoveredExerciseMusclesByWorkout[workout.id] || []).length > 0
                  ? hoveredExerciseMusclesByWorkout[workout.id] || []
                  : highlightedMusclesByWorkout[workout.id] || [];

              return (
                <div key={workout.id} className="rounded-lg bg-zinc-50/40 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{workout.name}</p>
                    <p className="text-[11px] text-zinc-500">
                      {workout.exercises.length} exercise{workout.exercises.length === 1 ? "" : "s"} • ~
                      {formatEstimatedDuration(estimateWorkoutDurationSeconds(workout))}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="date"
                      value={logDateByWorkout[workout.id] || todayDateKey()}
                      onChange={(event) =>
                        setLogDateByWorkout((previous) => ({
                          ...previous,
                          [workout.id]: event.target.value,
                        }))
                      }
                      className="border rounded-md px-1 py-0.5 text-[11px] bg-zinc-50"
                    />
                    <button
                      type="button"
                      onClick={() => startWorkoutRunner(workout)}
                      className="px-1.5 py-0.5 rounded-md text-[11px] bg-indigo-500 hover:bg-indigo-600 text-white"
                    >
                      Start
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewHoveredMuscles([]);
                        setPreviewHoveredExerciseKey(null);
                        setPreviewHighlightedMuscles([]);
                        setPreviewWorkoutId(workout.id);
                      }}
                      className="px-1.5 py-0.5 rounded-md text-[11px] bg-zinc-200 hover:bg-zinc-300"
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => logWorkout(workout)}
                      disabled={saving}
                      className="px-1.5 py-0.5 rounded-md text-[11px] bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-50"
                    >
                      Log
                    </button>
                    <button
                      type="button"
                      onClick={() => removeWorkout(workout.id)}
                      className="px-1.5 py-0.5 rounded-md text-[11px] bg-zinc-200"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-2 items-stretch">
                  <div className="rounded-md bg-white/70 p-1.5 min-h-[16rem] h-full">
                    <MuscleModel
                      scores={workoutScoresById.get(workout.id) || fatigueScores}
                      loadPoints={workoutLoadById.get(workout.id)}
                      title="Workout Muscle Targets"
                      compact
                      showOrganPanel={false}
                      highlightedMuscles={activeHighlightedMuscles}
                      onHighlightedMusclesChange={(muscles) =>
                        setWorkoutHighlightedMuscles(workout.id, muscles)
                      }
                    />
                  </div>
                  <div className="rounded-md bg-white/70 p-1.5 min-h-[16rem] h-full flex flex-col">
                    <div className="space-y-1 overflow-y-auto pr-1 flex-1">
                      {workout.exercises.map((exercise, exerciseIndex) => {
                        const exerciseHoverKey = `${workout.id}-${exercise.id}-${exerciseIndex}`;
                        const hasHoveredExercise = Boolean(hoveredExerciseKeyByWorkout[workout.id]);
                        const isHighlightedByMuscleSelection =
                          (highlightedMusclesByWorkout[workout.id] || []).length > 0 &&
                          exercise.muscles.some((muscle) =>
                            (highlightedMusclesByWorkout[workout.id] || []).includes(muscle)
                          );
                        const isRowHighlighted = hasHoveredExercise
                          ? hoveredExerciseKeyByWorkout[workout.id] === exerciseHoverKey
                          : isHighlightedByMuscleSelection;
                        return (
                        <div
                          key={exerciseHoverKey}
                          onMouseEnter={() => {
                            setWorkoutHoveredMuscles(workout.id, exercise.muscles);
                            setHoveredExerciseKeyByWorkout((previous) => ({
                              ...previous,
                              [workout.id]: exerciseHoverKey,
                            }));
                          }}
                          onMouseLeave={() => {
                            setWorkoutHoveredMuscles(workout.id, []);
                            setHoveredExerciseKeyByWorkout((previous) => ({
                              ...previous,
                              [workout.id]: null,
                            }));
                          }}
                          onFocus={() => {
                            setWorkoutHoveredMuscles(workout.id, exercise.muscles);
                            setHoveredExerciseKeyByWorkout((previous) => ({
                              ...previous,
                              [workout.id]: exerciseHoverKey,
                            }));
                          }}
                          onBlur={() => {
                            setWorkoutHoveredMuscles(workout.id, []);
                            setHoveredExerciseKeyByWorkout((previous) => ({
                              ...previous,
                              [workout.id]: null,
                            }));
                          }}
                          tabIndex={0}
                          className={`rounded-md px-2 py-1 transition-colors ${
                            isRowHighlighted
                              ? "bg-sky-50/70 ring-1 ring-sky-200"
                              : "bg-zinc-50/60"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold leading-tight">{exercise.name}</p>
                            <button
                              type="button"
                              onClick={() =>
                                setExerciseInfoVisible((previous) => ({
                                  ...previous,
                                  [`saved-${workout.id}-${exercise.id}`]:
                                    !previous[`saved-${workout.id}-${exercise.id}`],
                                }))
                              }
                              className="pill-btn px-1.5 py-0 text-[11px]"
                              aria-label={`Toggle muscle info for ${exercise.name}`}
                            >
                              i
                            </button>
                          </div>
                          <p className="text-[10px] text-zinc-500 mt-0.5 stat-mono">
                            {exercise.sets} sets x {exercise.reps} reps • Rest{" "}
                            {exercise.restSeconds ?? DEFAULT_REST_SECONDS}s • Est{" "}
                            {formatEstimatedDuration(getExerciseEstimatedWorkSeconds(exercise))}
                          </p>
                          {exerciseInfoVisible[`saved-${workout.id}-${exercise.id}`] && (
                            <p className="text-[10px] text-zinc-500 mt-0.5">
                              Hits: {exercise.muscles
                                .map((muscle) => MUSCLE_LABELS[muscle])
                                .join(", ")}
                            </p>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">Weekly Workout Plans</h2>

          <form onSubmit={saveWeeklyPlan} className="rounded-lg bg-zinc-50/50 p-3 space-y-3">
            <input
              type="text"
              value={weeklyPlanName}
              onChange={(event) => setWeeklyPlanName(event.target.value)}
              placeholder="Plan name (e.g. Weekly Push/Pull/Legs)"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-zinc-50"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {WORKOUT_WEEK_DAYS.map((day) => (
                <div key={day} className="rounded-lg bg-white/70 p-2 text-xs">
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
                  className="px-4 py-2 rounded-lg bg-zinc-200 text-sm font-medium"
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
              const nonZeroMuscles = UI_MUSCLE_GROUPS
                .map((muscle) => ({
                  muscle,
                  load: summary?.totalByMuscle[muscle] || 0,
                  hitDays: summary?.hitDaysByMuscle[muscle] || 0,
                  pct: summary?.scores[muscle] || 0,
                }))
                .filter((entry) => entry.load > 0)
                .sort((a, b) => b.load - a.load);
              const missingMuscles = UI_MUSCLE_GROUPS.filter(
                (muscle) => (summary?.totalByMuscle[muscle] || 0) <= 0
              );

              return (
                <div key={plan.id} className="rounded-lg bg-zinc-50/45 p-3">
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
                        className="px-2 py-1 rounded-md text-xs bg-zinc-200"
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
                        <div key={`${plan.id}-${day}`} className="rounded-md bg-zinc-50 px-2 py-1">
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
                      loadPoints={summary?.totalByMuscle}
                      title="Weekly Muscle Groups Hit"
                      compact
                      showOrganPanel={false}
                    />
                  </div>

                  <div className="mt-2 text-xs text-zinc-500">
                    Total weekly load: {summary?.totalLoad || 0}
                  </div>

                  <div className="mt-2 grid sm:grid-cols-2 gap-2">
                    {nonZeroMuscles.map(({ muscle, load, hitDays, pct }) => (
                      <div
                        key={`${plan.id}-${muscle}`}
                        className="rounded-md bg-white/80 px-2 py-1.5 text-xs"
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

                  <div className="mt-3 rounded-md bg-amber-50/60 px-3 py-2 text-xs">
                    <p className="font-medium text-amber-800">Missing muscle groups</p>
                    <p className="text-amber-700 mt-1">
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

      {showCreateWorkoutModal &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShowCreateWorkoutModal(false);
            }}
          >
            <div
              className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl border border-zinc-200"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-lg font-semibold">Create Workout</h2>
                <button
                  type="button"
                  onClick={() => setShowCreateWorkoutModal(false)}
                  className="px-2 py-1 rounded-md text-xs bg-zinc-200"
                >
                  Close
                </button>
              </div>

              <div className="mb-3">
                <MuscleModel
                  scores={draftMuscleScores}
                  loadPoints={draftLoadPoints}
                  title="Draft Workout Muscle Targets"
                  compact
                  showOrganPanel={false}
                />
              </div>

              <form onSubmit={saveWorkout} className="space-y-3">
                <input
                  type="text"
                  value={newWorkoutName}
                  onChange={(event) => setNewWorkoutName(event.target.value)}
                  placeholder="Workout name (e.g. Push Day)"
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-zinc-50"
                />

                <div className="rounded-lg border border-zinc-200 p-3 space-y-2">
                  <p className="text-sm font-medium">Add Exercise</p>
                  <input
                    type="text"
                    value={exerciseSearch}
                    onChange={(event) => setExerciseSearch(event.target.value)}
                    placeholder="Search known exercises (from library)"
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-zinc-50"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={exerciseSets}
                      min={1}
                      max={30}
                      onChange={(event) => setExerciseSets(Number(event.target.value))}
                      placeholder="Sets"
                      className="border rounded-lg px-3 py-2 text-sm bg-zinc-50"
                    />
                    <input
                      type="number"
                      value={exerciseReps}
                      min={1}
                      max={100}
                      onChange={(event) => setExerciseReps(Number(event.target.value))}
                      placeholder="Reps"
                      className="border rounded-lg px-3 py-2 text-sm bg-zinc-50"
                    />
                    <p className="col-span-2 text-[11px] text-zinc-500">
                      Rest policy: {DEFAULT_REST_SECONDS}s (default) / {LEG_EXERCISE_REST_SECONDS}s for leg
                      exercises.
                    </p>
                  </div>
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 h-44 overflow-y-auto">
                    {filteredKnownExercises.length === 0 && (
                      <p className="px-3 py-2 text-xs text-zinc-500">No matching known exercises.</p>
                    )}
                    {filteredKnownExercises.map((exercise) => (
                      <div
                        key={exercise.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-200 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{exercise.name}</p>
                          <p className="text-[11px] text-zinc-500 truncate">
                            {exercise.muscles.map((muscle) => MUSCLE_LABELS[muscle]).join(", ")} • ~
                            {formatEstimatedDuration(exercise.timeSeconds)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addKnownExerciseToDraft(exercise)}
                          className="px-2 py-1 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 transition-colors shrink-0"
                        >
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCustomExerciseForm((current) => !current)}
                    className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 transition-colors"
                  >
                    {showCustomExerciseForm ? "Hide Custom Exercise" : "Add Custom Exercise"}
                  </button>
                  {showCustomExerciseForm && (
                    <div className="rounded-lg border border-zinc-200 p-3 space-y-2 bg-white">
                      <input
                        type="text"
                        value={exerciseName}
                        onChange={(event) => setExerciseName(event.target.value)}
                        placeholder="Custom exercise name"
                        className="w-full border rounded-lg px-3 py-2 text-sm bg-zinc-50"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          value={exerciseSets}
                          min={1}
                          max={30}
                          onChange={(event) => setExerciseSets(Number(event.target.value))}
                          placeholder="Sets"
                          className="border rounded-lg px-3 py-2 text-sm bg-zinc-50"
                        />
                        <input
                          type="number"
                          value={exerciseReps}
                          min={1}
                          max={100}
                          onChange={(event) => setExerciseReps(Number(event.target.value))}
                          placeholder="Reps"
                          className="border rounded-lg px-3 py-2 text-sm bg-zinc-50"
                        />
                        <p className="col-span-2 text-[11px] text-zinc-500">
                          Rest policy is automatic: {DEFAULT_REST_SECONDS}s default,{" "}
                          {LEG_EXERCISE_REST_SECONDS}s for leg exercises.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                        {UI_MUSCLE_GROUPS.map((muscle) => (
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
                        className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 transition-colors"
                      >
                        Add Custom Exercise
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {draftExercises.length === 0 && (
                    <p className="text-xs text-zinc-500">No exercises added yet.</p>
                  )}
                  {draftExercises.map((exercise) => (
                    <div
                      key={exercise.id}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{exercise.name}</p>
                        <button
                          type="button"
                          onClick={() => removeDraftExercise(exercise.id)}
                          className="px-1.5 py-0.5 rounded bg-zinc-200"
                        >
                          🗑️
                        </button>
                      </div>
                      <p className="text-zinc-500">
                        {exercise.sets} sets x {exercise.reps} reps • Rest{" "}
                        {exercise.restSeconds ?? DEFAULT_REST_SECONDS}s •{" "}
                        {exercise.muscles.map((muscle) => MUSCLE_LABELS[muscle]).join(", ")}
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <input
                          type="number"
                          value={exercise.sets}
                          min={1}
                          max={30}
                          onChange={(event) =>
                            updateDraftExercise(exercise.id, "sets", Number(event.target.value))
                          }
                          placeholder="Sets"
                          className="border rounded px-2 py-1 text-xs bg-white"
                        />
                        <input
                          type="number"
                          value={exercise.reps}
                          min={1}
                          max={100}
                          onChange={(event) =>
                            updateDraftExercise(exercise.id, "reps", Number(event.target.value))
                          }
                          placeholder="Reps"
                          className="border rounded px-2 py-1 text-xs bg-white"
                        />
                        <div className="rounded px-2 py-1 text-xs bg-zinc-100 text-zinc-600">
                          Rest {exercise.restSeconds ?? DEFAULT_REST_SECONDS}s
                        </div>
                      </div>
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
          </div>,
          document.body
        )}

      {previewWorkout &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[95] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setPreviewHoveredMuscles([]);
                setPreviewHoveredExerciseKey(null);
                setPreviewHighlightedMuscles([]);
                setPreviewWorkoutId(null);
              }
            }}
          >
            <div
              className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl border border-zinc-200"
              onMouseDown={(event) => event.stopPropagation()}
            >
              {(() => {
                const previewActiveHighlightedMuscles =
                  previewHoveredExerciseMuscles.length > 0
                    ? previewHoveredExerciseMuscles
                    : previewHighlightedMuscles;
                return (
                  <>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-lg font-semibold">{previewWorkout.name}</h2>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewHoveredMuscles([]);
                    setPreviewHoveredExerciseKey(null);
                    setPreviewHighlightedMuscles([]);
                    setPreviewWorkoutId(null);
                  }}
                  className="px-2 py-1 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300"
                >
                  Close
                </button>
              </div>

              <MuscleModel
                scores={workoutScoresById.get(previewWorkout.id) || fatigueScores}
                loadPoints={workoutLoadById.get(previewWorkout.id)}
                title="Workout Muscle Targets"
                compact
                showOrganPanel={false}
                highlightedMuscles={previewActiveHighlightedMuscles}
                onHighlightedMusclesChange={setPreviewHighlightedMuscles}
              />

              <div className="mt-3 space-y-2">
                {previewWorkout.exercises.map((exercise, exerciseIndex) => {
                  const previewExerciseKey = `${previewWorkout.id}-${exercise.id}-${exerciseIndex}`;
                  const isHighlightedByMuscleSelection =
                    previewHighlightedMuscles.length > 0 &&
                    exercise.muscles.some((muscle) => previewHighlightedMuscles.includes(muscle));
                  const isRowHighlighted = previewHoveredExerciseKey
                    ? previewHoveredExerciseKey === previewExerciseKey
                    : isHighlightedByMuscleSelection;
                  return (
                  <div
                    key={`preview-exercise-${previewExerciseKey}`}
                    onMouseEnter={() => {
                      setPreviewHoveredMuscles(exercise.muscles);
                      setPreviewHoveredExerciseKey(previewExerciseKey);
                    }}
                    onMouseLeave={() => {
                      setPreviewHoveredMuscles([]);
                      setPreviewHoveredExerciseKey(null);
                    }}
                    onFocus={() => {
                      setPreviewHoveredMuscles(exercise.muscles);
                      setPreviewHoveredExerciseKey(previewExerciseKey);
                    }}
                    onBlur={() => {
                      setPreviewHoveredMuscles([]);
                      setPreviewHoveredExerciseKey(null);
                    }}
                    tabIndex={0}
                    className={`rounded-lg border p-2 text-xs transition-colors ${
                      isRowHighlighted
                        ? "border-sky-300 bg-sky-50/70"
                        : "border-zinc-200 bg-zinc-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-tight">{exercise.name}</p>
                      <button
                        type="button"
                        onClick={() =>
                          setExerciseInfoVisible((previous) => ({
                            ...previous,
                            [`preview-${previewWorkout.id}-${exercise.id}`]:
                              !previous[`preview-${previewWorkout.id}-${exercise.id}`],
                          }))
                        }
                        className="pill-btn px-2 py-0.5 text-[11px]"
                        aria-label={`Toggle muscle info for ${exercise.name}`}
                      >
                        i
                      </button>
                    </div>
                    <p className="text-zinc-500 mt-1 stat-mono">
                      {exercise.sets} sets x {exercise.reps} reps • Rest{" "}
                      {exercise.restSeconds ?? DEFAULT_REST_SECONDS}s • Est{" "}
                      {formatEstimatedDuration(getExerciseEstimatedWorkSeconds(exercise))}
                    </p>
                    {exerciseInfoVisible[`preview-${previewWorkout.id}-${exercise.id}`] && (
                      <p className="text-zinc-500 mt-1">
                        Hits: {exercise.muscles.map((muscle) => MUSCLE_LABELS[muscle]).join(", ")}
                      </p>
                    )}
                  </div>
                  );
                })}
              </div>
                  </>
                );
              })()}
            </div>
          </div>,
          document.body
        )}

      {runnerState &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[96] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4"
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget) return;
              setRunnerState(null);
            }}
          >
            <div
              className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl border border-zinc-200"
              onMouseDown={(event) => event.stopPropagation()}
            >
              {(() => {
                if (!runnerWorkout) {
                  return (
                    <div className="space-y-3">
                      <p className="text-sm text-zinc-600">
                        This workout is no longer available.
                      </p>
                      <button
                        type="button"
                        onClick={() => setRunnerState(null)}
                        className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300"
                      >
                        Close
                      </button>
                    </div>
                  );
                }
                const safeExercise = runnerWorkout.exercises[runnerState.exerciseIndex];
                if (!safeExercise) {
                  return (
                    <div className="space-y-3">
                      <p className="text-sm text-zinc-600">Unable to load this workout step.</p>
                      <button
                        type="button"
                        onClick={() => setRunnerState(null)}
                        className="px-3 py-1.5 rounded-md text-xs bg-zinc-200"
                      >
                        Close
                      </button>
                    </div>
                  );
                }

                const totalSets = runnerWorkout.exercises.reduce(
                  (sum, exercise) => sum + Math.max(1, exercise.sets),
                  0
                );
                const completedBefore = runnerWorkout.exercises
                  .slice(0, runnerState.exerciseIndex)
                  .reduce((sum, exercise) => sum + Math.max(1, exercise.sets), 0);
                const currentSetGlobal = completedBefore + runnerState.setIndex + 1;

                return (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                          Workout In Progress
                        </p>
                        <h3 className="text-lg font-semibold">{runnerWorkout.name}</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRunnerState(null)}
                        className="px-2 py-1 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300"
                      >
                        Close
                      </button>
                    </div>

                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                      <p className="text-xs text-zinc-500">
                        Exercise {runnerState.exerciseIndex + 1} of {runnerWorkout.exercises.length}
                      </p>
                      <p className="text-base font-semibold mt-1">{safeExercise.name}</p>
                      <p className="text-xs text-zinc-600 mt-1 stat-mono">
                        Set {runnerState.setIndex + 1}/{Math.max(1, safeExercise.sets)} •{" "}
                        {safeExercise.reps} reps • Rest {safeExercise.restSeconds ?? DEFAULT_REST_SECONDS}s
                      </p>
                      <p className="text-xs text-zinc-500 mt-1 stat-mono">
                        Total progress: {Math.min(currentSetGlobal, totalSets)}/{totalSets} sets
                      </p>
                    </div>

                    {runnerState.phase === "work" && (
                      <button
                        type="button"
                        onClick={completeCurrentRunnerSet}
                        className="w-full px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium"
                      >
                        Complete Set & Next
                      </button>
                    )}

                    {runnerState.phase === "rest" && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                        <p className="text-xs text-amber-800">Resting...</p>
                        <p className="text-2xl font-semibold stat-mono text-amber-900">
                          {formatRestTimer(runnerState.restRemaining)}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setRunnerState((previous) =>
                              previous
                                ? {
                                    ...previous,
                                    phase: "work",
                                    restRemaining: 0,
                                  }
                                : previous
                            )
                          }
                          className="px-3 py-1.5 rounded-md text-xs bg-amber-200 hover:bg-amber-300 text-amber-900"
                        >
                          Skip Rest
                        </button>
                      </div>
                    )}

                    {runnerState.phase === "complete" && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                        <p className="text-sm font-semibold text-emerald-800">Workout complete.</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => logWorkout(runnerWorkout)}
                            disabled={saving}
                            className="px-3 py-1.5 rounded-md text-xs bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-50"
                          >
                            Log Workout
                          </button>
                          <button
                            type="button"
                            onClick={() => setRunnerState(null)}
                            className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>,
          document.body
        )}

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Workout History</h2>
        <div className="space-y-2">
          {payload.logs.length === 0 && <p className="text-sm text-zinc-500">No logged workouts yet.</p>}
          {payload.logs.map((log) => {
            const workout = workoutById.get(log.workoutId);
            return (
              <div
                key={log.id}
                className="rounded-lg bg-zinc-50/70 px-3 py-2 flex items-center justify-between gap-2"
              >
                <div>
                  <p className="text-sm font-medium">{workout?.name || "Deleted workout"}</p>
                  <p className="text-xs text-zinc-500">{log.performedOn}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeLog(log.id)}
                  className="px-2 py-1 rounded-md text-xs bg-zinc-200"
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
