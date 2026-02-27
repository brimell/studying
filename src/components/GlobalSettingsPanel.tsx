"use client";

import { useEffect, useMemo, useState } from "react";
import FancyDropdown from "./FancyDropdown";
import AuthButton from "./AuthButton";
import { DAILY_TRACKER_CALENDAR_STORAGE_KEY } from "@/lib/daily-tracker";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  DEFAULT_DISPLAY_NAME,
  getDisplayNameFromMetadata,
  normalizeDisplayName,
} from "@/lib/display-name";
import type { TrackerCalendarOption } from "@/lib/types";

const WIDE_SCREEN_STORAGE_KEY = "study-stats.layout.wide-screen";
const DAILY_DAYS_STORAGE_KEY = "study-stats.daily-study.days";
const DISTRIBUTION_DAYS_STORAGE_KEY = "study-stats.distribution.days";
const HABIT_WEEKS_STORAGE_KEY = "study-stats.habit-tracker.weeks";
const HABIT_SHOW_FUTURE_DAYS_STORAGE_KEY = "study-stats.habit-tracker.show-future-days";
const HABIT_FUTURE_PREVIEW_SETTINGS_STORAGE_KEY = "study-stats.habit-tracker.future-preview";
const PROJECTION_HOURS_STORAGE_KEY = "study-stats.projection.hours-per-day";
const PROJECTION_DATE_STORAGE_KEY = "study-stats.projection.end-date";
const DASHBOARD_LAYOUT_CONTROLS_STORAGE_KEY = "study-stats.dashboard.show-layout-controls";
const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";

type FuturePreviewMode = "auto" | "custom";

function parseBoolean(value: string | null, fallback = false): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function parseNumber(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function parseDate(value: string | null): string {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function parseFuturePreview(
  value: string | null
): { mode: FuturePreviewMode; customDays: number } {
  if (!value) return { mode: "auto", customDays: 35 };
  try {
    const parsed = JSON.parse(value) as { mode?: unknown; customDays?: unknown };
    const mode: FuturePreviewMode = parsed.mode === "custom" ? "custom" : "auto";
    const customDays = parseNumber(
      typeof parsed.customDays === "number" ? String(parsed.customDays) : null,
      35,
      1,
      365
    );
    return { mode, customDays };
  } catch {
    return { mode: "auto", customDays: 35 };
  }
}

export default function GlobalSettingsPanel() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [displayNameDraft, setDisplayNameDraft] = useState(DEFAULT_DISPLAY_NAME);
  const [currentDisplayName, setCurrentDisplayName] = useState(DEFAULT_DISPLAY_NAME);
  const [updatingDisplayName, setUpdatingDisplayName] = useState(false);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);

  const [wideScreen, setWideScreen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return parseBoolean(window.localStorage.getItem(WIDE_SCREEN_STORAGE_KEY), true);
  });
  const [dailyDays, setDailyDays] = useState<number>(() => {
    if (typeof window === "undefined") return 30;
    return parseNumber(window.localStorage.getItem(DAILY_DAYS_STORAGE_KEY), 30, 7, 90);
  });
  const [distributionDays, setDistributionDays] = useState<number>(() => {
    if (typeof window === "undefined") return 365;
    return parseNumber(window.localStorage.getItem(DISTRIBUTION_DAYS_STORAGE_KEY), 365, 7, 365);
  });
  const [habitWeeks, setHabitWeeks] = useState<number>(() => {
    if (typeof window === "undefined") return 20;
    return parseNumber(window.localStorage.getItem(HABIT_WEEKS_STORAGE_KEY), 20, 1, 104);
  });
  const [showFutureDays, setShowFutureDays] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return parseBoolean(window.localStorage.getItem(HABIT_SHOW_FUTURE_DAYS_STORAGE_KEY), true);
  });
  const [futurePreviewMode, setFuturePreviewMode] = useState<FuturePreviewMode>(() => {
    if (typeof window === "undefined") return "auto";
    return parseFuturePreview(window.localStorage.getItem(HABIT_FUTURE_PREVIEW_SETTINGS_STORAGE_KEY)).mode;
  });
  const [futureCustomDays, setFutureCustomDays] = useState<number>(() => {
    if (typeof window === "undefined") return 35;
    return parseFuturePreview(window.localStorage.getItem(HABIT_FUTURE_PREVIEW_SETTINGS_STORAGE_KEY)).customDays;
  });
  const [projectionHours, setProjectionHours] = useState<number>(() => {
    if (typeof window === "undefined") return 4;
    return parseNumber(window.localStorage.getItem(PROJECTION_HOURS_STORAGE_KEY), 4, 1, 16);
  });
  const [projectionEndDate, setProjectionEndDate] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return parseDate(window.localStorage.getItem(PROJECTION_DATE_STORAGE_KEY));
  });
  const [showDashboardLayoutControls, setShowDashboardLayoutControls] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return parseBoolean(window.localStorage.getItem(DASHBOARD_LAYOUT_CONTROLS_STORAGE_KEY), true);
  });
  const [dailyTrackerCalendarId, setDailyTrackerCalendarId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(DAILY_TRACKER_CALENDAR_STORAGE_KEY) || "";
  });
  const [dailyTrackerCalendars, setDailyTrackerCalendars] = useState<TrackerCalendarOption[]>([]);
  const [dailyTrackerCalendarsLoading, setDailyTrackerCalendarsLoading] = useState(false);
  const [dailyTrackerCalendarsError, setDailyTrackerCalendarsError] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(WIDE_SCREEN_STORAGE_KEY, String(wideScreen));
  }, [wideScreen]);

  useEffect(() => {
    window.localStorage.setItem(DAILY_DAYS_STORAGE_KEY, String(dailyDays));
  }, [dailyDays]);

  useEffect(() => {
    window.localStorage.setItem(DISTRIBUTION_DAYS_STORAGE_KEY, String(distributionDays));
  }, [distributionDays]);

  useEffect(() => {
    window.localStorage.setItem(HABIT_WEEKS_STORAGE_KEY, String(habitWeeks));
  }, [habitWeeks]);

  useEffect(() => {
    window.localStorage.setItem(HABIT_SHOW_FUTURE_DAYS_STORAGE_KEY, String(showFutureDays));
  }, [showFutureDays]);

  useEffect(() => {
    window.localStorage.setItem(
      HABIT_FUTURE_PREVIEW_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        mode: futurePreviewMode,
        customDays: parseNumber(String(futureCustomDays), 35, 1, 365),
      })
    );
  }, [futureCustomDays, futurePreviewMode]);

  useEffect(() => {
    window.localStorage.setItem(PROJECTION_HOURS_STORAGE_KEY, String(projectionHours));
  }, [projectionHours]);

  useEffect(() => {
    if (projectionEndDate) {
      window.localStorage.setItem(PROJECTION_DATE_STORAGE_KEY, projectionEndDate);
    } else {
      window.localStorage.removeItem(PROJECTION_DATE_STORAGE_KEY);
    }
  }, [projectionEndDate]);

  useEffect(() => {
    window.localStorage.setItem(
      DASHBOARD_LAYOUT_CONTROLS_STORAGE_KEY,
      String(showDashboardLayoutControls)
    );
  }, [showDashboardLayoutControls]);

  useEffect(() => {
    if (dailyTrackerCalendarId) {
      window.localStorage.setItem(DAILY_TRACKER_CALENDAR_STORAGE_KEY, dailyTrackerCalendarId);
    } else {
      window.localStorage.removeItem(DAILY_TRACKER_CALENDAR_STORAGE_KEY);
    }
  }, [dailyTrackerCalendarId]);

  useEffect(() => {
    let cancelled = false;

    const loadDailyTrackerCalendars = async () => {
      setDailyTrackerCalendarsLoading(true);
      setDailyTrackerCalendarsError(null);
      try {
        const response = await fetch("/api/habit-tracker/calendars");
        const payload = (await response.json()) as {
          error?: string;
          trackerCalendars?: TrackerCalendarOption[];
        };
        if (!response.ok) {
          throw new Error(payload.error || "Failed to fetch writable calendars.");
        }
        if (cancelled) return;

        const trackerCalendars = payload.trackerCalendars || [];
        setDailyTrackerCalendars(trackerCalendars);

        if (trackerCalendars.length > 0) {
          const trackerCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
          const preferred = trackerCalendars.find((entry) => entry.id === trackerCalendarId);
          const fallback = preferred || trackerCalendars.find((entry) => entry.primary) || trackerCalendars[0];
          setDailyTrackerCalendarId((current) => current || fallback?.id || "");
        }
      } catch (error: unknown) {
        if (cancelled) return;
        setDailyTrackerCalendarsError(
          error instanceof Error ? error.message : "Failed to fetch writable calendars."
        );
        setDailyTrackerCalendars([]);
      } finally {
        if (!cancelled) {
          setDailyTrackerCalendarsLoading(false);
        }
      }
    };

    void loadDailyTrackerCalendars();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    const loadDisplayName = async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      const next = getDisplayNameFromMetadata(data.user?.user_metadata);
      setDisplayNameDraft(next);
      setCurrentDisplayName(next);
    };

    void loadDisplayName();
    const { data } = supabase.auth.onAuthStateChange(() => {
      void loadDisplayName();
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("study-stats:settings-updated"));
    window.dispatchEvent(new CustomEvent("study-stats:refresh-all"));
    window.dispatchEvent(new CustomEvent("study-stats:milestones-updated"));
    window.dispatchEvent(new CustomEvent("study-stats:exam-date-updated"));
  }, [
    wideScreen,
    dailyDays,
    distributionDays,
    habitWeeks,
    showFutureDays,
    futurePreviewMode,
    futureCustomDays,
    projectionHours,
    projectionEndDate,
    showDashboardLayoutControls,
    dailyTrackerCalendarId,
  ]);

  const dailyOptions = useMemo(() => [7, 14, 30, 60, 90], []);
  const distributionOptions = useMemo(() => [7, 30, 90, 365], []);
  const dailyTrackerCalendarOptions = useMemo(
    () => [
      { value: "", label: "No selected calendar" },
      ...dailyTrackerCalendars.map((calendarEntry) => ({
        value: calendarEntry.id,
        label: `${calendarEntry.summary}${calendarEntry.primary ? " (Primary)" : ""}`,
      })),
    ],
    [dailyTrackerCalendars]
  );

  async function saveDisplayName() {
    if (!supabase) return;
    const normalized = normalizeDisplayName(displayNameDraft);
    if (normalized === currentDisplayName) return;

    setDisplayNameError(null);
    setUpdatingDisplayName(true);
    const { data } = await supabase.auth.getUser();
    const metadata = data.user?.user_metadata || {};
    const { error } = await supabase.auth.updateUser({
      data: {
        ...metadata,
        display_name: normalized,
      },
    });
    if (error) {
      setDisplayNameError(error.message);
    } else {
      setDisplayNameDraft(normalized);
      setCurrentDisplayName(normalized);
      window.dispatchEvent(new CustomEvent("study-stats:settings-updated"));
    }
    setUpdatingDisplayName(false);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <section className="surface-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Account</h2>
        <label className="block text-sm text-zinc-600 space-y-1">
          <span>Display name</span>
          <input
            type="text"
            value={displayNameDraft}
            onChange={(event) => setDisplayNameDraft(event.target.value)}
            className="field-select w-full"
            maxLength={60}
            disabled={!supabase}
          />
        </label>
        <button
          type="button"
          className="pill-btn w-full text-left"
          onClick={saveDisplayName}
          disabled={!supabase || updatingDisplayName || normalizeDisplayName(displayNameDraft) === currentDisplayName}
        >
          {updatingDisplayName ? "Saving..." : "Save display name"}
        </button>
        {displayNameError ? <p className="text-xs text-red-600">{displayNameError}</p> : null}
        {!supabase ? (
          <p className="text-xs text-zinc-500">
            Supabase is not configured, so display name editing is unavailable.
          </p>
        ) : null}
      </section>

      <section className="surface-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Layout</h2>
        <label className="flex items-center justify-between gap-3">
          <span>Wide screen mode</span>
          <input
            type="checkbox"
            checked={wideScreen}
            onChange={(event) => setWideScreen(event.target.checked)}
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>Show card drag/reorder controls</span>
          <input
            type="checkbox"
            checked={showDashboardLayoutControls}
            onChange={(event) => setShowDashboardLayoutControls(event.target.checked)}
          />
        </label>
      </section>

      <section className="surface-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Study Charts</h2>
        <label className="block space-y-1">
          <span>Default daily chart range</span>
          <FancyDropdown
            value={String(dailyDays)}
            onChange={(nextValue) => setDailyDays(Number(nextValue))}
            options={dailyOptions.map((value) => ({
              value: String(value),
              label: `${value} days`,
            }))}
          />
        </label>
        <label className="block space-y-1">
          <span>Default distribution range</span>
          <FancyDropdown
            value={String(distributionDays)}
            onChange={(nextValue) => setDistributionDays(Number(nextValue))}
            options={distributionOptions.map((value) => ({
              value: String(value),
              label: value === 365 ? "1 year" : `${value} days`,
            }))}
          />
        </label>
      </section>

      <section className="surface-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Habit Tracker</h2>
        <label className="block space-y-1">
          <span>History weeks</span>
          <input
            type="number"
            min={1}
            max={104}
            value={habitWeeks}
            onChange={(event) => setHabitWeeks(parseNumber(event.target.value, 20, 1, 104))}
            className="field-select w-full"
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>Show future days</span>
          <input
            type="checkbox"
            checked={showFutureDays}
            onChange={(event) => setShowFutureDays(event.target.checked)}
          />
        </label>
        <label className="block space-y-1">
          <span>Future preview mode</span>
          <FancyDropdown
            value={futurePreviewMode}
            onChange={(nextValue) => setFuturePreviewMode(nextValue === "custom" ? "custom" : "auto")}
            options={[
              { value: "auto", label: "Auto" },
              { value: "custom", label: "Custom" },
            ]}
          />
        </label>
        {futurePreviewMode === "custom" && (
          <label className="block space-y-1">
            <span>Custom future days</span>
            <input
              type="number"
              min={1}
              max={365}
              value={futureCustomDays}
              onChange={(event) =>
                setFutureCustomDays(parseNumber(event.target.value, 35, 1, 365))
              }
              className="field-select w-full"
            />
          </label>
        )}
      </section>

      <section className="surface-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Projection</h2>
        <label className="block space-y-1">
          <span>Default hours/day</span>
          <input
            type="number"
            min={1}
            max={16}
            value={projectionHours}
            onChange={(event) =>
              setProjectionHours(parseNumber(event.target.value, 4, 1, 16))
            }
            className="field-select w-full"
          />
        </label>
        <label className="block space-y-1">
          <span>Projection end date</span>
          <input
            type="date"
            value={projectionEndDate}
            onChange={(event) => setProjectionEndDate(event.target.value)}
            className="field-select w-full"
          />
        </label>
      </section>

      <section className="surface-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Daily Tracker</h2>
        <label className="block space-y-1">
          <span>Google Calendar for daily tracker logging</span>
          <FancyDropdown
            value={dailyTrackerCalendarId}
            onChange={setDailyTrackerCalendarId}
            options={dailyTrackerCalendarOptions}
            disabled={dailyTrackerCalendarsLoading}
          />
        </label>
        <p className="soft-text text-sm">
          Daily tracker logs are saved locally, synced to Supabase, and written into this calendar.
        </p>
        {dailyTrackerCalendarsLoading ? (
          <p className="soft-text text-sm">Loading writable calendars...</p>
        ) : null}
        {dailyTrackerCalendarsError ? (
          <p className="text-sm text-red-600">{dailyTrackerCalendarsError}</p>
        ) : null}
      </section>

      <section className="surface-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Google Calendar Connection</h2>
        <p className="soft-text text-sm">
          Connect or disconnect your Google Calendar integration for study and tracker syncing.
        </p>
        <AuthButton compact className="w-full text-left" />
      </section>
    </div>
  );
}
