"use client";

import { useEffect, useState } from "react";
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

export default function DailyStudyChart() {
  const [data, setData] = useState<DailyStudyTimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [subject, setSubject] = useState<string>("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ days: String(days) });
    if (subject) params.set("subject", subject);

    fetch(`/api/daily-study-time?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days, subject]);

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
