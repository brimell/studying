"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  MOOD_TRACKER_CALENDAR_STORAGE_KEY,
  MOOD_TRACKER_ENTRIES_STORAGE_KEY,
  MOOD_TRACKER_UPDATED_EVENT,
  MOOD_RATING_MAX,
  MOOD_RATING_MIN,
  moodToRating,
  parseMoodEntries,
  ratingToMood,
  type MoodEntry,
  type MoodValue,
} from "@/lib/mood-tracker";

interface MoodTrackerPopupProps {
  onClose: () => void;
}

interface MoodOption {
  value: MoodValue;
  label: string;
}

const MOOD_OPTIONS: MoodOption[] = [
  { value: "angry", label: "Angry" },
  { value: "sad", label: "Sad" },
  { value: "ok", label: "OK" },
  { value: "good", label: "Good" },
  { value: "happy", label: "Happy" },
];

const MAX_MOOD_ENTRIES = 365;

type SyncPayload = Record<string, string>;

async function syncMoodEntriesToCloud(entries: MoodEntry[]): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Sign in to your site account to sync mood logs to cloud.");
  }

  const readResponse = await fetch("/api/account-sync", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const readPayload = (await readResponse.json()) as {
    payload?: SyncPayload;
    error?: string;
  };

  if (!readResponse.ok) {
    throw new Error(readPayload.error || "Failed to read cloud settings before mood sync.");
  }

  const payload: SyncPayload = {
    ...(readPayload.payload || {}),
    [MOOD_TRACKER_ENTRIES_STORAGE_KEY]: JSON.stringify(entries),
  };

  const selectedCalendarId = window.localStorage.getItem(MOOD_TRACKER_CALENDAR_STORAGE_KEY);
  if (selectedCalendarId) {
    payload[MOOD_TRACKER_CALENDAR_STORAGE_KEY] = selectedCalendarId;
  } else {
    delete payload[MOOD_TRACKER_CALENDAR_STORAGE_KEY];
  }

  const writeResponse = await fetch("/api/account-sync", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload }),
  });

  const writePayload = (await writeResponse.json()) as {
    error?: string;
  };

  if (!writeResponse.ok) {
    throw new Error(writePayload.error || "Failed to sync mood logs to cloud.");
  }
}

export default function MoodTrackerPopup({ onClose }: MoodTrackerPopupProps) {
  const { data: googleSession } = useSession();
  const [latestEntry, setLatestEntry] = useState<MoodEntry | null>(() => {
    if (typeof window === "undefined") return null;
    const existingEntries = parseMoodEntries(
      window.localStorage.getItem(MOOD_TRACKER_ENTRIES_STORAGE_KEY)
    );
    return existingEntries[0] || null;
  });
  const [selectedRating, setSelectedRating] = useState<number>(() => {
    if (latestEntry?.rating) return latestEntry.rating;
    if (latestEntry?.mood) return moodToRating(latestEntry.mood);
    return 7;
  });
  const [sliderFaceAnimationTick, setSliderFaceAnimationTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedMood = useMemo(() => ratingToMood(selectedRating), [selectedRating]);
  const selectedMoodLabel = useMemo(
    () => MOOD_OPTIONS.find((option) => option.value === selectedMood)?.label || "Mood",
    [selectedMood]
  );

  const ratingControls = useMemo(
    () => [
      { key: "face-angry", kind: "face" as const, rating: 1, mood: "angry" as MoodValue, label: "Angry" },
      { key: "face-sad", kind: "face" as const, rating: 3, mood: "sad" as MoodValue, label: "Sad" },
      { key: "dot-4", kind: "dot" as const, rating: 4, label: "4" },
      { key: "face-ok", kind: "face" as const, rating: 5, mood: "ok" as MoodValue, label: "OK" },
      { key: "dot-6", kind: "dot" as const, rating: 6, label: "6" },
      { key: "face-good", kind: "face" as const, rating: 7, mood: "good" as MoodValue, label: "Good" },
      { key: "face-happy", kind: "face" as const, rating: 9, mood: "happy" as MoodValue, label: "Happy" },
    ],
    []
  );

  const logMood = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);

    const nowIso = new Date().toISOString();
    const rating = Math.min(MOOD_RATING_MAX, Math.max(MOOD_RATING_MIN, Math.round(selectedRating)));
    const selectedCalendarId = window.localStorage.getItem(MOOD_TRACKER_CALENDAR_STORAGE_KEY);

    let calendarEventId: string | null = null;
    let calendarId: string | null = null;
    let calendarError: string | null = null;

    try {
      const response = await fetch("/api/mood-tracker", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mood: selectedMood,
          rating,
          loggedAt: nowIso,
          calendarId: selectedCalendarId || undefined,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        eventId?: string | null;
        calendarId?: string;
      };

      if (!response.ok) {
        calendarError = payload.error || "Failed to log mood in Google Calendar.";
      } else {
        calendarEventId = payload.eventId || null;
        calendarId = payload.calendarId || selectedCalendarId || null;
      }
    } catch {
      calendarError = "Failed to log mood in Google Calendar.";
    }

    const newEntry: MoodEntry = {
      id: `mood-${Date.now()}`,
      mood: selectedMood,
      rating,
      loggedAt: nowIso,
      calendarId,
      calendarEventId,
    };

    const existing = parseMoodEntries(window.localStorage.getItem(MOOD_TRACKER_ENTRIES_STORAGE_KEY));
    const deduped = existing.filter((entry) => entry.id !== newEntry.id);
    const nextEntries = [newEntry, ...deduped].slice(0, MAX_MOOD_ENTRIES);

    window.localStorage.setItem(MOOD_TRACKER_ENTRIES_STORAGE_KEY, JSON.stringify(nextEntries));
    window.dispatchEvent(new CustomEvent(MOOD_TRACKER_UPDATED_EVENT));

    let cloudError: string | null = null;
    try {
      await syncMoodEntriesToCloud(nextEntries);
    } catch (syncError: unknown) {
      cloudError = syncError instanceof Error ? syncError.message : "Failed to sync mood logs to cloud.";
    }

    setLatestEntry(newEntry);

    if (calendarError && cloudError) {
      setError(`${calendarError} ${cloudError}`);
      setMessage("Mood saved locally only.");
    } else if (calendarError) {
      setError(calendarError);
      setMessage("Mood saved locally and synced to Supabase.");
    } else if (cloudError) {
      setError(cloudError);
      setMessage("Mood saved locally and logged to Google Calendar.");
    } else {
      setMessage("Mood saved to local storage, Supabase, and Google Calendar.");
    }

    if (!googleSession?.user && !calendarError) {
      setMessage("Mood saved and synced. Link a Google account if you want calendar logs.");
    }

    setBusy(false);
  };

  const latestLabel = latestEntry
    ? new Date(latestEntry.loggedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Mood Tracker</h2>
          <p className="soft-text text-sm">Rate your current mood and log it.</p>
        </div>
        <button type="button" onClick={onClose} className="pill-btn">
          Close
        </button>
      </div>

      <ul className="mood-feedback" aria-label="Mood rating options">
        {ratingControls.map((control) => {
          if (control.kind === "dot") {
            const isActive = selectedRating === control.rating;
            return (
              <li key={control.key} className={`mood-dot ${isActive ? "active" : ""}`}>
                <button
                  type="button"
                  onClick={() => setSelectedRating(control.rating)}
                  aria-label={`Set mood rating to ${control.rating} out of 10`}
                  aria-pressed={isActive}
                  disabled={busy}
                >
                  <span className="mood-dot-core" />
                </button>
              </li>
            );
          }

          const isActive = selectedMood === control.mood;
          const mood = control.mood;
          return (
            <li
              key={isActive ? `${control.key}-${sliderFaceAnimationTick}` : control.key}
              className={`${mood} ${isActive ? "active" : ""}`.trim()}
            >
              <button
                type="button"
                onClick={() => setSelectedRating(control.rating)}
                aria-label={`Set mood to ${control.label} (${control.rating}/10)`}
                aria-pressed={isActive}
                disabled={busy}
              >
                <div>
                  {(mood === "angry" || mood === "sad" || mood === "good" || mood === "happy") && (
                    <>
                      <svg className="eye left" viewBox="0 0 7 4" aria-hidden="true">
                        <use href="#mood-eye" />
                      </svg>
                      <svg className="eye right" viewBox="0 0 7 4" aria-hidden="true">
                        <use href="#mood-eye" />
                      </svg>
                    </>
                  )}
                  {(mood === "angry" || mood === "sad" || mood === "good") && (
                    <svg className="mouth" viewBox="0 0 18 7" aria-hidden="true">
                      <use href="#mood-mouth" />
                    </svg>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-1">
        <label htmlFor="mood-slider" className="text-sm font-medium text-zinc-700">
          Mood slider
        </label>
        <input
          id="mood-slider"
          type="range"
          min={MOOD_RATING_MIN}
          max={MOOD_RATING_MAX}
          step={1}
          value={selectedRating}
          onChange={(event) => {
            setSelectedRating(Number(event.target.value));
            setSliderFaceAnimationTick((tick) => tick + 1);
          }}
          className="w-full"
          disabled={busy}
        />
      </div>

      <svg xmlns="http://www.w3.org/2000/svg" style={{ display: "none" }}>
        <symbol viewBox="0 0 7 4" id="mood-eye">
          <path d="M1,1 C1.83333333,2.16666667 2.66666667,2.75 3.5,2.75 C4.33333333,2.75 5.16666667,2.16666667 6,1" />
        </symbol>
        <symbol viewBox="0 0 18 7" id="mood-mouth">
          <path d="M1,5.5 C3.66666667,2.5 6.33333333,1 9,1 C11.6666667,1 14.3333333,2.5 17,5.5" />
        </symbol>
      </svg>

      <div className="flex items-center justify-between gap-3">
        <p className="soft-text text-sm">
          Selected mood: <span className="font-semibold text-zinc-800">{selectedMoodLabel}</span>
          <span className="ml-2 font-semibold text-zinc-800">{selectedRating}/10</span>
          {latestLabel ? <span className="ml-2">Last logged {latestLabel}</span> : null}
        </p>
        <button type="button" onClick={logMood} className="pill-btn pill-btn-primary" disabled={busy}>
          {busy ? "Saving..." : "Log mood"}
        </button>
      </div>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
