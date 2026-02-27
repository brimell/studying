"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "recharts";
import FancyDropdown from "./FancyDropdown";
import MorphingText from "./MorphingText";
import type { StudyDistributionData } from "@/lib/types";
import {
  fetchJsonWithDedupe,
  isStale,
  readCache,
  writeCache,
  writeGlobalLastFetched,
} from "@/lib/client-cache";

const DISTRIBUTION_DAYS_STORAGE_KEY = "study-stats.distribution.days";
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

const COLORS = [
  "#38bdf8", "#f472b6", "#a78bfa", "#34d399",
  "#fbbf24", "#fb923c", "#ef4444", "#6366f1",
  "#14b8a6", "#8b5cf6",
];

export default function SubjectDistribution() {
  const [data, setData] = useState<StudyDistributionData | null>(null);
  const [, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(365);
  const [calendarIds, setCalendarIds] = useState<string[]>([]);

  useEffect(() => {
    const raw = window.localStorage.getItem(DISTRIBUTION_DAYS_STORAGE_KEY);
    if (raw) {
      const parsed = Number(raw);
      if ([7, 30, 90, 365].includes(parsed)) setDays(parsed);
    }
    setCalendarIds(readStudyCalendarIds());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(DISTRIBUTION_DAYS_STORAGE_KEY, String(days));
    window.dispatchEvent(new CustomEvent("study-stats:settings-updated"));
  }, [days]);

  const cacheKey = useMemo(
    () => `study-stats:distribution:${days}:${calendarIds.join(",") || "default"}`,
    [calendarIds, days]
  );

  const fetchData = useCallback(
    async (force = false) => {
      setError(null);

      const cached = readCache<StudyDistributionData>(cacheKey);
      if (cached) {
        setData(cached.data);
        if (!force && !isStale(cached.fetchedAt)) {
          setLoading(false);
          return;
        }
      }

      setLoading(true);

      try {
        const params = new URLSearchParams({ days: String(days) });
        if (calendarIds.length > 0) params.set("calendarIds", calendarIds.join(","));
        const query = params.toString();
        const payload = await fetchJsonWithDedupe<StudyDistributionData>(
          `api:distribution:${query}`,
          async () => {
            const res = await fetch(`/api/distribution?${query}`);
            const json = (await res.json()) as StudyDistributionData | { error?: string };
            if (!res.ok) {
              const message = "error" in json ? json.error : "Failed";
              throw new Error(message || "Failed");
            }
            return json as StudyDistributionData;
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
    [cacheKey, calendarIds, days]
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

  const filteredSubjects =
    data?.subjectTimes.filter((s) => s.hours > 0) || [];

  return (
    <div className="surface-card p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <FancyDropdown
          value={String(days)}
          onChange={(nextValue) => setDays(Number(nextValue))}
          options={[7, 30, 90, 365].map((d) => ({
            value: String(d),
            label: d === 365 ? "1 year" : `${d} days`,
          }))}
          className="w-full sm:w-auto sm:min-w-[11rem]"
        />
      </div>

      {error && !data && <p className="text-sm text-red-500">{error}</p>}

      {data && (
        <>
          {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
          <p className="text-sm text-zinc-500 mb-4">
            Total:{" "}
            <strong className="stat-mono inline-flex">
              <MorphingText text={`${data.totalHours.toFixed(1)}h`} />
            </strong>{" "}
            over{" "}
            <span className="stat-mono inline-flex">
              <MorphingText text={`${data.numDays}`} />
            </span>{" "}
            days
          </p>

          {filteredSubjects.length === 0 ? (
            <p className="text-zinc-400">No study time recorded.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pie chart */}
              <ResponsiveContainer width="100%" height={260}>
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
              <ResponsiveContainer width="100%" height={260}>
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
                <tr className="border-b">
                  <th className="text-left py-2 pr-4">Subject</th>
                  <th className="text-right py-2 pr-4">Hours</th>
                  <th className="text-right py-2">%</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubjects.map((s, i) => (
                  <tr key={s.subject} className="border-b">
                    <td className="py-1.5 pr-4 flex items-center gap-2">
                      <span
                        className="inline-block w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      {s.subject}
                    </td>
                    <td className="text-right py-1.5 pr-4 stat-mono">{s.hours.toFixed(1)}</td>
                    <td className="text-right py-1.5 stat-mono">
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
      {!data && !error && <p className="text-sm text-zinc-500">Waiting for first sync...</p>}
    </div>
  );
}
