import type {
  MuscleGroup,
  WeeklyWorkoutPlan,
  WorkoutWeekDay,
  WorkoutExercise,
  WorkoutLogEntry,
  WorkoutPlannerPayload,
  WorkoutTemplate,
} from "@/lib/types";
import { MUSCLE_GROUPS, WORKOUT_WEEK_DAYS } from "@/lib/types";
import musclesData from "@/data/muscles.json";
import exerciseMusclesData from "@/data/exercise-muscles.json";

const MUSCLE_DEFINITIONS = musclesData as Array<{ id: MuscleGroup; name: string }>;
const ALLOWED_MUSCLES = new Set<MuscleGroup>(MUSCLE_GROUPS);

const LEGACY_MUSCLE_REMAP: Partial<Record<MuscleGroup, MuscleGroup[]>> = {
  chest: ["pectoralis-major", "pectoralis-minor", "serratus-anterior"],
  back: ["latissimus-dorsi-teres-major", "rhomboids", "trapezius-middle", "erector-spinae"],
  shoulders: ["deltoid-anterior", "deltoid-medial-lateral", "deltoid-posterior", "supraspinatus"],
  biceps: ["biceps-brachii", "brachialis", "brachioradialis"],
  triceps: ["triceps-brachii"],
  forearms: ["brachioradialis", "wrist-extensors", "wrist-flexors", "pronators", "supinators"],
  core: ["rectus-abdominis", "obliques", "quadratus-lumborum"],
  glutes: ["gluteus-maximus", "deep-external-rotators"],
  quads: ["quadriceps", "sartorius"],
  calves: ["gastrocnemius", "soleus", "tibialis-anterior"],
};

const LEGACY_MUSCLE_GROUP_SET = new Set<MuscleGroup>(
  Object.keys(LEGACY_MUSCLE_REMAP) as MuscleGroup[]
);

export const UI_MUSCLE_GROUPS: MuscleGroup[] = MUSCLE_GROUPS.filter(
  (muscle) => !LEGACY_MUSCLE_GROUP_SET.has(muscle)
);

export const STANDARD_REST_SECONDS = 60;
export const LEG_EXERCISE_REST_SECONDS = 180;

const LEG_REST_MUSCLES = new Set<MuscleGroup>([
  "quadriceps",
  "quads",
  "hamstrings",
  "gluteus-maximus",
  "glutes",
  "hip-adductors",
  "hip-flexors",
  "abductors",
  "calves",
  "gastrocnemius",
  "soleus",
  "tibialis-anterior",
  "thighs",
  "sartorius",
  "hips",
  "feet",
]);

export function getPolicyRestSeconds(muscles: MuscleGroup[]): number {
  return muscles.some((muscle) => LEG_REST_MUSCLES.has(muscle))
    ? LEG_EXERCISE_REST_SECONDS
    : STANDARD_REST_SECONDS;
}

function normalizeMuscles(muscles: MuscleGroup[]): MuscleGroup[] {
  const seen = new Set<MuscleGroup>();
  const result: MuscleGroup[] = [];

  for (const muscle of muscles) {
    const mapped = LEGACY_MUSCLE_REMAP[muscle];
    const expanded = mapped && mapped.length > 0 ? mapped : [muscle];

    for (const candidate of expanded) {
      if (!ALLOWED_MUSCLES.has(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);
      result.push(candidate);
    }
  }

  return result;
}

type ExerciseMuscleWeight = {
  id: MuscleGroup;
  percent: number;
};

type ExerciseMuscleMapEntry = {
  exerciseId: string;
  exerciseName: string;
  timeSeconds: number;
  muscles: ExerciseMuscleWeight[];
};

function normalizeWeightedMuscles(muscles: ExerciseMuscleWeight[]): ExerciseMuscleWeight[] {
  const byMuscle = new Map<MuscleGroup, number>();

  for (const muscle of muscles) {
    if (!ALLOWED_MUSCLES.has(muscle.id) || muscle.percent <= 0) continue;
    byMuscle.set(muscle.id, (byMuscle.get(muscle.id) || 0) + muscle.percent);
  }

  return [...byMuscle.entries()]
    .map(([id, percent]) => ({ id, percent }))
    .sort((left, right) => right.percent - left.percent);
}

const MUSCLE_LABELS_FROM_JSON = MUSCLE_DEFINITIONS.reduce(
  (accumulator, entry) => {
    accumulator[entry.id] = entry.name;
    return accumulator;
  },
  {} as Partial<Record<MuscleGroup, string>>
);

export const MUSCLE_LABELS: Record<MuscleGroup, string> = MUSCLE_GROUPS.reduce(
  (accumulator, muscle) => {
    accumulator[muscle] = MUSCLE_LABELS_FROM_JSON[muscle] || muscle;
    return accumulator;
  },
  {} as Record<MuscleGroup, string>
);

const EXERCISE_MUSCLE_ENTRIES: ExerciseMuscleMapEntry[] = (
  exerciseMusclesData as Array<{
    exerciseId: string;
    exerciseName: string;
    timeSeconds?: number;
    muscles: Array<{ id: string; percent: number }>;
  }>
)
  .map((entry) => {
    const muscles = normalizeWeightedMuscles(
      entry.muscles
      .map((muscle) => ({
        id: muscle.id as MuscleGroup,
        percent: Number.isFinite(muscle.percent) ? muscle.percent : 0,
      }))
      .filter((muscle) => ALLOWED_MUSCLES.has(muscle.id) && muscle.percent > 0)
      .sort((left, right) => right.percent - left.percent)
    );

    return {
      exerciseId: entry.exerciseId,
      exerciseName: entry.exerciseName,
      timeSeconds:
        Number.isFinite(entry.timeSeconds) && Number(entry.timeSeconds) > 0
          ? Math.round(Number(entry.timeSeconds))
          : 30,
      muscles,
    };
  })
  .filter((entry) => entry.exerciseId.trim().length > 0 && entry.muscles.length > 0);

export const EXERCISE_MUSCLE_MAP = new Map<string, ExerciseMuscleMapEntry>(
  EXERCISE_MUSCLE_ENTRIES.map((entry) => [entry.exerciseId, entry])
);

function resolveExerciseMuscles(exerciseId: string, fallback: MuscleGroup[]): MuscleGroup[] {
  const mapped = EXERCISE_MUSCLE_MAP.get(exerciseId);
  if (!mapped) return normalizeMuscles(fallback);
  return normalizeMuscles(mapped.muscles.map((muscle) => muscle.id));
}

const MAX_WORKOUTS = 100;
const MAX_EXERCISES_PER_WORKOUT = 60;
const MAX_LOGS = 3000;
const MAX_WEEKLY_PLANS = 30;

const DEFAULT_DAILY_STRETCHING_ID = "default-stretching";
const DEFAULT_TEMPLATE_EXERCISE_LIBRARY_IDS: Record<string, string> = {
  "st-1": "ex-001",
  "st-2": "ex-002",
  "st-3": "ex-003",
  "st-4": "ex-004",
  "st-5": "ex-005",
  "st-6": "ex-046",
  "st-7": "ex-047",
  "st-8": "ex-006",
  "st-9": "ex-007",
  "st-10": "ex-008",
  "st-11": "ex-048",
  "st-12": "ex-049",
  "st-13": "ex-009",
  "st-14": "ex-050",
  "st-15": "ex-010",
  "d1-1": "ex-011",
  "d1-2": "ex-012",
  "d1-3": "ex-016",
  "d1-4": "ex-027",
  "d1-5": "ex-017",
  "d2-1": "ex-022",
  "d2-2": "ex-018",
  "d2-3": "ex-024",
  "d2-4": "ex-025",
  "d3-1": "ex-031",
  "d3-2": "ex-032",
  "d3-3": "ex-033",
  "d3-4": "ex-040",
  "d4-1": "ex-042",
  "d4-2": "ex-013",
  "d4-3": "ex-036",
  "d4-4": "ex-038",
  "d4-5": "ex-025",
  "d4-6": "ex-051",
  "d5-1": "ex-016",
  "d5-2": "ex-011",
  "d5-3": "ex-017",
  "d5-4": "ex-027",
  "d6-1": "ex-045",
  "d7-1": "ex-022",
  "d7-2": "ex-018",
  "d7-3": "ex-024",
  "d7-4": "ex-025",
};
const DEFAULT_DAY_WORKOUT_BY_WEEKDAY: Record<WorkoutWeekDay, string> = {
  monday: "default-day-1-push-upper-chest",
  tuesday: "default-day-2-pull-width",
  wednesday: "default-day-3-legs",
  thursday: "default-day-4-mix",
  friday: "default-day-5-push-shoulder",
  saturday: "default-day-6-5k",
  sunday: "default-day-7-pull-arms",
};

export function emptyWorkoutPayload(): WorkoutPlannerPayload {
  return {
    workouts: [],
    logs: [],
    weeklyPlans: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getDefaultWorkoutTemplates(): WorkoutTemplate[] {
  const createdAt = "2026-02-26T00:00:00.000Z";
  const templates: WorkoutTemplate[] = [
    {
      id: "default-stretching",
      name: "Stretching (Before Every Session)",
      createdAt,
      exercises: [
        { id: "st-1", name: "Arm circles", muscles: [], sets: 2, reps: 15, notes: "15 each direction" },
        { id: "st-2", name: "Band pull-aparts", muscles: [], sets: 1, reps: 15 },
        { id: "st-3", name: "Band face pulls", muscles: [], sets: 1, reps: 15 },
        { id: "st-4", name: "Shoulder dislocates", muscles: [], sets: 1, reps: 12 },
        {
          id: "st-5",
          name: "Chin tucks",
          muscles: [],
          sets: 1,
          reps: 10,
        },
        { id: "st-6", name: "Upper trap stretch", muscles: [], sets: 2, reps: 20, notes: "20s each side" },
        { id: "st-7", name: "Levator scap stretch", muscles: [], sets: 2, reps: 20, notes: "20s each side" },
        { id: "st-8", name: "Wall posture reset", muscles: [], sets: 1, reps: 60, notes: "60s hold" },
        { id: "st-9", name: "Thoracic rotations", muscles: [], sets: 2, reps: 8, notes: "8 each side" },
        { id: "st-10", name: "Cat-cow", muscles: [], sets: 1, reps: 8 },
        { id: "st-11", name: "Thoracic extensions", muscles: [], sets: 1, reps: 10 },
        { id: "st-12", name: "Hip flexor stretch", muscles: [], sets: 2, reps: 30, notes: "30s each side" },
        { id: "st-13", name: "Deep squat hold", muscles: [], sets: 1, reps: 45, notes: "45s hold" },
        { id: "st-14", name: "Hamstring sweeps", muscles: [], sets: 2, reps: 8, notes: "8 each side" },
        { id: "st-15", name: "Glute bridges", muscles: [], sets: 1, reps: 12 },
      ],
    },
    {
      id: "default-day-1-push-upper-chest",
      name: "Day 1 - PUSH (Upper Chest Focus)",
      createdAt,
      exercises: [
        { id: "d1-1", name: "Incline Dumbbell Bench", muscles: [], sets: 4, reps: 10, notes: "4x6-10" },
        { id: "d1-2", name: "Flat Dumbbell Bench", muscles: [], sets: 3, reps: 12, notes: "3x8-12" },
        { id: "d1-3", name: "Seated Dumbbell Shoulder Press", muscles: [], sets: 3, reps: 10, notes: "3x8-10" },
        { id: "d1-4", name: "Skull Crushers", muscles: [], sets: 3, reps: 12, notes: "3x10-12" },
        { id: "d1-5", name: "Lateral Raises", muscles: [], sets: 4, reps: 20, notes: "4x15-20" },
      ],
    },
    {
      id: "default-day-2-pull-width",
      name: "Day 2 - PULL (Width Emphasis)",
      createdAt,
      exercises: [
        { id: "d2-1", name: "Chest-Supported Dumbbell Row", muscles: [], sets: 4, reps: 12, notes: "4x8-12" },
        { id: "d2-2", name: "Rear Delt Fly", muscles: [], sets: 3, reps: 20, notes: "3x15-20" },
        { id: "d2-3", name: "DB Curl", muscles: [], sets: 3, reps: 12, notes: "3x8-12" },
        { id: "d2-4", name: "Hammer Curl", muscles: [], sets: 2, reps: 15, notes: "2x12-15" },
      ],
    },
    {
      id: "default-day-3-legs",
      name: "Day 3 - LEGS (Proper Growth Day)",
      createdAt,
      exercises: [
        { id: "d3-1", name: "DB Front Squat", muscles: [], sets: 4, reps: 12, notes: "4x8-12" },
        { id: "d3-2", name: "Bulgarian Split Squats", muscles: [], sets: 3, reps: 10, notes: "3x8-10" },
        { id: "d3-3", name: "Dumbbell RDL", muscles: [], sets: 3, reps: 10, notes: "3x8-10" },
        { id: "d3-4", name: "Leg Raises", muscles: [], sets: 3, reps: 15, notes: "3x12-15" },
      ],
    },
    {
      id: "default-day-4-mix",
      name: "Day 4 - MIX",
      createdAt,
      exercises: [
        { id: "d4-1", name: "Dead Hangs", muscles: [], sets: 2, reps: 60, notes: "2x30-60s" },
        { id: "d4-2", name: "Push-Ups (slow stretch)", muscles: [], sets: 3, reps: 12, notes: "3 sets" },
        { id: "d4-3", name: "Single-Leg Calf Raises", muscles: [], sets: 3, reps: 12, notes: "3 sets" },
        { id: "d4-4", name: "Tibialis Raises", muscles: [], sets: 2, reps: 15, notes: "2 sets (lean against wall)" },
        { id: "d4-5", name: "Hammer Curl", muscles: [], sets: 3, reps: 12, notes: "2-3x10-12" },
        { id: "d4-6", name: "Palm down wrist curl", muscles: [], sets: 2, reps: 15 },
      ],
    },
    {
      id: "default-day-5-push-shoulder",
      name: "Day 5 - PUSH (Shoulder Dominant)",
      createdAt,
      exercises: [
        { id: "d5-1", name: "Standing Dumbbell Shoulder Press", muscles: [], sets: 4, reps: 8, notes: "4x6-8" },
        { id: "d5-2", name: "Incline Dumbbell Bench", muscles: [], sets: 3, reps: 12, notes: "3x8-12" },
        { id: "d5-3", name: "Lateral Raises", muscles: [], sets: 4, reps: 20, notes: "4x15-20 (slow + partials last set)" },
        { id: "d5-4", name: "Skull Crusher", muscles: [], sets: 3, reps: 12 },
      ],
    },
    {
      id: "default-day-6-5k",
      name: "Day 6 - 5K",
      createdAt,
      exercises: [
        { id: "d6-1", name: "5K Run", muscles: [], sets: 1, reps: 5, notes: "jam wrap before" },
      ],
    },
    {
      id: "default-day-7-pull-arms",
      name: "Day 7 - PULL (Arms + Detail)",
      createdAt,
      exercises: [
        { id: "d7-1", name: "Chest-Supported Row", muscles: [], sets: 3, reps: 12, notes: "3x10-12" },
        { id: "d7-2", name: "Rear Delt Fly (standing)", muscles: [], sets: 3, reps: 20, notes: "3x15-20" },
        { id: "d7-3", name: "Dumbbell Curl", muscles: [], sets: 3, reps: 12, notes: "3x8-12" },
        { id: "d7-4", name: "Cross-Body Hammer Curl", muscles: [], sets: 2, reps: 15, notes: "2x12-15" },
      ],
    },
  ];

  return templates.map((template) => ({
    ...template,
    exercises: template.exercises.map((exercise) => {
      const muscles = resolveExerciseMuscles(
        DEFAULT_TEMPLATE_EXERCISE_LIBRARY_IDS[exercise.id] || exercise.id,
        []
      );
      return {
        ...exercise,
        muscles,
        restSeconds: getPolicyRestSeconds(muscles),
      };
    }),
  }));
}

function getDefaultWeeklyPlans(): WeeklyWorkoutPlan[] {
  const createdAt = new Date().toISOString();

  return [
    {
      id: "default-weekly-plan",
      name: "Default Weekly Plan",
      days: {
        monday: [DEFAULT_DAILY_STRETCHING_ID, DEFAULT_DAY_WORKOUT_BY_WEEKDAY.monday],
        tuesday: [DEFAULT_DAILY_STRETCHING_ID, DEFAULT_DAY_WORKOUT_BY_WEEKDAY.tuesday],
        wednesday: [DEFAULT_DAILY_STRETCHING_ID, DEFAULT_DAY_WORKOUT_BY_WEEKDAY.wednesday],
        thursday: [DEFAULT_DAILY_STRETCHING_ID, DEFAULT_DAY_WORKOUT_BY_WEEKDAY.thursday],
        friday: [DEFAULT_DAILY_STRETCHING_ID, DEFAULT_DAY_WORKOUT_BY_WEEKDAY.friday],
        saturday: [DEFAULT_DAILY_STRETCHING_ID, DEFAULT_DAY_WORKOUT_BY_WEEKDAY.saturday],
        sunday: [DEFAULT_DAILY_STRETCHING_ID, DEFAULT_DAY_WORKOUT_BY_WEEKDAY.sunday],
      },
      createdAt,
    },
  ];
}

export function defaultWorkoutPlannerPayload(): WorkoutPlannerPayload {
  return {
    workouts: getDefaultWorkoutTemplates(),
    logs: [],
    weeklyPlans: getDefaultWeeklyPlans(),
    updatedAt: new Date().toISOString(),
  };
}

export function forceApplyDefaultTemplates(
  payload: WorkoutPlannerPayload
): { payload: WorkoutPlannerPayload; changed: boolean } {
  const defaults = getDefaultWorkoutTemplates();
  const defaultIds = new Set(defaults.map((workout) => workout.id));
  const existingById = new Map(payload.workouts.map((workout) => [workout.id, workout]));

  let changed = false;
  const nextWorkouts: WorkoutTemplate[] = [...defaults];

  // Preserve non-default custom workouts as-is.
  for (const workout of payload.workouts) {
    if (defaultIds.has(workout.id)) continue;
    nextWorkouts.push(workout);
  }

  // Detect whether defaults differ from what user currently has.
  for (const defaultWorkout of defaults) {
    const existing = existingById.get(defaultWorkout.id);
    if (!existing) {
      changed = true;
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(defaultWorkout)) {
      changed = true;
    }
  }

  if (nextWorkouts.length !== payload.workouts.length) {
    changed = true;
  }

  const nextWeeklyPlans =
    payload.weeklyPlans.length > 0 ? payload.weeklyPlans : getDefaultWeeklyPlans();
  if (payload.weeklyPlans.length === 0) {
    changed = true;
  }

  if (!changed) {
    return { payload, changed: false };
  }

  return {
    payload: {
      ...payload,
      workouts: nextWorkouts,
      weeklyPlans: nextWeeklyPlans,
      updatedAt: new Date().toISOString(),
    },
    changed: true,
  };
}

function safeString(input: unknown, maxLength = 120): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, maxLength);
}

function sanitizeMuscles(input: unknown): MuscleGroup[] {
  if (!Array.isArray(input)) return [];
  const base: MuscleGroup[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    if (!ALLOWED_MUSCLES.has(item as MuscleGroup)) continue;
    base.push(item as MuscleGroup);
  }
  return normalizeMuscles(base);
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
  const restSeconds = getPolicyRestSeconds(muscles);
  const notes = safeString(value.notes, 300);
  return {
    id,
    name,
    muscles,
    sets,
    reps,
    restSeconds,
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

function emptyWeekPlanDays(): Record<WorkoutWeekDay, string[]> {
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

function sanitizeWeeklyPlan(input: unknown): WeeklyWorkoutPlan | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const id = safeString(value.id, 80) || crypto.randomUUID();
  const name = safeString(value.name, 100);
  if (!name) return null;

  const rawDays =
    value.days && typeof value.days === "object" && !Array.isArray(value.days)
      ? (value.days as Record<string, unknown>)
      : {};

  const days = emptyWeekPlanDays();
  for (const day of WORKOUT_WEEK_DAYS) {
    const rawWorkoutId = rawDays[day];
    if (Array.isArray(rawWorkoutId)) {
      const seen = new Set<string>();
      for (const entry of rawWorkoutId) {
        const parsed = safeString(entry, 80);
        if (!parsed || seen.has(parsed)) continue;
        seen.add(parsed);
        days[day].push(parsed);
      }
      continue;
    }

    const legacySingle = safeString(rawWorkoutId, 80);
    if (legacySingle) {
      days[day] = [legacySingle];
    }
  }

  const createdAt = safeString(value.createdAt, 40) || new Date().toISOString();

  return {
    id,
    name,
    days,
    createdAt,
  };
}

export function sanitizeWorkoutPayload(input: unknown): WorkoutPlannerPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return emptyWorkoutPayload();
  }
  const value = input as Record<string, unknown>;
  const workoutsRaw = Array.isArray(value.workouts) ? value.workouts : [];
  const logsRaw = Array.isArray(value.logs) ? value.logs : [];
  const weeklyPlansRaw = Array.isArray(value.weeklyPlans) ? value.weeklyPlans : [];

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

  const weeklyPlans = weeklyPlansRaw
    .map(sanitizeWeeklyPlan)
    .filter((entry): entry is WeeklyWorkoutPlan => Boolean(entry))
    .slice(0, MAX_WEEKLY_PLANS)
    .map((plan) => {
      const days = emptyWeekPlanDays();
      for (const day of WORKOUT_WEEK_DAYS) {
        days[day] = plan.days[day].filter((workoutId) => workoutIds.has(workoutId));
      }
      return {
        ...plan,
        days,
      };
    });

  const updatedAt = safeString(value.updatedAt, 40) || new Date().toISOString();

  return {
    workouts,
    logs,
    weeklyPlans,
    updatedAt,
  };
}

function toUtcDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

type FatigueTier = "light" | "moderate" | "heavy" | "very-heavy";

function createMuscleNumberMap(initialValue = 0): Record<MuscleGroup, number> {
  return Object.fromEntries(MUSCLE_GROUPS.map((muscle) => [muscle, initialValue])) as Record<
    MuscleGroup,
    number
  >;
}

function getBaseRecoveryHours(muscle: MuscleGroup): number {
  if (
    [
      "quadriceps",
      "quads",
      "hamstrings",
      "thighs",
      "gluteus-maximus",
      "glutes",
      "hip-flexors",
      "hip-adductors",
      "abductors",
      "sartorius",
      "deep-external-rotators",
      "hips",
    ].includes(muscle)
  ) {
    return 84;
  }

  if (["calves", "gastrocnemius", "soleus", "tibialis-anterior", "feet"].includes(muscle)) {
    return 48;
  }

  if (
    [
      "pectoralis-major",
      "pectoralis-minor",
      "chest",
      "back",
      "latissimus-dorsi-teres-major",
      "rhomboids",
      "trapezius-upper",
      "trapezius-middle",
      "trapezius-lower",
      "erector-spinae",
      "quadratus-lumborum",
      "splenius",
      "levator-scapulae",
    ].includes(muscle)
  ) {
    return 60;
  }

  return 36;
}

const TIER_MULTIPLIER: Record<FatigueTier, number> = {
  light: 0.35,
  moderate: 0.75,
  heavy: 1,
  "very-heavy": 1.3,
};

const TIER_PEAK_LOAD: Record<FatigueTier, number> = {
  light: 0.35,
  moderate: 0.55,
  heavy: 0.75,
  "very-heavy": 0.9,
};

function classifyFatigueTier(stimulus: number): FatigueTier {
  if (stimulus < 2.5) return "light";
  if (stimulus < 5) return "moderate";
  if (stimulus < 8) return "heavy";
  return "very-heavy";
}

function repFactor(reps: number): number {
  return Math.max(0.7, Math.min(1.6, reps / 10));
}

function getMuscleStimulusByLog(workout: WorkoutTemplate): Record<MuscleGroup, number> {
  const byMuscle = createMuscleNumberMap(0);

  for (const exercise of workout.exercises) {
    const perExerciseStimulus = Math.max(0.6, exercise.sets * repFactor(exercise.reps));
    const mapped = EXERCISE_MUSCLE_MAP.get(exercise.id);

    if (mapped && mapped.muscles.length > 0) {
      for (const weightedMuscle of mapped.muscles) {
        if (!ALLOWED_MUSCLES.has(weightedMuscle.id) || weightedMuscle.percent <= 0) continue;
        byMuscle[weightedMuscle.id] += perExerciseStimulus * (weightedMuscle.percent / 100);
      }
      continue;
    }

    const fallbackMuscles = normalizeMuscles(exercise.muscles);
    if (fallbackMuscles.length === 0) continue;
    const perMuscleShare = perExerciseStimulus / fallbackMuscles.length;

    for (const muscle of fallbackMuscles) {
      byMuscle[muscle] += perMuscleShare;
    }
  }

  return byMuscle;
}

function getAgeHours(performedOn: string, now: Date): number {
  const performedAt = toUtcDate(performedOn).getTime() + 12 * 60 * 60 * 1000;
  return Math.max(0, (now.getTime() - performedAt) / (1000 * 60 * 60));
}

export function computeMuscleFatigue(
  payload: WorkoutPlannerPayload,
  now = new Date()
): Record<MuscleGroup, number> {
  const result = createMuscleNumberMap(0);
  const workoutById = new Map(payload.workouts.map((workout) => [workout.id, workout]));
  const carryoverLoad = createMuscleNumberMap(0);

  for (const log of payload.logs) {
    const workout = workoutById.get(log.workoutId);
    if (!workout) continue;

    const ageHours = getAgeHours(log.performedOn, now);
    if (ageHours < 0 || ageHours > 24 * 14) continue;

    const stimulusByMuscle = getMuscleStimulusByLog(workout);

    for (const muscle of MUSCLE_GROUPS) {
      const stimulus = stimulusByMuscle[muscle];
      if (stimulus <= 0) continue;

      const tier = classifyFatigueTier(stimulus);
      const recoveryHours = getBaseRecoveryHours(muscle) * TIER_MULTIPLIER[tier];
      if (recoveryHours <= 0) continue;

      const decay = Math.exp((-3 * ageHours) / recoveryHours);
      const remainingLoad = TIER_PEAK_LOAD[tier] * decay;

      const existing = carryoverLoad[muscle];
      carryoverLoad[muscle] = 1 - (1 - existing) * (1 - remainingLoad);
    }
  }

  for (const muscle of MUSCLE_GROUPS) {
    result[muscle] = Math.round(carryoverLoad[muscle] * 100);
  }

  return result;
}
