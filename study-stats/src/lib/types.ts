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

export interface HabitTrackerData {
  days: HabitDay[];
  currentStreak: number;
  longestStreak: number;
  totalDaysStudied: number;
  totalHours: number;
}
