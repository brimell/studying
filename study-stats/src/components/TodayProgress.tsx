"use client";

import { useCallback, useEffect, useState } from "react";
import type { TodayProgressData } from "@/lib/types";
import { formatTimeSince, isStale, readCache, writeCache } from "@/lib/client-cache";

const CACHE_KEY = "study-stats:today-progress";

export default function TodayProgress() {
  const [data, setData] = useState<TodayProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(
    async (force = false) => {
      setError(null);

      const cached = readCache<TodayProgressData>(CACHE_KEY);
      if (cached) {
        setData(cached.data);
        setLastFetchedAt(cached.fetchedAt);
        if (!force && !isStale(cached.fetchedAt)) {
          setLoading(false);
          return;
        }
      }

      if (cached) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const res = await fetch("/api/today-progress");
        const payload = (await res.json()) as TodayProgressData | { error?: string };
        if (!res.ok) {
          const message = "error" in payload ? payload.error : "Failed";
          throw new Error(message || "Failed");
        }
        setData(payload as TodayProgressData);
        setLastFetchedAt(writeCache(CACHE_KEY, payload as TodayProgressData));
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed";
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (loading) return <CardSkeleton title="Today's Progress" />;
  if (error) return <CardError title="Today's Progress" error={error} />;
  if (!data) return null;

  const remaining = Math.max(0, data.totalPlanned - data.totalCompleted);
  const pct = Math.round(data.percentageCompleted);

  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold">Today&apos;s Study Progress</h2>
        <div className="text-right">
          <p className="text-[11px] text-zinc-500">
            Last fetched {formatTimeSince(lastFetchedAt, now)}
          </p>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="mt-1 px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
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
