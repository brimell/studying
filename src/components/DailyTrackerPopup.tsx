"use client";

import { useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  CHORE_OPTIONS,
  DAILY_TRACKER_CALENDAR_STORAGE_KEY,
  DAILY_TRACKER_ENTRIES_STORAGE_KEY,
  DAILY_TRACKER_UPDATED_EVENT,
  EMOTION_OPTIONS,
  EVENT_OPTIONS,
  EXERCISE_OPTIONS,
  HOBBY_OPTIONS,
  SCHOOL_OPTIONS,
  SLEEP_STUFF_OPTIONS,
  SUPPLEMENT_OPTIONS,
  defaultDailyTrackerFormData,
  parseDailyTrackerEntries,
  parseDailyTrackerFormData,
  serializeDailyTrackerDayDescription,
  todayDateKey,
  type DailyTrackerEntry,
  type DailyTrackerFormData,
  type TrackerFileMeta,
} from "@/lib/daily-tracker";

interface DailyTrackerPopupProps {
  onClose: () => void;
}

type SyncPayload = Record<string, string>;
const EMOTION_EMOJI: Record<string, string> = {
  excited: "🤩",
  relaxed: "😌",
  proud: "😎",
  happy: "😄",
  good: "🙂",
  chill: "🧊",
  depressed: "😞",
  lonely: "🥺",
  anxious: "😰",
  sad: "😢",
  angry: "😡",
  annoyed: "😒",
  tired: "😴",
  stressed: "😵",
};

function toggleArrayItem(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

function formatDate(dateKey: string): string {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatLogTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function syncEntriesToCloud(entries: DailyTrackerEntry[]): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Sign in to your site account to sync tracker logs to cloud.");
  }

  const readResponse = await fetch("/api/account-sync", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const readPayload = (await readResponse.json()) as { payload?: SyncPayload; error?: string };
  if (!readResponse.ok) {
    throw new Error(readPayload.error || "Failed to read cloud settings before tracker sync.");
  }

  const payload: SyncPayload = {
    ...(readPayload.payload || {}),
    [DAILY_TRACKER_ENTRIES_STORAGE_KEY]: JSON.stringify(entries),
  };

  const selectedCalendarId = window.localStorage.getItem(DAILY_TRACKER_CALENDAR_STORAGE_KEY);
  if (selectedCalendarId) {
    payload[DAILY_TRACKER_CALENDAR_STORAGE_KEY] = selectedCalendarId;
  } else {
    delete payload[DAILY_TRACKER_CALENDAR_STORAGE_KEY];
  }

  const writeResponse = await fetch("/api/account-sync", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload }),
  });

  const writePayload = (await writeResponse.json()) as { error?: string };
  if (!writeResponse.ok) {
    throw new Error(writePayload.error || "Failed to sync tracker logs to cloud.");
  }
}

function NumberScale({
  label,
  min,
  max,
  value,
  onChange,
  lowLabel,
  highLabel,
}: {
  label: string;
  min: number;
  max: number;
  value: number | null;
  onChange: (value: number | null) => void;
  lowLabel?: string;
  highLabel?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      {(lowLabel || highLabel) && (
        <div className="flex items-center justify-between text-[11px] text-zinc-500">
          <span>{lowLabel || ""}</span>
          <span>{highLabel || ""}</span>
        </div>
      )}
      <div className="space-y-2">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value ?? min}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full"
        />
        <div className="flex items-center justify-between text-xs text-zinc-600">
          <span className="stat-mono">{min}</span>
          <span className="stat-mono">{value ?? "Not set"}</span>
          <span className="stat-mono">{max}</span>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`px-2 py-1 rounded-md text-xs border ${
            value === null ? "border-zinc-500 bg-zinc-100 text-zinc-700" : "border-zinc-200 bg-white"
          }`}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function MultiToggle({
  label,
  options,
  selected,
  onToggle,
  renderOptionLabel,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  renderOptionLabel?: (value: string) => string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              type="button"
              key={option}
              onClick={() => onToggle(option)}
              className={`px-2 py-1 rounded-md text-xs border ${
                active ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-white"
              }`}
            >
              {renderOptionLabel ? renderOptionLabel(option) : option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DailyTrackerPopup({ onClose }: DailyTrackerPopupProps) {
  const [entries, setEntries] = useState<DailyTrackerEntry[]>(() => {
    if (typeof window === "undefined") return [];
    return parseDailyTrackerEntries(window.localStorage.getItem(DAILY_TRACKER_ENTRIES_STORAGE_KEY));
  });
  const [selectedDate, setSelectedDate] = useState<string>(() => todayDateKey());
  const [form, setForm] = useState<DailyTrackerFormData>(() => defaultDailyTrackerFormData(todayDateKey()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const logsForDate = useMemo(
    () =>
      entries
        .filter((entry) => entry.date === selectedDate)
        .sort((left, right) => right.loggedAt.localeCompare(left.loggedAt)),
    [entries, selectedDate]
  );

  const loadDate = (date: string) => {
    setSelectedDate(date);
    setForm(defaultDailyTrackerFormData(date));
  };

  const resetDraft = () => {
    setForm(defaultDailyTrackerFormData(selectedDate));
  };

  const handleFileChange = (files: FileList | null) => {
    if (!files) return;
    const items: TrackerFileMeta[] = Array.from(files)
      .slice(0, 10)
      .map((file) => ({ name: file.name, type: file.type, size: file.size }));
    setForm((previous) => ({ ...previous, media: items }));
  };

  const saveTracker = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);

    const nowIso = new Date().toISOString();
    const selectedCalendarId = window.localStorage.getItem(DAILY_TRACKER_CALENDAR_STORAGE_KEY);
    const nextForm = parseDailyTrackerFormData({ ...form, date: selectedDate }, selectedDate);

    const nextEntry: DailyTrackerEntry = {
      id: `tracker-${selectedDate}-${Date.now()}`,
      date: selectedDate,
      loggedAt: nowIso,
      calendarId: null,
      calendarEventId: null,
      form: nextForm,
    };

    const nextEntries = [nextEntry, ...entries].sort((left, right) =>
      right.loggedAt.localeCompare(left.loggedAt)
    );
    const entriesForDay = nextEntries.filter((entry) => entry.date === selectedDate);

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
          date: selectedDate,
          form: nextForm,
          description: serializeDailyTrackerDayDescription(entriesForDay),
          calendarId: selectedCalendarId || undefined,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        eventId?: string | null;
        calendarId?: string;
      };

      if (!response.ok) {
        calendarError = payload.error || "Failed to log tracker data in Google Calendar.";
      } else {
        calendarEventId = payload.eventId || null;
        calendarId = payload.calendarId || selectedCalendarId || null;
      }
    } catch {
      calendarError = "Failed to log tracker data in Google Calendar.";
    }

    const withCalendarIds = nextEntries.map((entry) => {
      if (entry.id !== nextEntry.id) return entry;
      return {
        ...entry,
        calendarId,
        calendarEventId,
      };
    });

    window.localStorage.setItem(DAILY_TRACKER_ENTRIES_STORAGE_KEY, JSON.stringify(withCalendarIds));
    window.dispatchEvent(new CustomEvent(DAILY_TRACKER_UPDATED_EVENT));
    setEntries(withCalendarIds);

    let cloudError: string | null = null;
    try {
      await syncEntriesToCloud(withCalendarIds);
    } catch (syncError: unknown) {
      cloudError = syncError instanceof Error ? syncError.message : "Failed to sync tracker logs to cloud.";
    }

    if (calendarError && cloudError) {
      setError(`${calendarError} ${cloudError}`);
      setMessage("Log saved locally only.");
    } else if (calendarError) {
      setError(calendarError);
      setMessage("Log saved locally and synced to Supabase.");
    } else if (cloudError) {
      setError(cloudError);
      setMessage("Log saved locally and logged to Google Calendar.");
    } else {
      setMessage("Log saved to local storage, Supabase, and Google Calendar.");
    }

    resetDraft();
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Daily Tracker</h2>
          <p className="soft-text text-sm">Multiple logs per day. No questions are mandatory.</p>
        </div>
        <button type="button" onClick={onClose} className="pill-btn">
          Close
        </button>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs text-zinc-500">Date</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => loadDate(event.target.value)}
              className="field-select mt-1"
            />
          </label>
          <p className="text-xs text-zinc-500">
            Logging: <span className="stat-mono">{formatDate(selectedDate)}</span>
          </p>
          <button type="button" onClick={resetDraft} className="pill-btn text-xs">
            New blank log
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Logs on this day: <span className="stat-mono">{logsForDate.length}</span>
        </p>
        {logsForDate.length > 0 && (
          <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
            {logsForDate.map((entry, index) => (
              <div key={entry.id} className="text-[11px] text-zinc-600 rounded border border-zinc-200 bg-white px-2 py-1">
                <span className="stat-mono">{index + 1}. {formatLogTime(entry.loggedAt)}</span>
                {entry.form.moodRating !== null ? ` • Mood ${entry.form.moodRating}/10` : ""}
                {entry.form.morningSleepRating !== null
                  ? ` • Sleep ${entry.form.morningSleepRating}/10`
                  : ""}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="max-h-[65vh] overflow-y-auto space-y-4 pr-1">
        <section className="rounded-lg border border-zinc-200 p-3 space-y-2">
          <h3 className="font-semibold">Morning</h3>
          <NumberScale
            label="How was my sleep (from last night)"
            min={0}
            max={10}
            value={form.morningSleepRating}
            onChange={(value) => setForm((previous) => ({ ...previous, morningSleepRating: value }))}
            lowLabel="worst possible"
            highLabel="best possible"
          />
          <MultiToggle
            label="Sleep stuff"
            options={SLEEP_STUFF_OPTIONS}
            selected={form.sleepStuff}
            onToggle={(value) =>
              setForm((previous) => ({ ...previous, sleepStuff: toggleArrayItem(previous.sleepStuff, value) }))
            }
          />
        </section>

        <section className="rounded-lg border border-zinc-200 p-3 space-y-2">
          <h3 className="font-semibold">Evening - Results</h3>
          <NumberScale
            label="Mood rating"
            min={0}
            max={10}
            value={form.moodRating}
            onChange={(value) => setForm((previous) => ({ ...previous, moodRating: value }))}
            lowLabel="worst possible"
            highLabel="best possible"
          />
          <MultiToggle
            label="Emotions"
            options={EMOTION_OPTIONS}
            selected={form.emotions}
            onToggle={(value) =>
              setForm((previous) => ({ ...previous, emotions: toggleArrayItem(previous.emotions, value) }))
            }
            renderOptionLabel={(value) => `${EMOTION_EMOJI[value] || "🙂"} ${value}`}
          />
          <label className="block">
            <span className="text-sm font-medium">Emotions other</span>
            <input
              type="text"
              value={form.emotionOther}
              onChange={(event) => setForm((previous) => ({ ...previous, emotionOther: event.target.value }))}
              className="field-select w-full mt-1"
              placeholder="Other"
            />
          </label>
          <NumberScale
            label="Productivity"
            min={0}
            max={10}
            value={form.productivity}
            onChange={(value) => setForm((previous) => ({ ...previous, productivity: value }))}
          />
          <NumberScale
            label="Motivation"
            min={0}
            max={10}
            value={form.motivation}
            onChange={(value) => setForm((previous) => ({ ...previous, motivation: value }))}
          />
        </section>

        <section className="rounded-lg border border-zinc-200 p-3 space-y-2">
          <h3 className="font-semibold">Symptoms</h3>
          <NumberScale
            label="Headache"
            min={0}
            max={10}
            value={form.headache}
            onChange={(value) => setForm((previous) => ({ ...previous, headache: value }))}
            lowLabel="none"
            highLabel="very painful"
          />
          <NumberScale
            label="Fatigue/tiredness"
            min={0}
            max={10}
            value={form.fatigue}
            onChange={(value) => setForm((previous) => ({ ...previous, fatigue: value }))}
            lowLabel="none"
            highLabel="very very tired"
          />
          <NumberScale
            label="Coughing"
            min={0}
            max={10}
            value={form.coughing}
            onChange={(value) => setForm((previous) => ({ ...previous, coughing: value }))}
          />
        </section>

        <section className="rounded-lg border border-zinc-200 p-3 space-y-2">
          <h3 className="font-semibold">Factors</h3>
          <NumberScale
            label="Alcohol"
            min={0}
            max={10}
            value={form.alcohol}
            onChange={(value) => setForm((previous) => ({ ...previous, alcohol: value }))}
            lowLabel="none"
            highLabel="a lot"
          />
          <div className="space-y-1">
            <p className="text-sm font-medium">Caffeine (mg)</p>
            <div className="flex flex-wrap gap-1 items-center">
              {[0, 50, 100, 150, 200].map((mg) => (
                <button
                  key={mg}
                  type="button"
                  onClick={() => setForm((previous) => ({ ...previous, caffeineMg: mg }))}
                  className={`px-2 py-1 rounded-md text-xs border ${
                    form.caffeineMg === mg
                      ? "border-sky-400 bg-sky-50 text-sky-700"
                      : "border-zinc-200 bg-white"
                  }`}
                >
                  {mg}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setForm((previous) => ({ ...previous, caffeineMg: null }))}
                className={`px-2 py-1 rounded-md text-xs border ${
                  form.caffeineMg === null
                    ? "border-zinc-500 bg-zinc-100 text-zinc-700"
                    : "border-zinc-200 bg-white"
                }`}
              >
                Clear
              </button>
            </div>
          </div>

          <MultiToggle
            label="Supps"
            options={SUPPLEMENT_OPTIONS}
            selected={form.supplements}
            onToggle={(value) =>
              setForm((previous) => ({
                ...previous,
                supplements: toggleArrayItem(previous.supplements, value),
              }))
            }
          />
          <MultiToggle
            label="Exercise"
            options={EXERCISE_OPTIONS}
            selected={form.exercise}
            onToggle={(value) =>
              setForm((previous) => ({ ...previous, exercise: toggleArrayItem(previous.exercise, value) }))
            }
          />
          <MultiToggle
            label="School"
            options={SCHOOL_OPTIONS}
            selected={form.school}
            onToggle={(value) =>
              setForm((previous) => ({ ...previous, school: toggleArrayItem(previous.school, value) }))
            }
          />
          <MultiToggle
            label="Events"
            options={EVENT_OPTIONS}
            selected={form.events}
            onToggle={(value) =>
              setForm((previous) => ({ ...previous, events: toggleArrayItem(previous.events, value) }))
            }
          />
          <MultiToggle
            label="Hobbies"
            options={HOBBY_OPTIONS}
            selected={form.hobbies}
            onToggle={(value) =>
              setForm((previous) => ({ ...previous, hobbies: toggleArrayItem(previous.hobbies, value) }))
            }
          />
          <MultiToggle
            label="Chores"
            options={CHORE_OPTIONS}
            selected={form.chores}
            onToggle={(value) =>
              setForm((previous) => ({ ...previous, chores: toggleArrayItem(previous.chores, value) }))
            }
          />
          <MultiToggle
            label="Other"
            options={["not well (sick)", "haircut"]}
            selected={form.otherFactors}
            onToggle={(value) =>
              setForm((previous) => ({
                ...previous,
                otherFactors: toggleArrayItem(previous.otherFactors, value),
              }))
            }
          />
          <label className="block">
            <span className="text-sm font-medium">Other factors notes</span>
            <input
              type="text"
              value={form.otherFactorsNotes}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, otherFactorsNotes: event.target.value }))
              }
              className="field-select w-full mt-1"
            />
          </label>
        </section>

        <section className="rounded-lg border border-zinc-200 p-3 space-y-2">
          <h3 className="font-semibold">Today&apos;s Note + Files</h3>
          <label className="block">
            <span className="text-sm font-medium">Today&apos;s note</span>
            <textarea
              value={form.todaysNote}
              onChange={(event) => setForm((previous) => ({ ...previous, todaysNote: event.target.value }))}
              className="field-select w-full mt-1 min-h-24"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Today&apos;s photo/video/audio</span>
            <input
              type="file"
              multiple
              accept="audio/*,image/*,video/*"
              onChange={(event) => handleFileChange(event.target.files)}
              className="field-select w-full mt-1"
            />
          </label>
          {form.media.length > 0 && (
            <p className="text-xs text-zinc-500">{form.media.length} file(s) selected (metadata tracked).</p>
          )}
        </section>

        <section className="rounded-lg border border-zinc-200 p-3 space-y-2">
          <h3 className="font-semibold">Kolb&apos;s Cycle</h3>
          <label className="block">
            <span className="text-sm font-medium">Experience</span>
            <textarea
              value={form.kolbExperience}
              onChange={(event) => setForm((previous) => ({ ...previous, kolbExperience: event.target.value }))}
              className="field-select w-full mt-1 min-h-20"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Reflection</span>
            <textarea
              value={form.kolbReflection}
              onChange={(event) => setForm((previous) => ({ ...previous, kolbReflection: event.target.value }))}
              className="field-select w-full mt-1 min-h-20"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Abstraction</span>
            <textarea
              value={form.kolbAbstraction}
              onChange={(event) => setForm((previous) => ({ ...previous, kolbAbstraction: event.target.value }))}
              className="field-select w-full mt-1 min-h-20"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Experimentation</span>
            <textarea
              value={form.kolbExperimentation}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, kolbExperimentation: event.target.value }))
              }
              className="field-select w-full mt-1 min-h-20"
            />
          </label>
        </section>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="soft-text text-sm">One calendar event per date is updated with all logs for that date.</p>
        <button type="button" onClick={saveTracker} className="pill-btn pill-btn-primary" disabled={busy}>
          {busy ? "Saving..." : "Save log"}
        </button>
      </div>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
