"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  HabitCompletionDay,
  HabitDay,
  HabitDefinition,
  HabitMode,
  HabitTrackerData,
  TrackerCalendarOption,
} from "@/lib/types";
import { isStale, readCache, writeCache, writeGlobalLastFetched } from "@/lib/client-cache";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";
const HABIT_WEEKS_STORAGE_KEY = "study-stats.habit-tracker.weeks";
const TRACKER_CALENDARS_CACHE_KEY = "study-stats:habit-tracker:calendars";
const MILESTONES_STORAGE_KEY = "study-stats.habit-tracker.milestones";
const HABIT_SOURCE_CALENDARS_STORAGE_KEY = "study-stats.habit-tracker.new-habit.sources";
const HABIT_MATCH_TERMS_STORAGE_KEY = "study-stats.habit-tracker.new-habit.match-terms";
const HABIT_COLORS_STORAGE_KEY = "study-stats.habit-tracker.colors";
const DEFAULT_HABIT_COLORS = [
  "#10b981",
  "#0ea5e9",
  "#f97316",
  "#a855f7",
  "#22c55e",
  "#ef4444",
  "#14b8a6",
  "#eab308",
];

interface TrackerCalendarResponse {
  trackerCalendars: TrackerCalendarOption[];
  sourceCalendars: TrackerCalendarOption[];
  defaultTrackerCalendarId: string | null;
  defaultSourceCalendarIds: string[];
}

interface TooltipState {
  day: HabitDay;
  x: number;
  y: number;
}

interface MilestoneDate {
  id: string;
  type: "exam" | "coursework";
  title: string;
  date: string;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function withAlpha(hexColor: string, alpha: number): string {
  if (!isHexColor(hexColor)) return `rgba(16, 185, 129, ${alpha})`;
  const hex = hexColor.slice(1);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function getHeatCellColor(baseColor: string, level: 0 | 1 | 2 | 3 | 4): string {
  const alphaByLevel: Record<0 | 1 | 2 | 3 | 4, number> = {
    0: 0.08,
    1: 0.22,
    2: 0.4,
    3: 0.6,
    4: 0.82,
  };
  return withAlpha(baseColor, alphaByLevel[level]);
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

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toHabitLevel(hours: number): 0 | 1 | 2 | 3 | 4 {
  if (hours <= 0) return 0;
  if (hours < 1) return 1;
  if (hours < 3) return 2;
  if (hours < 5) return 3;
  return 4;
}

function normalizeHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(Math.min(24, hours) * 100) / 100;
}

function computeHabitStats(days: HabitCompletionDay[]) {
  let currentStreak = 0;
  let longestStreak = 0;
  let runningStreak = 0;
  let totalCompleted = 0;
  let totalHours = 0;

  for (const day of days) {
    totalHours += day.hours;
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

  return {
    currentStreak,
    longestStreak,
    totalCompleted,
    totalHours: Math.round(totalHours * 100) / 100,
  };
}

function buildEmptyHabit(
  name: string,
  mode: HabitMode,
  startDate: string,
  endDate: string
): HabitDefinition {
  const days: HabitCompletionDay[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    days.push({ date, completed: false, hours: 0, level: 0 });
  }

  const stats = computeHabitStats(days);

  return {
    name,
    slug: slugifyHabitName(name),
    mode,
    trackingCalendarId: null,
    sourceCalendarIds: [],
    matchTerms: [],
    days,
    currentStreak: stats.currentStreak,
    longestStreak: stats.longestStreak,
    totalCompleted: stats.totalCompleted,
    totalHours: stats.totalHours,
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
  const [sourceCalendars, setSourceCalendars] = useState<TrackerCalendarOption[]>([]);
  const [calendarsLoading, setCalendarsLoading] = useState(true);
  const [selectedTrackerCalendarId, setSelectedTrackerCalendarId] = useState<string | null>(null);

  const [newHabitName, setNewHabitName] = useState("");
  const [newHabitMode, setNewHabitMode] = useState<HabitMode>("binary");
  const [newHabitTrackingCalendarId, setNewHabitTrackingCalendarId] = useState<string | null>(null);
  const [newHabitSourceCalendarIds, setNewHabitSourceCalendarIds] = useState<string[]>([]);
  const [newHabitMatchTerms, setNewHabitMatchTerms] = useState("");
  const [habitTrackingCalendarDrafts, setHabitTrackingCalendarDrafts] = useState<
    Record<string, string | null>
  >({});
  const [habitSourceDrafts, setHabitSourceDrafts] = useState<Record<string, string[]>>({});
  const [habitTermsDrafts, setHabitTermsDrafts] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [habitColors, setHabitColors] = useState<Record<string, string>>({});
  const [milestones, setMilestones] = useState<MilestoneDate[]>([]);
  const [newMilestoneType, setNewMilestoneType] = useState<"exam" | "coursework">("exam");
  const [newMilestoneTitle, setNewMilestoneTitle] = useState("");
  const [newMilestoneDate, setNewMilestoneDate] = useState("");

  useEffect(() => {
    const raw = window.localStorage.getItem(HABIT_WEEKS_STORAGE_KEY);
    if (!raw) return;
    const parsed = Number(raw);
    if ([12, 20, 26, 52].includes(parsed)) setWeeks(parsed);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(HABIT_WEEKS_STORAGE_KEY, String(weeks));
  }, [weeks]);

  useEffect(() => {
    const rawCalendars = window.localStorage.getItem(HABIT_SOURCE_CALENDARS_STORAGE_KEY);
    if (rawCalendars) {
      try {
        const parsed = JSON.parse(rawCalendars) as unknown;
        if (Array.isArray(parsed)) {
          setNewHabitSourceCalendarIds(
            parsed.filter((value): value is string => typeof value === "string")
          );
        }
      } catch {
        // Ignore malformed localStorage payload.
      }
    }

    const rawTerms = window.localStorage.getItem(HABIT_MATCH_TERMS_STORAGE_KEY);
    if (rawTerms) setNewHabitMatchTerms(rawTerms);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      HABIT_SOURCE_CALENDARS_STORAGE_KEY,
      JSON.stringify(newHabitSourceCalendarIds)
    );
  }, [newHabitSourceCalendarIds]);

  useEffect(() => {
    window.localStorage.setItem(HABIT_MATCH_TERMS_STORAGE_KEY, newHabitMatchTerms);
  }, [newHabitMatchTerms]);

  useEffect(() => {
    const raw = window.localStorage.getItem(HABIT_COLORS_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof key !== "string" || typeof value !== "string") continue;
        if (!isHexColor(value)) continue;
        next[key] = value;
      }
      setHabitColors(next);
    } catch {
      // Ignore malformed localStorage payload.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(HABIT_COLORS_STORAGE_KEY, JSON.stringify(habitColors));
  }, [habitColors]);

  useEffect(() => {
    const raw = window.localStorage.getItem(MILESTONES_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter((item): item is MilestoneDate => {
        return (
          typeof item === "object" &&
          item !== null &&
          "id" in item &&
          "type" in item &&
          "title" in item &&
          "date" in item &&
          typeof item.id === "string" &&
          (item.type === "exam" || item.type === "coursework") &&
          typeof item.title === "string" &&
          typeof item.date === "string" &&
          isValidDateInput(item.date)
        );
      });
      setMilestones(valid.sort((a, b) => a.date.localeCompare(b.date)));
    } catch {
      // Ignore malformed localStorage payload.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MILESTONES_STORAGE_KEY, JSON.stringify(milestones));
  }, [milestones]);

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
          const trackerCalendarData =
            cached.data.trackerCalendars ||
            (cached.data as unknown as { calendars?: TrackerCalendarOption[] }).calendars ||
            [];
          const sourceCalendarData = cached.data.sourceCalendars || [];
          setCalendars(trackerCalendarData);
          setSourceCalendars(sourceCalendarData);

          const storedCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
          const storedIsValid =
            storedCalendarId &&
            trackerCalendarData.some((entry) => entry.id === storedCalendarId);

          const nextSelectedId =
            (storedIsValid
              ? storedCalendarId
              : cached.data.defaultTrackerCalendarId ||
                (cached.data as unknown as { defaultCalendarId?: string | null })
                  .defaultCalendarId) || null;

          setSelectedTrackerCalendarId(nextSelectedId);

          if (newHabitSourceCalendarIds.length === 0) {
            const defaults = cached.data.defaultSourceCalendarIds || [];
            if (defaults.length > 0) setNewHabitSourceCalendarIds(defaults);
          }

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
        const trackerCalendarData = typedPayload.trackerCalendars;
        setCalendars(trackerCalendarData);
        setSourceCalendars(typedPayload.sourceCalendars);
        writeCache(TRACKER_CALENDARS_CACHE_KEY, typedPayload);

        const storedCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
        const storedIsValid =
          storedCalendarId &&
          trackerCalendarData.some((entry) => entry.id === storedCalendarId);

        const nextSelectedId =
          (storedIsValid
            ? storedCalendarId
            : typedPayload.defaultTrackerCalendarId) || null;

        setSelectedTrackerCalendarId(nextSelectedId);
        if (newHabitSourceCalendarIds.length === 0 && typedPayload.defaultSourceCalendarIds.length > 0) {
          setNewHabitSourceCalendarIds(typedPayload.defaultSourceCalendarIds);
        }
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
  }, [newHabitSourceCalendarIds.length]);

  useEffect(() => {
    if (!selectedTrackerCalendarId) return;
    window.localStorage.setItem(TRACKER_CALENDAR_STORAGE_KEY, selectedTrackerCalendarId);
  }, [selectedTrackerCalendarId]);

  useEffect(() => {
    if (!newHabitTrackingCalendarId && selectedTrackerCalendarId) {
      setNewHabitTrackingCalendarId(selectedTrackerCalendarId);
    }
  }, [newHabitTrackingCalendarId, selectedTrackerCalendarId]);

  useEffect(() => {
    if (sourceCalendars.length === 0) return;
    const validIds = new Set(sourceCalendars.map((entry) => entry.id));
    setNewHabitSourceCalendarIds((previous) => previous.filter((id) => validIds.has(id)));
  }, [sourceCalendars]);

  useEffect(() => {
    if (calendars.length === 0) return;
    if (newHabitTrackingCalendarId && calendars.some((entry) => entry.id === newHabitTrackingCalendarId)) {
      return;
    }
    setNewHabitTrackingCalendarId(selectedTrackerCalendarId || calendars[0].id);
  }, [calendars, newHabitTrackingCalendarId, selectedTrackerCalendarId]);

  useEffect(() => {
    if (calendarsLoading) return;

    let cancelled = false;

    const loadData = async (force = false) => {
      try {
        setError(null);

        const cached = readCache<HabitTrackerData>(dataCacheKey);
        if (cached) {
          setData(cached.data);
          if (!force && !isStale(cached.fetchedAt)) {
            setLoading(false);
            return;
          }
        }

        setLoading(true);

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
        const fetchedAt = writeCache(dataCacheKey, typedPayload);
        writeGlobalLastFetched(fetchedAt);

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
        }
      }
    };

    loadData(false);

    return () => {
      cancelled = true;
    };
  }, [weeks, selectedTrackerCalendarId, calendarsLoading, dataCacheKey]);

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

  const studyHabitSlug = useMemo(() => {
    if (!data) return null;
    const explicit =
      data.habits.find((habit) => habit.name.toLowerCase() === "studying") ||
      data.habits.find((habit) => habit.mode === "duration");
    return explicit?.slug || null;
  }, [data]);

  useEffect(() => {
    if (!data) return;
    setHabitColors((previous) => {
      const next: Record<string, string> = {};
      let changed = false;

      for (const habit of data.habits) {
        const existing = previous[habit.slug];
        if (existing && isHexColor(existing)) {
          next[habit.slug] = existing;
          continue;
        }
        const defaultColor =
          habit.name.toLowerCase() === "studying"
            ? "#10b981"
            : DEFAULT_HABIT_COLORS[
                Math.abs(
                  habit.slug.split("").reduce((acc, character) => acc + character.charCodeAt(0), 0)
                ) % DEFAULT_HABIT_COLORS.length
              ];
        next[habit.slug] = defaultColor;
        changed = true;
      }

      for (const key of Object.keys(previous)) {
        if (!(key in next)) changed = true;
      }

      return changed ? next : previous;
    });
  }, [data]);

  const studyColor = useMemo(() => {
    if (!studyHabitSlug) return "#10b981";
    return habitColors[studyHabitSlug] || "#10b981";
  }, [habitColors, studyHabitSlug]);

  const milestonesByDate = useMemo(() => {
    const map = new Map<string, MilestoneDate[]>();
    for (const milestone of milestones) {
      const existing = map.get(milestone.date) || [];
      existing.push(milestone);
      map.set(milestone.date, existing);
    }
    return map;
  }, [milestones]);

  const milestoneDateSet = useMemo(() => {
    return new Set(milestones.map((milestone) => milestone.date));
  }, [milestones]);

  const hasWritableCalendars = calendars.length > 0;
  const hasSourceCalendars = sourceCalendars.length > 0;

  const addMilestone = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValidDateInput(newMilestoneDate)) return;

    const title = newMilestoneTitle.trim();
    const milestone: MilestoneDate = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: newMilestoneType,
      title: title || (newMilestoneType === "exam" ? "Exam" : "Coursework"),
      date: newMilestoneDate,
    };

    setMilestones((previous) =>
      [...previous, milestone].sort((a, b) => a.date.localeCompare(b.date))
    );
    setNewMilestoneTitle("");
    setNewMilestoneDate("");
  };

  const removeMilestone = (id: string) => {
    setMilestones((previous) => previous.filter((milestone) => milestone.id !== id));
  };

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
    if (newHabitMode === "duration" && newHabitSourceCalendarIds.length === 0) {
      setActionError("Select at least one calendar for time tracking habits.");
      return;
    }

    if (data.habits.some((habit) => habit.name.toLowerCase() === habitName.toLowerCase())) {
      setActionError("Habit already exists.");
      return;
    }

    const previousData = data;
    const optimisticHabit = buildEmptyHabit(
      habitName,
      newHabitMode,
      data.trackerRange.startDate,
      data.trackerRange.endDate
    );
    optimisticHabit.trackingCalendarId =
      newHabitMode === "binary"
        ? newHabitTrackingCalendarId || selectedTrackerCalendarId
        : null;
    optimisticHabit.sourceCalendarIds = newHabitMode === "duration" ? [...newHabitSourceCalendarIds] : [];
    optimisticHabit.matchTerms =
      newHabitMode === "duration"
        ? newHabitMatchTerms
            .split(",")
            .map((term) => term.trim())
            .filter(Boolean)
        : [];
    const nextData = {
      ...data,
      habits: [...data.habits, optimisticHabit],
    };

    setData(nextData);
    writeCache(dataCacheKey, nextData);
    setNewHabitName("");

    try {
      setActionLoading(true);
      setActionError(null);

      await runAction({
        method: "POST",
        body: JSON.stringify({
          trackerCalendarId: selectedTrackerCalendarId,
          habitName,
          habitMode: newHabitMode,
          trackingCalendarId:
            newHabitMode === "binary"
              ? newHabitTrackingCalendarId || selectedTrackerCalendarId
              : null,
          sourceCalendarIds: newHabitMode === "duration" ? newHabitSourceCalendarIds : [],
          matchTerms: newHabitMode === "duration" ? newHabitMatchTerms : "",
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to add habit";
      setActionError(message);
      setData(previousData);
      writeCache(dataCacheKey, previousData);
      setNewHabitName(habitName);
    } finally {
      setActionLoading(false);
    }
  };

  const updateHabitDay = async (
    habitName: string,
    habitMode: HabitMode,
    date: string,
    nextValue: { completed?: boolean; hours?: number }
  ) => {
    if (!selectedTrackerCalendarId || !data) return;

    const previousData = data;
    const hours =
      habitMode === "duration"
        ? normalizeHours(nextValue.hours || 0)
        : nextValue.completed
          ? 1
          : 0;
    const completed = habitMode === "duration" ? hours > 0 : Boolean(nextValue.completed);

    const nextData = updateHabitInData(data, habitName, (habit) => {
      const days = habit.days.map((day) =>
        day.date === date ? { ...day, completed, hours, level: toHabitLevel(hours) } : day
      );
      const stats = computeHabitStats(days);

      return {
        ...habit,
        days,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        totalCompleted: stats.totalCompleted,
        totalHours: stats.totalHours,
      };
    });
    setData(nextData);
    writeCache(dataCacheKey, nextData);

    try {
      setActionLoading(true);
      setActionError(null);

      await runAction({
        method: "PATCH",
        body: JSON.stringify({
          trackerCalendarId: selectedTrackerCalendarId,
          habitName,
          habitMode,
          date,
          completed,
          hours,
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update habit";
      setActionError(message);
      setData(previousData);
      writeCache(dataCacheKey, previousData);
    } finally {
      setActionLoading(false);
    }
  };

  const toggleHabit = async (habitName: string, date: string, completed: boolean) => {
    await updateHabitDay(habitName, "binary", date, { completed });
  };

  const updateDurationHabitConfig = async (habitName: string, sourceIds: string[], terms: string) => {
    if (!selectedTrackerCalendarId || sourceIds.length === 0) {
      setActionError("Select at least one calendar for time tracking habits.");
      return;
    }

    try {
      setActionLoading(true);
      setActionError(null);
      await runAction({
        method: "PUT",
        body: JSON.stringify({
          trackerCalendarId: selectedTrackerCalendarId,
          habitName,
          sourceCalendarIds: sourceIds,
          matchTerms: terms,
        }),
      });
      await refreshData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update habit settings";
      setActionError(message);
    } finally {
      setActionLoading(false);
    }
  };

  const updateBinaryHabitConfig = async (habitName: string, trackingCalendarId: string) => {
    if (!selectedTrackerCalendarId || !trackingCalendarId) {
      setActionError("Select a writable calendar for this habit.");
      return;
    }

    try {
      setActionLoading(true);
      setActionError(null);
      await runAction({
        method: "PUT",
        body: JSON.stringify({
          trackerCalendarId: selectedTrackerCalendarId,
          habitName,
          trackingCalendarId,
        }),
      });
      await refreshData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update habit settings";
      setActionError(message);
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
    writeCache(dataCacheKey, nextData);

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
      writeCache(dataCacheKey, previousData);
    } finally {
      setActionLoading(false);
    }
  };

  const refreshData = useCallback(async () => {
    if (calendarsLoading) return;

    try {
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
      const fetchedAt = writeCache(dataCacheKey, typedPayload);
      writeGlobalLastFetched(fetchedAt);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch habit tracker";
      setError(message);
    }
  }, [calendarsLoading, dataCacheKey, selectedTrackerCalendarId, weeks]);

  useEffect(() => {
    const onRefreshAll = () => refreshData();
    window.addEventListener("study-stats:refresh-all", onRefreshAll);
    return () => window.removeEventListener("study-stats:refresh-all", onRefreshAll);
  }, [refreshData]);

  useEffect(() => {
    if (!data) return;
    const nextTrackingCalendars: Record<string, string | null> = {};
    const nextSources: Record<string, string[]> = {};
    const nextTerms: Record<string, string> = {};
    for (const habit of data.habits) {
      if (habit.mode === "binary") {
        nextTrackingCalendars[habit.slug] = habit.trackingCalendarId;
        continue;
      }
      nextSources[habit.slug] = habit.sourceCalendarIds;
      nextTerms[habit.slug] = habit.matchTerms.join(", ");
    }
    setHabitTrackingCalendarDrafts(nextTrackingCalendars);
    setHabitSourceDrafts(nextSources);
    setHabitTermsDrafts(nextTerms);
  }, [data]);

  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-semibold">📊 Habit Tracker</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Study consistency plus custom habits stored in Google Calendar.
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
                          day && milestoneDateSet.has(day.date)
                            ? "cursor-pointer ring-1 ring-red-500 ring-inset"
                            : day
                              ? "cursor-pointer hover:ring-1 hover:ring-zinc-400"
                              : ""
                        }`}
                        style={{
                          backgroundColor: day ? getHeatCellColor(studyColor, day.level) : "transparent",
                        }}
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
                    top: tooltip.y - 8,
                    transform: "translate(-50%, -100%)",
                  }}
                >
                  <span className="font-medium block">
                    {new Date(`${tooltip.day.date}T12:00:00`).toLocaleDateString("en-GB", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span>
                    {tooltip.day.hours > 0
                      ? `${tooltip.day.hours.toFixed(1)}h studied`
                      : "No study"}
                  </span>
                  {(milestonesByDate.get(tooltip.day.date) || []).length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-zinc-600">
                      {(milestonesByDate.get(tooltip.day.date) || []).map((milestone) => (
                        <div key={milestone.id} className="text-[11px] text-red-200">
                          {milestone.type === "exam" ? "🧪 Exam" : "📚 Coursework"}: {milestone.title}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-4 text-xs text-zinc-500">
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <div
                  key={`study-legend-${level}`}
                  className="w-[13px] h-[13px] rounded-[2px]"
                  style={{ backgroundColor: getHeatCellColor(studyColor, level as 0 | 1 | 2 | 3 | 4) }}
                />
              ))}
              <span>More</span>
              <span className="ml-3 text-zinc-400">0h, &lt;1h, 1-3h, 3-5h, 5h+</span>
              <div className="w-[13px] h-[13px] rounded-[2px] ring-1 ring-red-500 ring-inset ml-3" />
              <span className="text-zinc-400">🟥 Exam/coursework date</span>
            </div>
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h3 className="text-base font-semibold">🗓️ Exam and Coursework Dates</h3>
              <span className="text-xs text-zinc-500">Outlined in red on the study calendar</span>
            </div>

            <form onSubmit={addMilestone} className="flex flex-wrap gap-2 mb-4">
              <select
                value={newMilestoneType}
                onChange={(event) =>
                  setNewMilestoneType(event.target.value as "exam" | "coursework")
                }
                className="text-sm border rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
              >
                <option value="exam">🧪 Exam</option>
                <option value="coursework">📚 Coursework</option>
              </select>
              <input
                type="text"
                value={newMilestoneTitle}
                onChange={(event) => setNewMilestoneTitle(event.target.value)}
                placeholder="Title (optional)"
                className="flex-1 min-w-48 border rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
              />
              <input
                type="date"
                value={newMilestoneDate}
                onChange={(event) => setNewMilestoneDate(event.target.value)}
                className="text-sm border rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
                required
              />
              <button
                type="submit"
                disabled={!newMilestoneDate}
                className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                Add
              </button>
            </form>

            {milestones.length === 0 && (
              <p className="text-sm text-zinc-500">No exam or coursework dates added yet.</p>
            )}

            {milestones.length > 0 && (
              <div className="space-y-2">
                {milestones.map((milestone) => (
                  <div
                    key={milestone.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{milestone.title}</p>
                      <p className="text-xs text-zinc-500">
                        {milestone.type === "exam" ? "🧪 Exam" : "📚 Coursework"} on{" "}
                        {new Date(`${milestone.date}T12:00:00`).toLocaleDateString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMilestone(milestone.id)}
                      className="px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h3 className="text-base font-semibold">✅ Custom Habit Checklist</h3>
              <span className="text-xs text-zinc-500">{trackerRangeLabel}</span>
            </div>

            <form onSubmit={handleAddHabit} className="flex flex-wrap gap-2 mb-4">
              <select
                value={newHabitMode}
                onChange={(event) => setNewHabitMode(event.target.value as HabitMode)}
                className="text-sm border rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
                disabled={!selectedTrackerCalendarId || actionLoading}
                aria-label="Select habit tracking mode"
              >
                <option value="binary">✅ Yes/No</option>
                <option value="duration">⏱️ Hours</option>
              </select>
              <input
                type="text"
                value={newHabitName}
                onChange={(event) => setNewHabitName(event.target.value)}
                placeholder="Add a habit (e.g. 🏋️ Gym)"
                className="flex-1 min-w-56 border rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
                disabled={!selectedTrackerCalendarId || actionLoading}
              />
              <button
                type="submit"
                disabled={
                  !selectedTrackerCalendarId ||
                  actionLoading ||
                  !newHabitName.trim() ||
                  (newHabitMode === "duration" && newHabitSourceCalendarIds.length === 0)
                }
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                ➕ Add habit
              </button>
            </form>

            {newHabitMode === "duration" && (
              <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3 space-y-3">
                <p className="text-xs text-zinc-500">Select calendars to scan for this time-tracking habit.</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {sourceCalendars.map((calendarOption) => (
                    <label key={calendarOption.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={newHabitSourceCalendarIds.includes(calendarOption.id)}
                        onChange={(event) => {
                          setNewHabitSourceCalendarIds((previous) =>
                            event.target.checked
                              ? [...previous, calendarOption.id]
                              : previous.filter((id) => id !== calendarOption.id)
                          );
                        }}
                      />
                      <span>
                        {calendarOption.summary}
                        {calendarOption.primary ? " (Primary)" : ""}
                      </span>
                    </label>
                  ))}
                  {!hasSourceCalendars && (
                    <p className="text-xs text-zinc-500">No readable calendars available.</p>
                  )}
                </div>
                <label className="block">
                  <span className="text-xs text-zinc-500">Match terms (optional, comma separated)</span>
                  <input
                    type="text"
                    value={newHabitMatchTerms}
                    onChange={(event) => setNewHabitMatchTerms(event.target.value)}
                    placeholder="e.g. maths, revision"
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-zinc-900 dark:border-zinc-700"
                  />
                </label>
              </div>
            )}

            {newHabitMode === "binary" && (
              <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3 space-y-2">
                <label className="block">
                  <span className="text-xs text-zinc-500">Tracking calendar for this habit</span>
                  <select
                    value={newHabitTrackingCalendarId || ""}
                    onChange={(event) => setNewHabitTrackingCalendarId(event.target.value || null)}
                    disabled={!hasWritableCalendars || actionLoading}
                    className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-zinc-900 dark:border-zinc-700"
                  >
                    {!hasWritableCalendars && <option value="">No writable calendars found</option>}
                    {hasWritableCalendars &&
                      calendars.map((entry) => (
                        <option key={`new-habit-binary-${entry.id}`} value={entry.id}>
                          {entry.summary}
                          {entry.primary ? " (Primary)" : ""}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}

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
                const habitColor = habitColors[habit.slug] || DEFAULT_HABIT_COLORS[0];

                return (
                  <div
                    key={habit.slug}
                    className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <div>
                        <p className="font-medium text-sm">{habit.name}</p>
                        <p className="text-xs text-zinc-500">
                          {habit.mode === "duration"
                            ? `⏱️ Hours mode, current streak ${habit.currentStreak}d, longest ${habit.longestStreak}d, active ${habit.totalCompleted} days, total ${habit.totalHours.toFixed(1)}h`
                            : `✅ Yes/No mode, current streak ${habit.currentStreak}d, longest ${habit.longestStreak}d, completed ${habit.totalCompleted} days`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-xs text-zinc-500">
                          <span>Color</span>
                          <input
                            type="color"
                            value={habitColor}
                            onChange={(event) =>
                              setHabitColors((previous) => ({
                                ...previous,
                                [habit.slug]: event.target.value,
                              }))
                            }
                            className="h-7 w-8 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent p-0.5"
                            aria-label={`Choose color for ${habit.name}`}
                          />
                        </label>
                        <button
                          type="button"
                          aria-label={`Remove ${habit.name}`}
                          onClick={() => {
                            const confirmed = window.confirm(
                              `Remove "${habit.name}" from your habit tracker? This will delete its tracked history in the current date range.`
                            );
                            if (!confirmed) return;
                            void removeHabit(habit.name);
                          }}
                          disabled={actionLoading}
                          className="px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto pb-2">
                      {habit.mode === "binary" && (
                        <div className="mb-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 space-y-3">
                          <label className="block">
                            <span className="text-xs text-zinc-500">Tracking calendar</span>
                            <select
                              value={habitTrackingCalendarDrafts[habit.slug] || selectedTrackerCalendarId || ""}
                              onChange={(event) =>
                                setHabitTrackingCalendarDrafts((previous) => ({
                                  ...previous,
                                  [habit.slug]: event.target.value || null,
                                }))
                              }
                              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
                              disabled={actionLoading || !hasWritableCalendars}
                            >
                              {calendars.map((calendarOption) => (
                                <option key={`${habit.slug}-${calendarOption.id}`} value={calendarOption.id}>
                                  {calendarOption.summary}
                                  {calendarOption.primary ? " (Primary)" : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              updateBinaryHabitConfig(
                                habit.name,
                                habitTrackingCalendarDrafts[habit.slug] || selectedTrackerCalendarId || ""
                              )
                            }
                            disabled={actionLoading || !hasWritableCalendars}
                            className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
                          >
                            Save calendar
                          </button>
                        </div>
                      )}

                      {habit.mode === "duration" && (
                        <div className="mb-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 space-y-3">
                          <p className="text-xs text-zinc-500">Time-tracking sources for this habit</p>
                          <div className="grid sm:grid-cols-2 gap-2">
                            {sourceCalendars.map((calendarOption) => (
                              <label key={`${habit.slug}-${calendarOption.id}`} className="flex items-center gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={(habitSourceDrafts[habit.slug] || []).includes(calendarOption.id)}
                                  onChange={(event) => {
                                    setHabitSourceDrafts((previous) => {
                                      const existing = previous[habit.slug] || [];
                                      return {
                                        ...previous,
                                        [habit.slug]: event.target.checked
                                          ? [...existing, calendarOption.id]
                                          : existing.filter((id) => id !== calendarOption.id),
                                      };
                                    });
                                  }}
                                />
                                <span>
                                  {calendarOption.summary}
                                  {calendarOption.primary ? " (Primary)" : ""}
                                </span>
                              </label>
                            ))}
                          </div>
                          <label className="block">
                            <span className="text-xs text-zinc-500">Match terms (optional, comma separated)</span>
                            <input
                              type="text"
                              value={habitTermsDrafts[habit.slug] || ""}
                              onChange={(event) =>
                                setHabitTermsDrafts((previous) => ({
                                  ...previous,
                                  [habit.slug]: event.target.value,
                                }))
                              }
                              placeholder="e.g. maths, revision"
                              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              updateDurationHabitConfig(
                                habit.name,
                                habitSourceDrafts[habit.slug] || [],
                                habitTermsDrafts[habit.slug] || ""
                              )
                            }
                            disabled={actionLoading}
                            className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
                          >
                            Save sources
                          </button>
                        </div>
                      )}

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
                                disabled={actionLoading || !day || habit.mode === "duration"}
                                aria-label={
                                  day
                                    ? habit.mode === "duration"
                                      ? `${habit.name} ${day.date} ${day.hours.toFixed(1)} hours`
                                      : `${habit.name} ${day.date} ${day.completed ? "complete" : "incomplete"}`
                                    : `${habit.name} empty`
                                }
                                title={
                                  day
                                    ? habit.mode === "duration"
                                      ? `${formatShortDate(day.date)} - ${day.hours.toFixed(1)}h`
                                      : `${formatShortDate(day.date)} - ${day.completed ? "Complete" : "Not done"}`
                                    : ""
                                }
                                onClick={() => {
                                  if (!day) return;
                                  void toggleHabit(habit.name, day.date, !day.completed);
                                }}
                                className={`w-[13px] h-[13px] rounded-[2px] transition-colors ${
                                  day
                                    ? habit.mode === "duration"
                                      ? "hover:ring-1 hover:ring-zinc-400"
                                      : day.completed
                                        ? "hover:opacity-90"
                                        : "bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                                    : "bg-transparent"
                                }`}
                                style={{
                                  backgroundColor:
                                    day && habit.mode === "duration"
                                      ? getHeatCellColor(habitColor, day.level)
                                      : day && habit.mode === "binary" && day.completed
                                        ? habitColor
                                        : undefined,
                                }}
                              />
                            ))}
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 mt-3 text-xs text-zinc-500">
                        {habit.mode === "duration" ? (
                          <>
                            <span>Less</span>
                            {[0, 1, 2, 3, 4].map((level) => (
                              <div
                                key={`${habit.slug}-legend-${level}`}
                                className="w-[13px] h-[13px] rounded-[2px]"
                                style={{
                                  backgroundColor: getHeatCellColor(
                                    habitColor,
                                    level as 0 | 1 | 2 | 3 | 4
                                  ),
                                }}
                              />
                            ))}
                            <span>More</span>
                            <span className="ml-2 text-zinc-400">Click a day to set hours</span>
                          </>
                        ) : (
                          <>
                            <span>Less</span>
                            <div className="w-[13px] h-[13px] rounded-[2px] bg-zinc-200 dark:bg-zinc-700" />
                            <div
                              className="w-[13px] h-[13px] rounded-[2px]"
                              style={{ backgroundColor: habitColor }}
                            />
                            <span>More</span>
                          </>
                        )}
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
