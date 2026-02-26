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
import { isStale, readCache, writeCache, writeGlobalLastFetched } from "@/lib/client-cache";

const DAILY_DAYS_STORAGE_KEY = "study-stats.daily-study.days";
const DAILY_SUBJECT_STORAGE_KEY = "study-stats.daily-study.subject";

export default function DailyStudyChart() {
  const [data, setData] = useState<DailyStudyTimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [subject, setSubject] = useState<string>("");

  useEffect(() => {
    const rawDays = window.localStorage.getItem(DAILY_DAYS_STORAGE_KEY);
    if (rawDays) {
      const parsed = Number(rawDays);
      if ([7, 14, 30, 60, 90].includes(parsed)) setDays(parsed);
    }

    const rawSubject = window.localStorage.getItem(DAILY_SUBJECT_STORAGE_KEY);
    if (rawSubject !== null) setSubject(rawSubject);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DAILY_DAYS_STORAGE_KEY, String(days));
  }, [days]);

  useEffect(() => {
    window.localStorage.setItem(DAILY_SUBJECT_STORAGE_KEY, subject);
  }, [subject]);

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
        if (!force && !isStale(cached.fetchedAt)) {
          setLoading(false);
          return;
        }
      }

      setLoading(true);

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
        const fetchedAt = writeCache(cacheKey, payload as DailyStudyTimeData);
        writeGlobalLastFetched(fetchedAt);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [cacheKey, days, subject]
  );

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    const onRefreshAll = () => fetchData(true);
    window.addEventListener("study-stats:refresh-all", onRefreshAll);
    return () => window.removeEventListener("study-stats:refresh-all", onRefreshAll);
  }, [fetchData]);

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
