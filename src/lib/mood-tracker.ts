export const MOOD_TRACKER_ENTRIES_STORAGE_KEY = "study-stats.mood-tracker.entries";
export const MOOD_TRACKER_CALENDAR_STORAGE_KEY = "study-stats.mood-tracker.calendar-id";
export const MOOD_TRACKER_UPDATED_EVENT = "study-stats:mood-tracker-updated";

export const MOOD_VALUES = ["angry", "sad", "ok", "good", "happy"] as const;
export type MoodValue = (typeof MOOD_VALUES)[number];

export interface MoodEntry {
  id: string;
  mood: MoodValue;
  rating: number;
  loggedAt: string;
  calendarId: string | null;
  calendarEventId: string | null;
}

export function moodToRating(mood: MoodValue): number {
  return MOOD_VALUES.indexOf(mood) + 1;
}

export function ratingToMood(rating: number): MoodValue {
  const safe = Math.min(5, Math.max(1, Math.round(rating)));
  return MOOD_VALUES[safe - 1];
}

export function parseMoodEntries(raw: string | null): MoodEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const value = item as Partial<MoodEntry>;
        const mood = typeof value.mood === "string" && MOOD_VALUES.includes(value.mood as MoodValue)
          ? (value.mood as MoodValue)
          : null;
        const loggedAt = typeof value.loggedAt === "string" ? value.loggedAt : null;
        if (!mood || !loggedAt) return null;

        return {
          id:
            typeof value.id === "string" && value.id.trim().length > 0
              ? value.id
              : `${loggedAt}-${mood}`,
          mood,
          rating:
            typeof value.rating === "number" && Number.isFinite(value.rating)
              ? Math.min(5, Math.max(1, Math.round(value.rating)))
              : moodToRating(mood),
          loggedAt,
          calendarId: typeof value.calendarId === "string" ? value.calendarId : null,
          calendarEventId: typeof value.calendarEventId === "string" ? value.calendarEventId : null,
        };
      })
      .filter((entry): entry is MoodEntry => Boolean(entry));
  } catch {
    return [];
  }
}
