"use client";

import { useCallback, useEffect, useState } from "react";
import type { TodayProgressData } from "@/lib/types";
import { isStale, readCache, writeCache, writeGlobalLastFetched } from "@/lib/client-cache";

const CACHE_KEY = "study-stats:today-progress";

export default function TodayProgress() {
  const [data, setData] = useState<TodayProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (force = false) => {
      setError(null);

      const cached = readCache<TodayProgressData>(CACHE_KEY);
      if (cached) {
        setData(cached.data);
        if (!force && !isStale(cached.fetchedAt)) {
          setLoading(false);
          return;
        }
      }

      setLoading(true);

      try {
        const res = await fetch("/api/today-progress");
        const payload = (await res.json()) as TodayProgressData | { error?: string };
        if (!res.ok) {
          const message = "error" in payload ? payload.error : "Failed";
          throw new Error(message || "Failed");
        }
        setData(payload as TodayProgressData);
        const fetchedAt = writeCache(CACHE_KEY, payload as TodayProgressData);
        writeGlobalLastFetched(fetchedAt);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    const onRefreshAll = () => fetchData(true);
    window.addEventListener("study-stats:refresh-all", onRefreshAll);
    return () => window.removeEventListener("study-stats:refresh-all", onRefreshAll);
  }, [fetchData]);

  if (loading) return <CardSkeleton title="Today's Progress" />;
  if (error) return <CardError title="Today's Progress" error={error} />;
  if (!data) return null;

  const remaining = Math.max(0, data.totalPlanned - data.totalCompleted);
  const pct = Math.round(data.percentageCompleted);

  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <h2 className="text-lg font-semibold mb-4">Today&apos;s Study Progress</h2>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-zinc-500">
          {data.totalCompleted.toFixed(1)}h / {data.totalPlanned.toFixed(1)}h
        </span>
        <span className="text-sm font-medium">{pct}%</span>
      </div>
      {/* Progress bar */}
      <div className="w-full h-6 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-sky-500 rounded-full transition-all duration-700"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="flex justify-between mt-2 text-xs text-zinc-400">
        <span>Completed: {data.totalCompleted.toFixed(1)}h</span>
        <span>Remaining: {remaining.toFixed(1)}h</span>
      </div>
    </div>
  );
}

function CardSkeleton({ title }: { title: string }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800 animate-pulse">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      <div className="h-6 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
    </div>
  );
}

function CardError({ title, error }: { title: string; error: string }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-red-200 dark:border-red-900">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <p className="text-sm text-red-500">{error}</p>
    </div>
  );
}
