"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TodayProgressData } from "@/lib/types";
import MorphingText from "./MorphingText";
import {
  fetchJsonWithDedupe,
  isStale,
  readCache,
  writeCache,
  writeGlobalLastFetched,
} from "@/lib/client-cache";

const STUDY_CALENDAR_IDS_STORAGE_KEY = "study-stats.study.calendar-ids";

function readStudyCalendarIds(): string[] {
  const stored = window.localStorage.getItem(STUDY_CALENDAR_IDS_STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export default function TodayProgress() {
  const [data, setData] = useState<TodayProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendarIds, setCalendarIds] = useState<string[]>([]);

  useEffect(() => {
    setCalendarIds(readStudyCalendarIds());
  }, []);

  const cacheKey = useMemo(
    () => `study-stats:today-progress:${calendarIds.join(",") || "default"}`,
    [calendarIds]
  );

  const fetchData = useCallback(
    async (force = false) => {
      setError(null);

      const cached = readCache<TodayProgressData>(cacheKey);
      if (cached) {
        setData(cached.data);
        if (!force && !isStale(cached.fetchedAt)) {
          setLoading(false);
          return;
        }
      }

      setLoading(true);

      try {
        const params = new URLSearchParams();
        if (calendarIds.length > 0) params.set("calendarIds", calendarIds.join(","));
        const query = params.toString();
        const payload = await fetchJsonWithDedupe<TodayProgressData>(
          `api:today-progress:${query || "default"}`,
          async () => {
            const res = await fetch(`/api/today-progress${query ? `?${query}` : ""}`);
            const json = (await res.json()) as TodayProgressData | { error?: string };
            if (!res.ok) {
              const message = "error" in json ? json.error : "Failed";
              throw new Error(message || "Failed");
            }
            return json as TodayProgressData;
          }
        );
        setData(payload);
        const fetchedAt = writeCache(cacheKey, payload);
        writeGlobalLastFetched(fetchedAt);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [cacheKey, calendarIds]
  );

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    const onRefreshAll = () => fetchData(true);
    window.addEventListener("study-stats:refresh-all", onRefreshAll);
    const onCalendarsUpdated = () => {
      setCalendarIds(readStudyCalendarIds());
      void fetchData(true);
    };
    window.addEventListener("study-stats:study-calendars-updated", onCalendarsUpdated);
    return () => {
      window.removeEventListener("study-stats:refresh-all", onRefreshAll);
      window.removeEventListener("study-stats:study-calendars-updated", onCalendarsUpdated);
    };
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="surface-card p-6">
        <p className="text-sm text-zinc-500">Waiting for first sync...</p>
      </div>
    );
  }
  if (error && !data) return <CardError error={error} />;
  if (!data) return null;

  const remaining = Math.max(0, data.totalPlanned - data.totalCompleted);
  const pct = Math.round(data.percentageCompleted);

  return (
    <div className="surface-card p-6">
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-zinc-500 stat-mono inline-flex">
          <MorphingText text={`${data.totalCompleted.toFixed(1)}h / ${data.totalPlanned.toFixed(1)}h`} />
        </span>
        <span className="text-sm font-medium stat-mono inline-flex">
          <MorphingText text={`${pct}%`} />
        </span>
      </div>
      {/* Progress bar */}
      <div className="w-full h-6 bg-zinc-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-sky-500 rounded-full transition-all duration-700"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="flex justify-between mt-2 text-xs text-zinc-400">
        <span className="stat-mono inline-flex">
          Completed: <MorphingText text={`${data.totalCompleted.toFixed(1)}h`} />
        </span>
        <span className="stat-mono inline-flex">
          Remaining: <MorphingText text={`${remaining.toFixed(1)}h`} />
        </span>
      </div>
    </div>
  );
}

function CardError({ error }: { error: string }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm border border-red-200">
      <p className="text-sm text-red-500">{error}</p>
    </div>
  );
}
