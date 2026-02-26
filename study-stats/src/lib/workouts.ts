import type {
  MuscleGroup,
  WorkoutExercise,
  WorkoutLogEntry,
  WorkoutPlannerPayload,
  WorkoutTemplate,
} from "@/lib/types";
import { MUSCLE_GROUPS } from "@/lib/types";

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  core: "Core",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
};

const MAX_WORKOUTS = 100;
const MAX_EXERCISES_PER_WORKOUT = 60;
const MAX_LOGS = 3000;

export function emptyWorkoutPayload(): WorkoutPlannerPayload {
  return {
    workouts: [],
    logs: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getDefaultWorkoutTemplates(): WorkoutTemplate[] {
  const createdAt = "2026-02-26T00:00:00.000Z";
  return [
    {
      id: "default-stretching",
      name: "Stretching (Before Every Session)",
      createdAt,
      exercises: [
        { id: "st-1", name: "Arm circles", muscles: ["shoulders"], sets: 2, reps: 15, notes: "15 each direction" },
        { id: "st-2", name: "Band pull-aparts", muscles: ["back", "shoulders"], sets: 1, reps: 15 },
        { id: "st-3", name: "Band face pulls", muscles: ["back", "shoulders"], sets: 1, reps: 15 },
        { id: "st-4", name: "Shoulder dislocates", muscles: ["shoulders", "chest"], sets: 1, reps: 12 },
        { id: "st-5", name: "Chin tucks", muscles: ["core"], sets: 1, reps: 10 },
        { id: "st-6", name: "Upper trap stretch", muscles: ["shoulders"], sets: 2, reps: 20, notes: "20s each side" },
        { id: "st-7", name: "Levator scap stretch", muscles: ["shoulders"], sets: 2, reps: 20, notes: "20s each side" },
        { id: "st-8", name: "Wall posture reset", muscles: ["back", "core"], sets: 1, reps: 60, notes: "60s hold" },
        { id: "st-9", name: "Thoracic rotations", muscles: ["core", "back"], sets: 2, reps: 8, notes: "8 each side" },
        { id: "st-10", name: "Cat-cow", muscles: ["core", "back"], sets: 1, reps: 8 },
        { id: "st-11", name: "Thoracic extensions", muscles: ["back"], sets: 1, reps: 10 },
        { id: "st-12", name: "Hip flexor stretch", muscles: ["glutes", "quads"], sets: 2, reps: 30, notes: "30s each side" },
        { id: "st-13", name: "Deep squat hold", muscles: ["quads", "glutes", "core"], sets: 1, reps: 45, notes: "45s hold" },
        { id: "st-14", name: "Hamstring sweeps", muscles: ["hamstrings"], sets: 2, reps: 8, notes: "8 each side" },
        { id: "st-15", name: "Glute bridges", muscles: ["glutes", "hamstrings"], sets: 1, reps: 12 },
      ],
    },
    {
      id: "default-day-1-push-upper-chest",
      name: "Day 1 - PUSH (Upper Chest Focus)",
      createdAt,
      exercises: [
        { id: "d1-1", name: "Incline Dumbbell Bench", muscles: ["chest", "shoulders", "triceps"], sets: 4, reps: 10, notes: "4x6-10" },
        { id: "d1-2", name: "Flat Dumbbell Bench", muscles: ["chest", "shoulders", "triceps"], sets: 3, reps: 12, notes: "3x8-12" },
        { id: "d1-3", name: "Seated Dumbbell Shoulder Press", muscles: ["shoulders", "triceps"], sets: 3, reps: 10, notes: "3x8-10" },
        { id: "d1-4", name: "Skull Crushers", muscles: ["triceps"], sets: 3, reps: 12, notes: "3x10-12" },
        { id: "d1-5", name: "Lateral Raises", muscles: ["shoulders"], sets: 4, reps: 20, notes: "4x15-20" },
      ],
    },
    {
      id: "default-day-2-pull-width",
      name: "Day 2 - PULL (Width Emphasis)",
      createdAt,
      exercises: [
        { id: "d2-1", name: "Chest-Supported Dumbbell Row", muscles: ["back", "biceps", "forearms"], sets: 4, reps: 12, notes: "4x8-12" },
        { id: "d2-2", name: "Rear Delt Fly", muscles: ["shoulders", "back"], sets: 3, reps: 20, notes: "3x15-20" },
        { id: "d2-3", name: "DB Curl", muscles: ["biceps", "forearms"], sets: 3, reps: 12, notes: "3x8-12" },
        { id: "d2-4", name: "Hammer Curl", muscles: ["biceps", "forearms"], sets: 2, reps: 15, notes: "2x12-15" },
      ],
    },
    {
      id: "default-day-3-legs",
      name: "Day 3 - LEGS (Proper Growth Day)",
      createdAt,
      exercises: [
        { id: "d3-1", name: "DB Front Squat", muscles: ["quads", "glutes", "core"], sets: 4, reps: 12, notes: "4x8-12" },
        { id: "d3-2", name: "Bulgarian Split Squats", muscles: ["quads", "glutes", "hamstrings"], sets: 3, reps: 10, notes: "3x8-10" },
        { id: "d3-3", name: "Dumbbell RDL", muscles: ["hamstrings", "glutes", "back"], sets: 3, reps: 10, notes: "3x8-10" },
        { id: "d3-4", name: "Standing Calf Raises", muscles: ["calves"], sets: 4, reps: 20, notes: "4x12-20" },
        { id: "d3-5", name: "Leg Raises", muscles: ["core"], sets: 3, reps: 15, notes: "3x12-15" },
      ],
    },
    {
      id: "default-day-4-mix",
      name: "Day 4 - MIX",
      createdAt,
      exercises: [
        { id: "d4-1", name: "Dead Hangs", muscles: ["forearms", "shoulders", "back"], sets: 2, reps: 60, notes: "2x30-60s" },
        { id: "d4-2", name: "Push-Ups (slow stretch)", muscles: ["chest", "shoulders", "triceps"], sets: 2, reps: 20, notes: "2xnear failure" },
        { id: "d4-3", name: "Single-Leg Calf Raises", muscles: ["calves"], sets: 3, reps: 12, notes: "12 each leg" },
        { id: "d4-4", name: "Tibialis Raises", muscles: ["calves"], sets: 2, reps: 15, notes: "2x15 (lean against wall)" },
        { id: "d4-5", name: "Hammer Curl", muscles: ["biceps", "forearms"], sets: 3, reps: 12, notes: "2-3x10-12" },
      ],
    },
    {
      id: "default-day-5-push-shoulder",
      name: "Day 5 - PUSH (Shoulder Dominant)",
      createdAt,
      exercises: [
        { id: "d5-1", name: "Standing Dumbbell Shoulder Press", muscles: ["shoulders", "triceps"], sets: 4, reps: 8, notes: "4x6-8" },
        { id: "d5-2", name: "Incline Dumbbell Bench", muscles: ["chest", "shoulders", "triceps"], sets: 3, reps: 12, notes: "3x8-12" },
        { id: "d5-3", name: "Lateral Raises", muscles: ["shoulders"], sets: 4, reps: 20, notes: "4x15-20 (slow + partials last set)" },
        { id: "d5-4", name: "Skull Crusher", muscles: ["triceps"], sets: 3, reps: 12 },
      ],
    },
    {
      id: "default-day-6-5k",
      name: "Day 6 - 5K",
      createdAt,
      exercises: [
        { id: "d6-1", name: "5K Run", muscles: ["quads", "hamstrings", "calves", "core"], sets: 1, reps: 5, notes: "5 kilometers; jam wrap before" },
      ],
    },
    {
      id: "default-day-7-pull-arms",
      name: "Day 7 - PULL (Arms + Detail)",
      createdAt,
      exercises: [
        { id: "d7-1", name: "Chest-Supported Row", muscles: ["back", "biceps", "forearms"], sets: 3, reps: 12, notes: "3x10-12" },
        { id: "d7-2", name: "Rear Delt Fly (standing)", muscles: ["shoulders", "back"], sets: 3, reps: 20, notes: "3x15-20" },
        { id: "d7-3", name: "Dumbbell Curl", muscles: ["biceps", "forearms"], sets: 3, reps: 12, notes: "3x8-12" },
        { id: "d7-4", name: "Cross-Body Hammer Curl", muscles: ["biceps", "forearms"], sets: 2, reps: 15, notes: "2x12-15" },
      ],
    },
  ];
}

export function defaultWorkoutPlannerPayload(): WorkoutPlannerPayload {
  return {
    workouts: getDefaultWorkoutTemplates(),
    logs: [],
    updatedAt: new Date().toISOString(),
  };
}

function safeString(input: unknown, maxLength = 120): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, maxLength);
}

function sanitizeMuscles(input: unknown): MuscleGroup[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(MUSCLE_GROUPS);
  const seen = new Set<MuscleGroup>();
  const result: MuscleGroup[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    if (!allowed.has(item as MuscleGroup)) continue;
    const muscle = item as MuscleGroup;
    if (seen.has(muscle)) continue;
    seen.add(muscle);
    result.push(muscle);
  }
  return result;
}

function sanitizeExercise(input: unknown): WorkoutExercise | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const id = safeString(value.id, 80) || crypto.randomUUID();
  const name = safeString(value.name, 80);
  if (!name) return null;
  const muscles = sanitizeMuscles(value.muscles);
  if (muscles.length === 0) return null;
  const sets = Math.max(1, Math.min(30, Number(value.sets) || 1));
  const reps = Math.max(1, Math.min(100, Number(value.reps) || 1));
  const notes = safeString(value.notes, 300);
  return {
    id,
    name,
    muscles,
    sets,
    reps,
    notes: notes || undefined,
  };
}

function sanitizeWorkout(input: unknown): WorkoutTemplate | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const id = safeString(value.id, 80) || crypto.randomUUID();
  const name = safeString(value.name, 100);
  if (!name) return null;
  const exercisesRaw = Array.isArray(value.exercises) ? value.exercises : [];
  const exercises = exercisesRaw
    .map(sanitizeExercise)
    .filter((entry): entry is WorkoutExercise => Boolean(entry))
    .slice(0, MAX_EXERCISES_PER_WORKOUT);
  if (exercises.length === 0) return null;
  const createdAt = safeString(value.createdAt, 40) || new Date().toISOString();
  return {
    id,
    name,
    exercises,
    createdAt,
  };
}

function sanitizeLog(input: unknown): WorkoutLogEntry | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const id = safeString(value.id, 80) || crypto.randomUUID();
  const workoutId = safeString(value.workoutId, 80);
  const performedOn = safeString(value.performedOn, 10);
  if (!workoutId) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(performedOn)) return null;
  const notes = safeString(value.notes, 400);
  return {
    id,
    workoutId,
    performedOn,
    notes: notes || undefined,
  };
}

export function sanitizeWorkoutPayload(input: unknown): WorkoutPlannerPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return emptyWorkoutPayload();
  }
  const value = input as Record<string, unknown>;
  const workoutsRaw = Array.isArray(value.workouts) ? value.workouts : [];
  const logsRaw = Array.isArray(value.logs) ? value.logs : [];

  const workouts = workoutsRaw
    .map(sanitizeWorkout)
    .filter((entry): entry is WorkoutTemplate => Boolean(entry))
    .slice(0, MAX_WORKOUTS);
  const workoutIds = new Set(workouts.map((workout) => workout.id));

  const logs = logsRaw
    .map(sanitizeLog)
    .filter((entry): entry is WorkoutLogEntry => Boolean(entry))
    .filter((entry) => workoutIds.has(entry.workoutId))
    .slice(0, MAX_LOGS)
    .sort((a, b) => b.performedOn.localeCompare(a.performedOn));

  const updatedAt = safeString(value.updatedAt, 40) || new Date().toISOString();

  return {
    workouts,
    logs,
    updatedAt,
  };
}

function dateKey(input: Date): string {
  return input.toISOString().slice(0, 10);
}

function toUtcDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function daysBetween(fromDate: string, toDate: string): number {
  const from = toUtcDate(fromDate).getTime();
  const to = toUtcDate(toDate).getTime();
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}

export function computeMuscleFatigue(
  payload: WorkoutPlannerPayload,
  now = new Date()
): Record<MuscleGroup, number> {
  const result: Record<MuscleGroup, number> = {
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
  const today = dateKey(now);
  const workoutById = new Map(payload.workouts.map((workout) => [workout.id, workout]));

  for (const log of payload.logs) {
    const workout = workoutById.get(log.workoutId);
    if (!workout) continue;

    const age = daysBetween(log.performedOn, today);
    if (age < 0 || age > 7) continue;

    const decay = Math.max(0, 1 - age * 0.18);
    if (decay <= 0) continue;

    for (const exercise of workout.exercises) {
      const stimulus = Math.max(0.6, Math.min(3, exercise.sets / 4));
      for (const muscle of exercise.muscles) {
        result[muscle] += stimulus * decay;
      }
    }
  }

  let maxValue = 0;
  for (const muscle of MUSCLE_GROUPS) {
    if (result[muscle] > maxValue) maxValue = result[muscle];
  }
  if (maxValue <= 0) return result;

  for (const muscle of MUSCLE_GROUPS) {
    result[muscle] = Math.round((result[muscle] / maxValue) * 100);
  }

  return result;
}
