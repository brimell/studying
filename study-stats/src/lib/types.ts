// ─── Subjects Configuration ───────────────────────────────

export interface SubjectConfig {
  [subject: string]: string[];
}

export const DEFAULT_SUBJECTS: SubjectConfig = {
  Maths: ["maths", "math", "mathematics"],
  "Computer Science": ["computer science", "comp sci", "compsci"],
  "CS NEA": ["cs nea", "csc"],
  Physics: ["physics", "phys"],
  EPQ: ["epq"],
  TMUA: ["tmua"],
  "Project Euler": ["project euler"],
  Articles: ["medium", "article", "blog"],
  STAT: ["stat revision"],
};

// ─── Calendar Event Types ─────────────────────────────────

export interface CalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

// ─── API Response Types ───────────────────────────────────

export interface TodayProgressData {
  totalPlanned: number;
  totalCompleted: number;
  percentageCompleted: number;
}

export interface DailyStudyEntry {
  date: string; // ISO date string
  label: string; // e.g. "Feb 26"
  hours: number;
}

export interface DailyStudyTimeData {
  entries: DailyStudyEntry[];
  averageMonth: number;
  averageWeek: number;
}

export interface SubjectStudyTime {
  subject: string;
  hours: number;
}

export interface StudyDistributionData {
  subjectTimes: SubjectStudyTime[];
  totalHours: number;
  numDays: number;
}

export interface ProjectionData {
  endDate: string;
  daysRemaining: number;
  hoursPerDay: number;
  totalHours: number;
  hoursPerSubject: number;
}

// ─── Habit Tracker Types ──────────────────────────────────

export interface HabitDay {
  date: string; // YYYY-MM-DD
  hours: number;
  level: 0 | 1 | 2 | 3 | 4; // intensity: 0=none, 1=light, 2=medium, 3=good, 4=great
}

export interface HabitCompletionDay {
  date: string;
  completed: boolean;
  hours: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export type HabitMode = "binary" | "duration";

export interface HabitDefinition {
  name: string;
  slug: string;
  mode: HabitMode;
  trackingCalendarId: string | null;
  sourceCalendarIds: string[];
  matchTerms: string[];
  days: HabitCompletionDay[];
  currentStreak: number;
  longestStreak: number;
  totalCompleted: number;
  totalHours: number;
}

export interface TrackerCalendarOption {
  id: string;
  summary: string;
  accessRole: string;
  primary: boolean;
}

export interface HabitTrackerData {
  days: HabitDay[];
  currentStreak: number;
  longestStreak: number;
  totalDaysStudied: number;
  totalHours: number;
  trackerCalendarId: string | null;
  trackerRange: {
    startDate: string;
    endDate: string;
  };
  habits: HabitDefinition[];
}

// ─── Workout Planner Types ───────────────────────────────

export const MUSCLE_GROUPS = [
  "abductors",
  "chest",
  "back",
  "shoulders",
  "biceps",
  "biceps-brachii",
  "brachialis",
  "brachioradialis",
  "triceps",
  "triceps-brachii",
  "upper-arms",
  "forearms",
  "wrist-extensors",
  "wrist-flexors",
  "pronators",
  "supinators",
  "core",
  "obliques",
  "rectus-abdominis",
  "waist",
  "glutes",
  "gluteus-maximus",
  "hips",
  "hip-flexors",
  "hip-adductors",
  "deep-external-rotators",
  "quads",
  "quadriceps",
  "thighs",
  "sartorius",
  "hamstrings",
  "calves",
  "gastrocnemius",
  "soleus",
  "tibialis-anterior",
  "feet",
  "hands",
  "neck",
  "deltoid-anterior",
  "deltoid-medial-lateral",
  "deltoid-posterior",
  "erector-spinae",
  "infraspinatus-teres-minor",
  "latissimus-dorsi-teres-major",
  "levator-scapulae",
  "pectoralis-major",
  "pectoralis-minor",
  "quadratus-lumborum",
  "rhomboids",
  "serratus-anterior",
  "splenius",
  "sternocleidomastoid",
  "subscapularis",
  "supraspinatus",
  "trapezius-lower",
  "trapezius-middle",
  "trapezius-upper",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export interface WorkoutExercise {
  id: string;
  name: string;
  muscles: MuscleGroup[];
  sets: number;
  reps: number;
  notes?: string;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  exercises: WorkoutExercise[];
  createdAt: string;
}

export interface WorkoutLogEntry {
  id: string;
  workoutId: string;
  performedOn: string; // YYYY-MM-DD
  notes?: string;
}

export const WORKOUT_WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type WorkoutWeekDay = (typeof WORKOUT_WEEK_DAYS)[number];

export interface WeeklyWorkoutPlan {
  id: string;
  name: string;
  days: Record<WorkoutWeekDay, string[]>;
  createdAt: string;
}

export interface WorkoutPlannerPayload {
  workouts: WorkoutTemplate[];
  logs: WorkoutLogEntry[];
  weeklyPlans: WeeklyWorkoutPlan[];
  updatedAt: string;
}
