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

export default function DailyStudyChart() {
  const [data, setData] = useState<DailyStudyTimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [subject, setSubject] = useState<string>("");
  const [calendarIds, setCalendarIds] = useState<string[]>([]);

  useEffect(() => {
    const rawDays = window.localStorage.getItem(DAILY_DAYS_STORAGE_KEY);
    if (rawDays) {
      const parsed = Number(rawDays);
      if ([7, 14, 30, 60, 90].includes(parsed)) setDays(parsed);
    }

    const rawSubject = window.localStorage.getItem(DAILY_SUBJECT_STORAGE_KEY);
    if (rawSubject !== null) setSubject(rawSubject);

    setCalendarIds(readStudyCalendarIds());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DAILY_DAYS_STORAGE_KEY, String(days));
  }, [days]);

  useEffect(() => {
    window.localStorage.setItem(DAILY_SUBJECT_STORAGE_KEY, subject);
  }, [subject]);

  const cacheKey = useMemo(
    () =>
      `study-stats:daily-study-time:${days}:${subject || "all"}:${calendarIds.join(",") || "default"}`,
    [calendarIds, days, subject]
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
      if (calendarIds.length > 0) params.set("calendarIds", calendarIds.join(","));

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
    [cacheKey, calendarIds, days, subject]
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

  const chartEntries = useMemo(
    () => (data ? [...data.entries].sort((left, right) => right.date.localeCompare(left.date)) : []),
    [data]
  );

  return (
    <div className="surface-card p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full sm:w-auto">
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="text-sm border rounded-lg px-2 py-1 bg-zinc-50 w-full"
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
            className="text-sm border rounded-lg px-2 py-1 bg-zinc-50 w-full"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-6 mb-4 text-sm">
            <span>
              Monthly avg:{" "}
              <strong className="text-green-600 stat-mono">
                {data.averageMonth.toFixed(1)}h
              </strong>
            </span>
            <span>
              Weekly avg:{" "}
              <strong className="text-blue-600 stat-mono">
                {data.averageWeek.toFixed(1)}h
              </strong>
            </span>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(300, chartEntries.length * 28)}>
            <BarChart
              data={chartEntries}
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
