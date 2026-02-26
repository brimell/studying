"use client";

import { useEffect, useState } from "react";
import type { TodayProgressData } from "@/lib/types";

export default function TodayProgress() {
  const [data, setData] = useState<TodayProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/today-progress")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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
