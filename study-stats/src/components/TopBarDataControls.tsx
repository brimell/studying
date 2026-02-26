"use client";

import { useEffect, useState } from "react";
import { formatTimeSince, readGlobalLastFetched } from "@/lib/client-cache";
import type { TrackerCalendarOption } from "@/lib/types";

const STUDY_CALENDAR_IDS_STORAGE_KEY = "study-stats.study.calendar-ids";

interface TrackerCalendarResponse {
  sourceCalendars: TrackerCalendarOption[];
  defaultSourceCalendarIds: string[];
}

export default function TopBarDataControls() {
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [sourceCalendars, setSourceCalendars] = useState<TrackerCalendarOption[]>([]);
  const [selectedStudyCalendarIds, setSelectedStudyCalendarIds] = useState<string[]>([]);

  useEffect(() => {
    setLastFetchedAt(readGlobalLastFetched());

    const onUpdate = () => setLastFetchedAt(readGlobalLastFetched());
    window.addEventListener("study-stats:last-fetched-updated", onUpdate);

    return () => {
      window.removeEventListener("study-stats:last-fetched-updated", onUpdate);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadCalendars = async () => {
      try {
        const response = await fetch("/api/habit-tracker/calendars");
        const payload = (await response.json()) as TrackerCalendarResponse | { error?: string };
        if (!response.ok) return;

        const typedPayload = payload as TrackerCalendarResponse;
        const available = typedPayload.sourceCalendars || [];
        setSourceCalendars(available);

        const stored = window.localStorage.getItem(STUDY_CALENDAR_IDS_STORAGE_KEY);
        if (!stored) {
          const defaults = typedPayload.defaultSourceCalendarIds || [];
          setSelectedStudyCalendarIds(defaults);
          if (defaults.length > 0) {
            window.localStorage.setItem(STUDY_CALENDAR_IDS_STORAGE_KEY, JSON.stringify(defaults));
          }
          return;
        }

        const parsed = JSON.parse(stored) as unknown;
        if (!Array.isArray(parsed)) return;

        const validIds = new Set(available.map((entry) => entry.id));
        const selected = parsed
          .filter((value): value is string => typeof value === "string")
          .filter((value) => validIds.has(value));
        setSelectedStudyCalendarIds(selected);
      } catch {
        // Ignore calendar picker load errors.
      }
    };

    loadCalendars();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      STUDY_CALENDAR_IDS_STORAGE_KEY,
      JSON.stringify(selectedStudyCalendarIds)
    );
    window.dispatchEvent(new CustomEvent("study-stats:study-calendars-updated"));
  }, [selectedStudyCalendarIds]);

  const refreshAll = () => {
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent("study-stats:refresh-all"));
    window.setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <div className="flex items-center gap-2">
      <details className="relative">
        <summary className="list-none cursor-pointer px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors">
          Study Calendars ({selectedStudyCalendarIds.length || sourceCalendars.length || 0})
        </summary>
        <div className="absolute right-0 mt-2 w-72 max-h-72 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 shadow-xl z-50">
          {sourceCalendars.length === 0 && (
            <p className="text-xs text-zinc-500">No calendars available.</p>
          )}
          <div className="space-y-1">
            {sourceCalendars.map((entry) => {
              const checked = selectedStudyCalendarIds.includes(entry.id);
              return (
                <label key={entry.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setSelectedStudyCalendarIds((previous) =>
                        event.target.checked
                          ? [...previous, entry.id]
                          : previous.filter((id) => id !== entry.id)
                      );
                    }}
                  />
                  <span>
                    {entry.summary}
                    {entry.primary ? " (Primary)" : ""}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </details>
      <p className="text-[11px] text-zinc-500 hidden md:block">
        Last fetched {formatTimeSince(lastFetchedAt, now)}
      </p>
      <button
        onClick={refreshAll}
        disabled={refreshing}
        className="px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors"
      >
        {refreshing ? "Refreshing..." : "Refresh Data"}
      </button>
    </div>
  );
}
