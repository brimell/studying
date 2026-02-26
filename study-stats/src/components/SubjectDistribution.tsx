"use client";

import { useEffect, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { StudyDistributionData } from "@/lib/types";

const COLORS = [
  "#38bdf8", "#f472b6", "#a78bfa", "#34d399",
  "#fbbf24", "#fb923c", "#ef4444", "#6366f1",
  "#14b8a6", "#8b5cf6",
];

export default function SubjectDistribution() {
  const [data, setData] = useState<StudyDistributionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(365);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/distribution?days=${days}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  const filteredSubjects =
    data?.subjectTimes.filter((s) => s.hours > 0) || [];

  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Subject Distribution</h2>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="text-sm border rounded-lg px-2 py-1 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
        >
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              {d === 365 ? "1 year" : `${d} days`}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="h-64 flex items-center justify-center text-zinc-400 animate-pulse">
          Loading...
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {data && !loading && (
        <>
          <p className="text-sm text-zinc-500 mb-4">
            Total: <strong>{data.totalHours.toFixed(1)}h</strong> over{" "}
            {data.numDays} days
          </p>

          {filteredSubjects.length === 0 ? (
            <p className="text-zinc-400">No study time recorded.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pie chart */}
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={filteredSubjects}
                    dataKey="hours"
                    nameKey="subject"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ name, percent }: { name?: string; percent?: number }) =>
                      `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                    labelLine
                  >
                    {filteredSubjects.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value?: number | string) => `${Number(value ?? 0).toFixed(1)}h`}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Bar chart */}
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={filteredSubjects}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="subject"
                    tick={{ fontSize: 11 }}
                    angle={-30}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis unit="h" />
                  <Tooltip
                    formatter={(value?: number | string) => [`${Number(value ?? 0).toFixed(1)}h`, "Hours"]}
                  />
                  <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                    {filteredSubjects.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Summary table */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b dark:border-zinc-700">
                  <th className="text-left py-2 pr-4">Subject</th>
                  <th className="text-right py-2 pr-4">Hours</th>
                  <th className="text-right py-2">%</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubjects.map((s, i) => (
                  <tr key={s.subject} className="border-b dark:border-zinc-800">
                    <td className="py-1.5 pr-4 flex items-center gap-2">
                      <span
                        className="inline-block w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      {s.subject}
                    </td>
                    <td className="text-right py-1.5 pr-4">{s.hours.toFixed(1)}</td>
                    <td className="text-right py-1.5">
                      {data.totalHours > 0
                        ? ((s.hours / data.totalHours) * 100).toFixed(1)
                        : 0}
                      %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
