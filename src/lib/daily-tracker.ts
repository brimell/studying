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

export const SUPPLEMENT_OPTIONS = ["ashwaghanda", "l-theanine", "creatine", "vitamin d"] as const;

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
  morningSleepRating: number | null;
  sleepStuff: string[];

  moodRating: number | null;
  emotions: string[];
  emotionOther: string;
  productivity: number | null;
  motivation: number | null;

  headache: number | null;
  fatigue: number | null;
  coughing: number | null;

  alcohol: number | null;
  caffeineMg: number | null;

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
    morningSleepRating: null,
    sleepStuff: [],

    moodRating: null,
    emotions: [],
    emotionOther: "",
    productivity: null,
    motivation: null,

    headache: null,
    fatigue: null,
    coughing: null,

    alcohol: null,
    caffeineMg: null,

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

function toNullableNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
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

export function parseDailyTrackerFormData(
  value: unknown,
  dateFallback = todayDateKey()
): DailyTrackerFormData {
  const raw = value && typeof value === "object" ? (value as Partial<DailyTrackerFormData>) : {};
  const fallback = defaultDailyTrackerFormData(dateFallback);

  return {
    date:
      typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
        ? raw.date
        : fallback.date,
    morningSleepRating: toNullableNumber(raw.morningSleepRating, 0, 10),
    sleepStuff: toStringArray(raw.sleepStuff),

    moodRating: toNullableNumber(raw.moodRating, 0, 10),
    emotions: toStringArray(raw.emotions),
    emotionOther: toStringValue(raw.emotionOther),
    productivity: toNullableNumber(raw.productivity, 0, 10),
    motivation: toNullableNumber(raw.motivation, 0, 10),

    headache: toNullableNumber(raw.headache, 0, 4),
    fatigue: toNullableNumber(raw.fatigue, 0, 10),
    coughing: toNullableNumber(raw.coughing, 0, 10),

    alcohol: toNullableNumber(raw.alcohol, 0, 10),
    caffeineMg: toNullableNumber(raw.caffeineMg, 0, 200),

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
        const date =
          typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
            ? value.date
            : null;
        const loggedAt = typeof value.loggedAt === "string" ? value.loggedAt : null;
        if (!date || !loggedAt) return null;

        return {
          id:
            typeof value.id === "string" && value.id.trim().length > 0
              ? value.id
              : `${date}-${loggedAt}`,
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

function joinIfAny(lines: string[], label: string, values: string[]): void {
  if (values.length === 0) return;
  lines.push(`${label}: ${values.join(", ")}`);
}

function pushMetric(lines: string[], label: string, value: number | null, denominator: number): void {
  if (value === null) return;
  lines.push(`${label}: ${value}/${denominator}`);
}

export function serializeDailyTrackerForDescription(form: DailyTrackerFormData): string {
  const lines: string[] = [];

  pushMetric(lines, "Sleep rating", form.morningSleepRating, 10);
  joinIfAny(lines, "Sleep stuff", form.sleepStuff);

  pushMetric(lines, "Mood rating", form.moodRating, 10);
  joinIfAny(lines, "Emotions", form.emotions);
  if (form.emotionOther.trim()) lines.push(`Emotion other: ${form.emotionOther.trim()}`);
  pushMetric(lines, "Productivity", form.productivity, 10);
  pushMetric(lines, "Motivation", form.motivation, 10);

  pushMetric(lines, "Headache", form.headache, 4);
  pushMetric(lines, "Fatigue/tiredness", form.fatigue, 10);
  pushMetric(lines, "Coughing", form.coughing, 10);

  pushMetric(lines, "Alcohol", form.alcohol, 10);
  if (form.caffeineMg !== null) lines.push(`Caffeine: ${form.caffeineMg}mg`);
  joinIfAny(lines, "Supps", form.supplements);
  joinIfAny(lines, "Exercise", form.exercise);
  joinIfAny(lines, "School", form.school);
  joinIfAny(lines, "Events", form.events);
  joinIfAny(lines, "Hobbies", form.hobbies);
  joinIfAny(lines, "Chores", form.chores);
  joinIfAny(lines, "Other factors", form.otherFactors);
  if (form.otherFactorsNotes.trim()) lines.push(`Other factors notes: ${form.otherFactorsNotes.trim()}`);

  if (form.todaysNote.trim()) {
    lines.push("Today note:");
    lines.push(form.todaysNote.trim());
  }

  if (form.media.length > 0) {
    lines.push("Files:");
    for (const file of form.media) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      lines.push(`- ${file.name} (${file.type || "unknown"}, ${sizeMb} MB)`);
    }
  }

  if (form.kolbExperience.trim()) lines.push(`Kolb experience: ${form.kolbExperience.trim()}`);
  if (form.kolbReflection.trim()) lines.push(`Kolb reflection: ${form.kolbReflection.trim()}`);
  if (form.kolbAbstraction.trim()) lines.push(`Kolb abstraction: ${form.kolbAbstraction.trim()}`);
  if (form.kolbExperimentation.trim()) lines.push(`Kolb experimentation: ${form.kolbExperimentation.trim()}`);

  return lines.join("\n").trim();
}

function formatLoggedTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function serializeDailyTrackerDayDescription(entries: DailyTrackerEntry[]): string {
  const sorted = [...entries].sort((left, right) => left.loggedAt.localeCompare(right.loggedAt));
  if (sorted.length === 0) return "No logs for this day.";

  const lines: string[] = [`Daily tracker logs: ${sorted.length}`];

  sorted.forEach((entry, index) => {
    lines.push("");
    lines.push(`Log ${index + 1} (${formatLoggedTime(entry.loggedAt)})`);
    const body = serializeDailyTrackerForDescription(entry.form);
    if (!body) {
      lines.push("No answers logged.");
      return;
    }
    lines.push(body);
  });

  return lines.join("\n").trim();
}
