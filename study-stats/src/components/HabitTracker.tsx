"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  HabitCompletionDay,
  HabitDay,
  HabitDefinition,
  HabitTrackerData,
  TrackerCalendarOption,
} from "@/lib/types";
import { formatTimeSince, isStale, readCache, writeCache } from "@/lib/client-cache";

const STUDY_LEVEL_COLORS = [
  "bg-zinc-100 dark:bg-zinc-800",
  "bg-emerald-200 dark:bg-emerald-900",
  "bg-emerald-400 dark:bg-emerald-700",
  "bg-emerald-500 dark:bg-emerald-500",
  "bg-emerald-700 dark:bg-emerald-300",
];

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";
const TRACKER_CALENDARS_CACHE_KEY = "study-stats:habit-tracker:calendars";

interface TrackerCalendarResponse {
  calendars: TrackerCalendarOption[];
  defaultCalendarId: string | null;
}

interface TooltipState {
  day: HabitDay;
  x: number;
  y: number;
}

function formatShortDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
}

function slugifyHabitName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "habit";
}

function addDays(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function computeHabitStats(days: HabitCompletionDay[]) {
  let currentStreak = 0;
  let longestStreak = 0;
  let runningStreak = 0;
  let totalCompleted = 0;

  for (const day of days) {
    if (day.completed) {
      runningStreak += 1;
      totalCompleted += 1;
      if (runningStreak > longestStreak) longestStreak = runningStreak;
    } else {
      runningStreak = 0;
    }
  }

  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (!days[i].completed) break;
    currentStreak += 1;
  }

  return { currentStreak, longestStreak, totalCompleted };
}

function buildEmptyHabit(
  name: string,
  startDate: string,
  endDate: string
): HabitDefinition {
  const days: HabitCompletionDay[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    days.push({ date, completed: false });
  }

  const stats = computeHabitStats(days);

  return {
    name,
    slug: slugifyHabitName(name),
    days,
    currentStreak: stats.currentStreak,
    longestStreak: stats.longestStreak,
    totalCompleted: stats.totalCompleted,
  };
}

function buildWeeklyGrid<T extends { date: string }>(days: T[]): (T | null)[][] {
  if (days.length === 0) return [];

  const firstDate = new Date(`${days[0].date}T12:00:00`);
  const firstDayOfWeek = (firstDate.getDay() + 6) % 7;

  const paddedDays: (T | null)[] = [...Array(firstDayOfWeek).fill(null), ...days];

  const columns: (T | null)[][] = [];
  for (let i = 0; i < paddedDays.length; i += 7) {
    columns.push(paddedDays.slice(i, i + 7));
  }

  if (columns.length > 0) {
    const lastColumn = columns[columns.length - 1];
    while (lastColumn.length < 7) lastColumn.push(null);
  }

  return columns;
}

function buildGridMonthLabels<T extends { date: string }>(
  grid: (T | null)[][]
): { label: string; colIndex: number }[] {
  const labels: { label: string; colIndex: number }[] = [];
  let lastMonth = "";

  for (let col = 0; col < grid.length; col += 1) {
    const day = grid[col].find((entry) => entry !== null);
    if (!day) continue;

    const month = new Date(`${day.date}T12:00:00`).toLocaleDateString("en-GB", {
      month: "short",
    });

    if (month !== lastMonth) {
      labels.push({ label: month, colIndex: col });
      lastMonth = month;
    }
  }

  return labels;
}

function updateHabitInData(
  previous: HabitTrackerData,
  habitName: string,
  updater: (habit: HabitDefinition) => HabitDefinition
): HabitTrackerData {
  const habits = previous.habits.map((habit) =>
    habit.name.toLowerCase() === habitName.toLowerCase() ? updater(habit) : habit
  );

  return {
    ...previous,
    habits,
  };
}

export default function HabitTracker() {
  const [data, setData] = useState<HabitTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(20);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const [calendars, setCalendars] = useState<TrackerCalendarOption[]>([]);
  const [calendarsLoading, setCalendarsLoading] = useState(true);
  const [selectedTrackerCalendarId, setSelectedTrackerCalendarId] = useState<string | null>(null);

  const [newHabitName, setNewHabitName] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshingData, setRefreshingData] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const dataCacheKey = useMemo(
    () => `study-stats:habit-tracker:${weeks}:${selectedTrackerCalendarId || "auto"}`,
    [weeks, selectedTrackerCalendarId]
  );

  useEffect(() => {
    let cancelled = false;

    const loadCalendars = async () => {
      try {
        setCalendarsLoading(true);

        const cached = readCache<TrackerCalendarResponse>(TRACKER_CALENDARS_CACHE_KEY);
        if (cached) {
          const calendarData = cached.data.calendars;
          setCalendars(calendarData);

          const storedCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
          const storedIsValid =
            storedCalendarId && calendarData.some((entry) => entry.id === storedCalendarId);

          const nextSelectedId =
            (storedIsValid ? storedCalendarId : cached.data.defaultCalendarId) || null;

          setSelectedTrackerCalendarId(nextSelectedId);

          if (!isStale(cached.fetchedAt)) {
            setCalendarsLoading(false);
            return;
          }
        }

        const response = await fetch("/api/habit-tracker/calendars");
        const payload = (await response.json()) as TrackerCalendarResponse | { error?: string };

        if (!response.ok) {
          const message = "error" in payload ? payload.error : "Failed to fetch calendars";
          throw new Error(message || "Failed to fetch calendars");
        }

        if (cancelled) return;

        const typedPayload = payload as TrackerCalendarResponse;
        const calendarData = typedPayload.calendars;
        setCalendars(calendarData);
        writeCache(TRACKER_CALENDARS_CACHE_KEY, typedPayload);

        const storedCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
        const storedIsValid =
          storedCalendarId && calendarData.some((entry) => entry.id === storedCalendarId);

        const nextSelectedId =
          (storedIsValid
            ? storedCalendarId
            : typedPayload.defaultCalendarId) || null;

        setSelectedTrackerCalendarId(nextSelectedId);
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to fetch calendars";
        setActionError(message);
      } finally {
        if (!cancelled) setCalendarsLoading(false);
      }
    };

    loadCalendars();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedTrackerCalendarId) return;
    window.localStorage.setItem(TRACKER_CALENDAR_STORAGE_KEY, selectedTrackerCalendarId);
  }, [selectedTrackerCalendarId]);

  useEffect(() => {
    if (calendarsLoading) return;

    let cancelled = false;

    const loadData = async (force = false) => {
      try {
        setError(null);

        const cached = readCache<HabitTrackerData>(dataCacheKey);
        if (cached) {
          setData(cached.data);
          setLastFetchedAt(cached.fetchedAt);
          if (!force && !isStale(cached.fetchedAt)) {
            setLoading(false);
            return;
          }
        }

        if (cached) {
          setRefreshingData(true);
        } else {
          setLoading(true);
        }

        const params = new URLSearchParams({ weeks: String(weeks) });
        if (selectedTrackerCalendarId) {
          params.set("trackerCalendarId", selectedTrackerCalendarId);
        }

        const response = await fetch(`/api/habit-tracker?${params.toString()}`);
        const payload = (await response.json()) as HabitTrackerData | { error?: string };

        if (!response.ok) {
          const message = "error" in payload ? payload.error : "Failed to fetch habit tracker";
          throw new Error(message || "Failed to fetch habit tracker");
        }

        if (cancelled) return;

        const typedPayload = payload as HabitTrackerData;
        setData(typedPayload);
        setLastFetchedAt(writeCache(dataCacheKey, typedPayload));

        if (
          typedPayload.trackerCalendarId &&
          selectedTrackerCalendarId !== typedPayload.trackerCalendarId
        ) {
          setSelectedTrackerCalendarId(typedPayload.trackerCalendarId);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to fetch habit tracker";
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshingData(false);
        }
      }
    };

    loadData(false);

    return () => {
      cancelled = true;
    };
  }, [weeks, selectedTrackerCalendarId, calendarsLoading, dataCacheKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const studyGrid = useMemo(() => {
    if (!data || data.days.length === 0) return [] as (HabitDay | null)[][];
    return buildWeeklyGrid(data.days);
  }, [data]);

  const monthLabels = useMemo(() => {
    if (!data || studyGrid.length === 0) return [] as { label: string; colIndex: number }[];
    return buildGridMonthLabels(studyGrid);
  }, [data, studyGrid]);

  const trackerRangeLabel = useMemo(() => {
    if (!data) return "";
    return `${formatShortDate(data.trackerRange.startDate)} - ${formatShortDate(
      data.trackerRange.endDate
    )}`;
  }, [data]);

  const hasWritableCalendars = calendars.length > 0;

  const runAction = async (input: RequestInit) => {
    const response = await fetch("/api/habit-tracker", {
      ...input,
      headers: {
        "Content-Type": "application/json",
      },
    });

    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
  };

  const handleAddHabit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTrackerCalendarId || !data) return;

    const habitName = newHabitName.trim();
    if (!habitName) return;

    if (data.habits.some((habit) => habit.name.toLowerCase() === habitName.toLowerCase())) {
      setActionError("Habit already exists.");
      return;
    }

    const previousData = data;
    const optimisticHabit = buildEmptyHabit(
      habitName,
      data.trackerRange.startDate,
      data.trackerRange.endDate
    );
    const nextData = {
      ...data,
      habits: [...data.habits, optimisticHabit],
    };

    setData(nextData);
    setLastFetchedAt(writeCache(dataCacheKey, nextData));
    setNewHabitName("");

    try {
      setActionLoading(true);
      setActionError(null);

      await runAction({
        method: "POST",
        body: JSON.stringify({
          trackerCalendarId: selectedTrackerCalendarId,
          habitName,
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to add habit";
      setActionError(message);
      setData(previousData);
      setLastFetchedAt(writeCache(dataCacheKey, previousData));
      setNewHabitName(habitName);
    } finally {
      setActionLoading(false);
    }
  };

  const toggleHabit = async (habitName: string, date: string, completed: boolean) => {
    if (!selectedTrackerCalendarId || !data) return;

    const previousData = data;

    const nextData = updateHabitInData(data, habitName, (habit) => {
        const days = habit.days.map((day) =>
          day.date === date ? { ...day, completed } : day
        );
        const stats = computeHabitStats(days);

        return {
          ...habit,
          days,
          currentStreak: stats.currentStreak,
          longestStreak: stats.longestStreak,
          totalCompleted: stats.totalCompleted,
        };
      });
    setData(nextData);
    setLastFetchedAt(writeCache(dataCacheKey, nextData));

    try {
      setActionLoading(true);
      setActionError(null);

      await runAction({
        method: "PATCH",
        body: JSON.stringify({
          trackerCalendarId: selectedTrackerCalendarId,
          habitName,
          date,
          completed,
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update habit";
      setActionError(message);
      setData(previousData);
      setLastFetchedAt(writeCache(dataCacheKey, previousData));
    } finally {
      setActionLoading(false);
    }
  };

  const removeHabit = async (habitName: string) => {
    if (!selectedTrackerCalendarId || !data) return;

    const previousData = data;

    const nextData = {
      ...data,
      habits: data.habits.filter(
        (habit) => habit.name.toLowerCase() !== habitName.toLowerCase()
      ),
    };
    setData(nextData);
    setLastFetchedAt(writeCache(dataCacheKey, nextData));

    try {
      setActionLoading(true);
      setActionError(null);

      await runAction({
        method: "DELETE",
        body: JSON.stringify({
          trackerCalendarId: selectedTrackerCalendarId,
          habitName,
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete habit";
      setActionError(message);
      setData(previousData);
      setLastFetchedAt(writeCache(dataCacheKey, previousData));
    } finally {
      setActionLoading(false);
    }
  };

  const refreshData = async () => {
    if (calendarsLoading) return;

    try {
      setRefreshingData(true);
      setError(null);

      const params = new URLSearchParams({ weeks: String(weeks) });
      if (selectedTrackerCalendarId) {
        params.set("trackerCalendarId", selectedTrackerCalendarId);
      }

      const response = await fetch(`/api/habit-tracker?${params.toString()}`);
      const payload = (await response.json()) as HabitTrackerData | { error?: string };

      if (!response.ok) {
        const message = "error" in payload ? payload.error : "Failed to fetch habit tracker";
        throw new Error(message || "Failed to fetch habit tracker");
      }

      const typedPayload = payload as HabitTrackerData;
      setData(typedPayload);
      setLastFetchedAt(writeCache(dataCacheKey, typedPayload));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch habit tracker";
      setError(message);
    } finally {
      setRefreshingData(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-semibold">Habit Tracker</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Study consistency plus custom habits stored in Google Calendar.
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">
            Last fetched {formatTimeSince(lastFetchedAt, now)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={weeks}
            onChange={(event) => setWeeks(Number(event.target.value))}
            className="text-sm border rounded-lg px-2 py-1 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
          >
            {[12, 20, 26, 52].map((value) => (
              <option key={value} value={value}>
                {value} weeks
              </option>
            ))}
          </select>
          <select
            value={selectedTrackerCalendarId || ""}
            onChange={(event) => setSelectedTrackerCalendarId(event.target.value || null)}
            disabled={calendarsLoading || !hasWritableCalendars}
            className="text-sm border rounded-lg px-2 py-1 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 min-w-56"
            aria-label="Select tracker calendar"
          >
            {!hasWritableCalendars && <option value="">No writable calendars found</option>}
            {hasWritableCalendars &&
              calendars.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.summary}
                  {entry.primary ? " (Primary)" : ""}
                </option>
              ))}
          </select>
          <button
            onClick={refreshData}
            disabled={refreshingData}
            className="px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors"
          >
            {refreshingData ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="h-40 flex items-center justify-center text-zinc-400 animate-pulse">
          Loading...
        </div>
      )}
      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {data && !loading && (
        <div className="space-y-6">
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <StudyStatBadge label="Current streak" value={`${data.currentStreak}d`} />
              <StudyStatBadge label="Longest streak" value={`${data.longestStreak}d`} />
              <StudyStatBadge label="Days studied" value={`${data.totalDaysStudied}`} />
              <StudyStatBadge label="Total hours" value={`${data.totalHours.toFixed(0)}h`} />
            </div>

            <div className="overflow-x-auto pb-2 relative" onMouseLeave={() => setTooltip(null)}>
              <div className="flex ml-8 mb-1" style={{ gap: 0 }}>
                {monthLabels.map((monthLabel) => (
                  <span
                    key={`${monthLabel.label}-${monthLabel.colIndex}`}
                    className="text-[10px] text-zinc-400 absolute"
                    style={{ left: `${monthLabel.colIndex * 16 + 32}px` }}
                  >
                    {monthLabel.label}
                  </span>
                ))}
              </div>

              <div className="flex gap-[3px] mt-5">
                <div className="flex flex-col gap-[3px] pr-1">
                  {DAY_LABELS.map((label, index) => (
                    <div
                      key={label}
                      className="h-[13px] text-[10px] text-zinc-400 leading-[13px] w-6 text-right"
                    >
                      {index % 2 === 0 ? label : ""}
                    </div>
                  ))}
                </div>

                {studyGrid.map((week, weekIndex) => (
                  <div key={weekIndex} className="flex flex-col gap-[3px]">
                    {week.map((day, dayIndex) => (
                      <div
                        key={`${weekIndex}-${dayIndex}`}
                        className={`w-[13px] h-[13px] rounded-[2px] transition-colors ${
                          day ? STUDY_LEVEL_COLORS[day.level] : "bg-transparent"
                        } ${day ? "cursor-pointer hover:ring-1 hover:ring-zinc-400" : ""}`}
                        onMouseEnter={(event) => {
                          if (!day) return;
                          const rect = event.currentTarget.getBoundingClientRect();
                          setTooltip({
                            day,
                            x: rect.left,
                            y: rect.top,
                          });
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      />
                    ))}
                  </div>
                ))}
              </div>

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
                    {new Date(`${tooltip.day.date}T12:00:00`).toLocaleDateString("en-GB", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  {" - "}
                  {tooltip.day.hours > 0
                    ? `${tooltip.day.hours.toFixed(1)}h studied`
                    : "No study"}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-4 text-xs text-zinc-500">
              <span>Less</span>
              {STUDY_LEVEL_COLORS.map((colorClass) => (
                <div key={colorClass} className={`w-[13px] h-[13px] rounded-[2px] ${colorClass}`} />
              ))}
              <span>More</span>
              <span className="ml-3 text-zinc-400">0h, &lt;1h, 1-3h, 3-5h, 5h+</span>
            </div>
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h3 className="text-base font-semibold">Custom Habit Checklist</h3>
              <span className="text-xs text-zinc-500">{trackerRangeLabel}</span>
            </div>

            <form onSubmit={handleAddHabit} className="flex flex-wrap gap-2 mb-4">
              <input
                type="text"
                value={newHabitName}
                onChange={(event) => setNewHabitName(event.target.value)}
                placeholder="Add a habit (e.g. Gym)"
                className="flex-1 min-w-56 border rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
                disabled={!selectedTrackerCalendarId || actionLoading}
              />
              <button
                type="submit"
                disabled={!selectedTrackerCalendarId || actionLoading || !newHabitName.trim()}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                Add habit
              </button>
            </form>

            {actionError && <p className="text-sm text-red-500 mb-3">{actionError}</p>}

            {!selectedTrackerCalendarId && (
              <p className="text-sm text-zinc-500">Select a writable calendar to manage habit tracking.</p>
            )}

            {selectedTrackerCalendarId && data.habits.length === 0 && (
              <p className="text-sm text-zinc-500">No habits yet. Add one above to start tracking.</p>
            )}

            <div className="space-y-4">
              {data.habits.map((habit) => {
                const habitGrid = buildWeeklyGrid(habit.days);
                const habitMonthLabels = buildGridMonthLabels(habitGrid);

                return (
                  <div
                    key={habit.slug}
                    className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <div>
                        <p className="font-medium text-sm">{habit.name}</p>
                        <p className="text-xs text-zinc-500">
                          Current streak {habit.currentStreak}d, longest {habit.longestStreak}d, completed {habit.totalCompleted} days
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeHabit(habit.name)}
                        disabled={actionLoading}
                        className="px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="overflow-x-auto pb-2">
                      <div className="flex ml-8 mb-1 relative" style={{ gap: 0 }}>
                        {habitMonthLabels.map((monthLabel) => (
                          <span
                            key={`${habit.slug}-${monthLabel.label}-${monthLabel.colIndex}`}
                            className="text-[10px] text-zinc-400 absolute"
                            style={{ left: `${monthLabel.colIndex * 16 + 32}px` }}
                          >
                            {monthLabel.label}
                          </span>
                        ))}
                      </div>

                      <div className="flex gap-[3px] mt-5">
                        <div className="flex flex-col gap-[3px] pr-1">
                          {DAY_LABELS.map((label, index) => (
                            <div
                              key={`${habit.slug}-${label}`}
                              className="h-[13px] text-[10px] text-zinc-400 leading-[13px] w-6 text-right"
                            >
                              {index % 2 === 0 ? label : ""}
                            </div>
                          ))}
                        </div>

                        {habitGrid.map((week, weekIndex) => (
                          <div key={`${habit.slug}-${weekIndex}`} className="flex flex-col gap-[3px]">
                            {week.map((day, dayIndex) => (
                              <button
                                key={`${habit.slug}-${weekIndex}-${dayIndex}`}
                                type="button"
                                disabled={actionLoading || !day}
                                aria-label={
                                  day
                                    ? `${habit.name} ${day.date} ${day.completed ? "complete" : "incomplete"}`
                                    : `${habit.name} empty`
                                }
                                title={
                                  day
                                    ? `${formatShortDate(day.date)} - ${day.completed ? "Complete" : "Not done"}`
                                    : ""
                                }
                                onClick={() => {
                                  if (!day) return;
                                  toggleHabit(habit.name, day.date, !day.completed);
                                }}
                                className={`w-[13px] h-[13px] rounded-[2px] transition-colors ${
                                  day
                                    ? day.completed
                                      ? "bg-sky-500 hover:bg-sky-600"
                                      : "bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                                    : "bg-transparent"
                                }`}
                              />
                            ))}
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 mt-3 text-xs text-zinc-500">
                        <span>Less</span>
                        <div className="w-[13px] h-[13px] rounded-[2px] bg-zinc-200 dark:bg-zinc-700" />
                        <div className="w-[13px] h-[13px] rounded-[2px] bg-sky-500" />
                        <span>More</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StudyStatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl px-3 py-3 text-center">
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="text-[11px] text-zinc-500 mt-0.5">{label}</div>
    </div>
  );
}
