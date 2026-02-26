"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { DailyStudyTimeData } from "@/lib/types";
import { DEFAULT_SUBJECTS } from "@/lib/types";
import { formatTimeSince, isStale, readCache, writeCache } from "@/lib/client-cache";

export default function DailyStudyChart() {
  const [data, setData] = useState<DailyStudyTimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [subject, setSubject] = useState<string>("");
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);

  const cacheKey = useMemo(
    () => `study-stats:daily-study-time:${days}:${subject || "all"}`,
    [days, subject]
  );

  const fetchData = useCallback(
    async (force = false) => {
      setError(null);

      const cached = readCache<DailyStudyTimeData>(cacheKey);
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

      const params = new URLSearchParams({ days: String(days) });
      if (subject) params.set("subject", subject);

      try {
        const res = await fetch(`/api/daily-study-time?${params}`);
        const payload = (await res.json()) as DailyStudyTimeData | { error?: string };
        if (!res.ok) {
          const message = "error" in payload ? payload.error : "Failed";
          throw new Error(message || "Failed");
        }
        setData(payload as DailyStudyTimeData);
        setLastFetchedAt(writeCache(cacheKey, payload as DailyStudyTimeData));
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed";
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [cacheKey, days, subject]
  );

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold">
          Daily Study Time {subject ? `(${subject})` : "(All Subjects)"}
        </h2>
        <div className="flex gap-2">
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="text-sm border rounded-lg px-2 py-1 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
          >
            <option value="">All Subjects</option>
            {Object.keys(DEFAULT_SUBJECTS).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-sm border rounded-lg px-2 py-1 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
          >
            {[7, 14, 30, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-zinc-500">
          Last fetched {formatTimeSince(lastFetchedAt, now)}
        </p>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors"
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {loading && (
        <div className="h-64 flex items-center justify-center text-zinc-400 animate-pulse">
          Loading...
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {data && !loading && (
        <>
          <div className="flex gap-6 mb-4 text-sm">
            <span>
              Monthly avg:{" "}
              <strong className="text-green-600">
                {data.averageMonth.toFixed(1)}h
              </strong>
            </span>
            <span>
              Weekly avg:{" "}
              <strong className="text-blue-600">
                {data.averageWeek.toFixed(1)}h
              </strong>
            </span>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(300, data.entries.length * 28)}>
            <BarChart
              data={data.entries}
              layout="vertical"
              margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" unit="h" />
              <YAxis
                dataKey="label"
                type="category"
                width={60}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                formatter={(value?: number | string) => [`${Number(value ?? 0).toFixed(2)}h`, "Hours"]}
              />
              <ReferenceLine
                x={data.averageMonth}
                stroke="#16a34a"
                strokeDasharray="5 5"
                label={{ value: "Month avg", position: "top", fontSize: 10 }}
              />
              <ReferenceLine
                x={data.averageWeek}
                stroke="#2563eb"
                strokeDasharray="5 5"
                label={{ value: "Week avg", position: "top", fontSize: 10 }}
              />
              <Bar dataKey="hours" fill="#38bdf8" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
