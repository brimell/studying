"use client";

import { useEffect, useState, useMemo } from "react";
import type { HabitTrackerData, HabitDay } from "@/lib/types";

const LEVEL_COLORS = [
  "bg-zinc-100 dark:bg-zinc-800",        // 0 – no study
  "bg-emerald-200 dark:bg-emerald-900",   // 1 – <1h
  "bg-emerald-400 dark:bg-emerald-700",   // 2 – 1-3h
  "bg-emerald-500 dark:bg-emerald-500",   // 3 – 3-5h
  "bg-emerald-700 dark:bg-emerald-300",   // 4 – 5h+
];

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function HabitTracker() {
  const [data, setData] = useState<HabitTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(20);
  const [tooltip, setTooltip] = useState<{ day: HabitDay; x: number; y: number } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/habit-tracker?weeks=${weeks}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [weeks]);

  // Organize days into a grid: rows = day of week (Mon-Sun), columns = weeks
  const grid = useMemo(() => {
    if (!data) return [];

    const days = data.days;
    if (days.length === 0) return [];

    // Pad the beginning so the first column starts on Monday
    const firstDate = new Date(days[0].date + "T12:00:00");
    const firstDow = (firstDate.getDay() + 6) % 7; // 0=Mon, 6=Sun

    const padded: (HabitDay | null)[] = [
      ...Array(firstDow).fill(null),
      ...days,
    ];

    // Split into columns of 7 (each column = 1 week)
    const columns: (HabitDay | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
      columns.push(padded.slice(i, i + 7));
    }

    // Pad the last column to 7
    const last = columns[columns.length - 1];
    while (last.length < 7) last.push(null);

    return columns;
  }, [data]);

  // Month labels positioned above the grid
  const monthLabels = useMemo(() => {
    if (!data || grid.length === 0) return [];
    const labels: { label: string; colIndex: number }[] = [];
    let lastMonth = "";
    for (let col = 0; col < grid.length; col++) {
      // Find first non-null day in column
      const day = grid[col].find((d) => d !== null);
      if (!day) continue;
      const d = new Date(day.date + "T12:00:00");
      const month = d.toLocaleDateString("en-GB", { month: "short" });
      if (month !== lastMonth) {
        labels.push({ label: month, colIndex: col });
        lastMonth = month;
      }
    }
    return labels;
  }, [data, grid]);

  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h2 className="text-lg font-semibold">Study Habit Tracker</h2>
        <select
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
          className="text-sm border rounded-lg px-2 py-1 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
        >
          {[12, 20, 26, 52].map((w) => (
            <option key={w} value={w}>
              {w} weeks
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="h-40 flex items-center justify-center text-zinc-400 animate-pulse">
          Loading...
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {data && !loading && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <StatBadge label="Current streak" value={`${data.currentStreak}d`} icon="🔥" />
            <StatBadge label="Longest streak" value={`${data.longestStreak}d`} icon="🏆" />
            <StatBadge label="Days studied" value={`${data.totalDaysStudied}`} icon="📅" />
            <StatBadge label="Total hours" value={`${data.totalHours.toFixed(0)}h`} icon="⏱" />
          </div>

          {/* Grid */}
          <div className="overflow-x-auto pb-2 relative" onMouseLeave={() => setTooltip(null)}>
            {/* Month labels */}
            <div className="flex ml-8 mb-1" style={{ gap: 0 }}>
              {monthLabels.map((m, i) => (
                <span
                  key={i}
                  className="text-[10px] text-zinc-400 absolute"
                  style={{ left: `${m.colIndex * 16 + 32}px` }}
                >
                  {m.label}
                </span>
              ))}
            </div>

            <div className="flex gap-[3px] mt-5">
              {/* Day-of-week labels */}
              <div className="flex flex-col gap-[3px] pr-1">
                {DAY_LABELS.map((label, i) => (
                  <div
                    key={label}
                    className="h-[13px] text-[10px] text-zinc-400 leading-[13px] w-6 text-right"
                  >
                    {i % 2 === 0 ? label : ""}
                  </div>
                ))}
              </div>

              {/* Week columns */}
              {grid.map((week, wIdx) => (
                <div key={wIdx} className="flex flex-col gap-[3px]">
                  {week.map((day, dIdx) => (
                    <div
                      key={dIdx}
                      className={`w-[13px] h-[13px] rounded-[2px] transition-colors ${
                        day ? LEVEL_COLORS[day.level] : "bg-transparent"
                      } ${day ? "cursor-pointer hover:ring-1 hover:ring-zinc-400" : ""}`}
                      onMouseEnter={(e) => {
                        if (day) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setTooltip({ day, x: rect.left, y: rect.top });
                        }
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Tooltip */}
            {tooltip && (
              <div
                className="fixed z-50 bg-zinc-800 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg"
                style={{
                  left: tooltip.x,
                  top: tooltip.y - 40,
                  transform: "translateX(-50%)",
                }}
              >
                <span className="font-medium">
                  {new Date(tooltip.day.date + "T12:00:00").toLocaleDateString("en-GB", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                {" — "}
                {tooltip.day.hours > 0
                  ? `${tooltip.day.hours.toFixed(1)}h studied`
                  : "No study"}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-2 mt-4 text-xs text-zinc-500">
            <span>Less</span>
            {LEVEL_COLORS.map((cls, i) => (
              <div key={i} className={`w-[13px] h-[13px] rounded-[2px] ${cls}`} />
            ))}
            <span>More</span>
            <span className="ml-4 text-zinc-400">
              0h · &lt;1h · 1-3h · 3-5h · 5h+
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function StatBadge({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-3 text-center">
      <div className="text-lg mb-0.5">{icon}</div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="text-[11px] text-zinc-500 mt-0.5">{label}</div>
    </div>
  );
}
