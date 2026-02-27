export const DAILY_TRACKER_ENTRIES_STORAGE_KEY = "study-stats.daily-tracker.entries";
export const DAILY_TRACKER_CALENDAR_STORAGE_KEY = "study-stats.daily-tracker.calendar-id";
export const DAILY_TRACKER_UPDATED_EVENT = "study-stats:daily-tracker-updated";

export const SLEEP_STUFF_OPTIONS = [
  "blue light blocking glasses",
  "screens before bed",
  "early bedtime",
  "meditate",
  "on time bedtime",
  "late bedtime",
] as const;

export const EMOTION_OPTIONS = [
  "excited",
  "relaxed",
  "proud",
  "happy",
  "good",
  "chill",
  "depressed",
  "lonely",
  "anxious",
  "sad",
  "angry",
  "annoyed",
  "tired",
  "stressed",
] as const;

export const SUPPLEMENT_OPTIONS = [
  "ashwaghanda",
  "l-theanine",
  "creatine",
  "vitamin d",
] as const;

export const EXERCISE_OPTIONS = ["run", "sports"] as const;

export const SCHOOL_OPTIONS = ["classes", "studying", "hw", "exam"] as const;

export const EVENT_OPTIONS = [
  "stay home",
  "go out to eat (restaurant/cafe)",
  "travel (plane/car journey)",
  "party",
] as const;

export const HOBBY_OPTIONS = [
  "movie",
  "tv show",
  "read a book",
  "shopping",
  "video games",
  "play music (guitar, piano, sax etc)",
] as const;

export const CHORE_OPTIONS = ["chores", "laundry"] as const;

export interface TrackerFileMeta {
  name: string;
  type: string;
  size: number;
}

export interface DailyTrackerFormData {
  date: string;
  morningSleepRating: number;
  sleepStuff: string[];

  moodRating: number;
  emotions: string[];
  emotionOther: string;
  productivity: number;
  motivation: number;

  headache: number;
  fatigue: number;
  coughing: number;

  alcohol: number;
  caffeineMg: number;

  supplements: string[];
  exercise: string[];
  school: string[];
  events: string[];
  hobbies: string[];
  chores: string[];
  otherFactors: string[];
  otherFactorsNotes: string;

  todaysNote: string;
  media: TrackerFileMeta[];

  kolbExperience: string;
  kolbReflection: string;
  kolbAbstraction: string;
  kolbExperimentation: string;
}

export interface DailyTrackerEntry {
  id: string;
  date: string;
  loggedAt: string;
  calendarId: string | null;
  calendarEventId: string | null;
  form: DailyTrackerFormData;
}

export function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultDailyTrackerFormData(date = todayDateKey()): DailyTrackerFormData {
  return {
    date,
    morningSleepRating: 5,
    sleepStuff: [],

    moodRating: 5,
    emotions: [],
    emotionOther: "",
    productivity: 5,
    motivation: 5,

    headache: 0,
    fatigue: 5,
    coughing: 0,

    alcohol: 0,
    caffeineMg: 0,

    supplements: [],
    exercise: [],
    school: [],
    events: [],
    hobbies: [],
    chores: [],
    otherFactors: [],
    otherFactorsNotes: "",

    todaysNote: "",
    media: [],

    kolbExperience: "",
    kolbReflection: "",
    kolbAbstraction: "",
    kolbExperimentation: "",
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeMedia(value: unknown): TrackerFileMeta[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const file = entry as Partial<TrackerFileMeta>;
      const name = typeof file.name === "string" ? file.name.trim() : "";
      const type = typeof file.type === "string" ? file.type : "";
      const size = typeof file.size === "number" && Number.isFinite(file.size) ? file.size : 0;
      if (!name) return null;
      return { name, type, size };
    })
    .filter((entry): entry is TrackerFileMeta => Boolean(entry))
    .slice(0, 10);
}

export function parseDailyTrackerFormData(value: unknown, dateFallback = todayDateKey()): DailyTrackerFormData {
  const raw = value && typeof value === "object" ? (value as Partial<DailyTrackerFormData>) : {};
  const fallback = defaultDailyTrackerFormData(dateFallback);

  return {
    date: typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : fallback.date,
    morningSleepRating: toNumber(raw.morningSleepRating, fallback.morningSleepRating, 0, 10),
    sleepStuff: toStringArray(raw.sleepStuff),

    moodRating: toNumber(raw.moodRating, fallback.moodRating, 0, 10),
    emotions: toStringArray(raw.emotions),
    emotionOther: toStringValue(raw.emotionOther),
    productivity: toNumber(raw.productivity, fallback.productivity, 0, 10),
    motivation: toNumber(raw.motivation, fallback.motivation, 0, 10),

    headache: toNumber(raw.headache, fallback.headache, 0, 4),
    fatigue: toNumber(raw.fatigue, fallback.fatigue, 0, 10),
    coughing: toNumber(raw.coughing, fallback.coughing, 0, 10),

    alcohol: toNumber(raw.alcohol, fallback.alcohol, 0, 10),
    caffeineMg: toNumber(raw.caffeineMg, fallback.caffeineMg, 0, 200),

    supplements: toStringArray(raw.supplements),
    exercise: toStringArray(raw.exercise),
    school: toStringArray(raw.school),
    events: toStringArray(raw.events),
    hobbies: toStringArray(raw.hobbies),
    chores: toStringArray(raw.chores),
    otherFactors: toStringArray(raw.otherFactors),
    otherFactorsNotes: toStringValue(raw.otherFactorsNotes),

    todaysNote: toStringValue(raw.todaysNote),
    media: normalizeMedia(raw.media),

    kolbExperience: toStringValue(raw.kolbExperience),
    kolbReflection: toStringValue(raw.kolbReflection),
    kolbAbstraction: toStringValue(raw.kolbAbstraction),
    kolbExperimentation: toStringValue(raw.kolbExperimentation),
  };
}

export function parseDailyTrackerEntries(raw: string | null): DailyTrackerEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const value = item as Partial<DailyTrackerEntry>;
        const date = typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
          ? value.date
          : null;
        const loggedAt = typeof value.loggedAt === "string" ? value.loggedAt : null;
        if (!date || !loggedAt) return null;

        return {
          id: typeof value.id === "string" && value.id.trim().length > 0 ? value.id : `${date}-${loggedAt}`,
          date,
          loggedAt,
          calendarId: typeof value.calendarId === "string" ? value.calendarId : null,
          calendarEventId: typeof value.calendarEventId === "string" ? value.calendarEventId : null,
          form: parseDailyTrackerFormData(value.form, date),
        };
      })
      .filter((entry): entry is DailyTrackerEntry => Boolean(entry));
  } catch {
    return [];
  }
}

function joinOrNone(label: string, values: string[]): string {
  return `${label}: ${values.length > 0 ? values.join(", ") : "none"}`;
}

export function serializeDailyTrackerForDescription(form: DailyTrackerFormData): string {
  const lines: string[] = [];

  lines.push("MORNING");
  lines.push(`Sleep rating: ${form.morningSleepRating}/10`);
  lines.push(joinOrNone("Sleep stuff", form.sleepStuff));
  lines.push("");

  lines.push("EVENING RESULTS");
  lines.push(`Mood rating: ${form.moodRating}/10`);
  lines.push(joinOrNone("Emotions", form.emotions));
  if (form.emotionOther.trim()) {
    lines.push(`Emotion other: ${form.emotionOther.trim()}`);
  }
  lines.push(`Productivity: ${form.productivity}/10`);
  lines.push(`Motivation: ${form.motivation}/10`);
  lines.push("");

  lines.push("SYMPTOMS");
  lines.push(`Headache: ${form.headache}/4`);
  lines.push(`Fatigue/tiredness: ${form.fatigue}/10`);
  lines.push(`Coughing: ${form.coughing}/10`);
  lines.push("");

  lines.push("FACTORS");
  lines.push(`Alcohol: ${form.alcohol}/10`);
  lines.push(`Caffeine: ${form.caffeineMg}mg`);
  lines.push(joinOrNone("Supps", form.supplements));
  lines.push(joinOrNone("Exercise", form.exercise));
  lines.push(joinOrNone("School", form.school));
  lines.push(joinOrNone("Events", form.events));
  lines.push(joinOrNone("Hobbies", form.hobbies));
  lines.push(joinOrNone("Chores", form.chores));
  lines.push(joinOrNone("Other factors", form.otherFactors));
  if (form.otherFactorsNotes.trim()) {
    lines.push(`Other factors notes: ${form.otherFactorsNotes.trim()}`);
  }
  lines.push("");

  if (form.todaysNote.trim()) {
    lines.push("TODAY'S NOTE");
    lines.push(form.todaysNote.trim());
    lines.push("");
  }

  if (form.media.length > 0) {
    lines.push("TODAY'S FILES");
    for (const file of form.media) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      lines.push(`- ${file.name} (${file.type || "unknown"}, ${sizeMb} MB)`);
    }
    lines.push("");
  }

  lines.push("KOLB'S CYCLE");
  lines.push(`Experience: ${form.kolbExperience.trim() || ""}`);
  lines.push(`Reflection: ${form.kolbReflection.trim() || ""}`);
  lines.push(`Abstraction: ${form.kolbAbstraction.trim() || ""}`);
  lines.push(`Experimentation: ${form.kolbExperimentation.trim() || ""}`);

  return lines.join("\n").trim();
}
