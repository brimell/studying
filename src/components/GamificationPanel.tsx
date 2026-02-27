"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HabitDefinition, HabitTrackerData, WorkoutPlannerPayload } from "@/lib/types";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  isStale,
  readCache,
  writeCache,
  writeGlobalLastFetched,
} from "@/lib/client-cache";
import LoadingIcon from "./LoadingIcon";

const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";
const STUDY_HABIT_STORAGE_KEY = "study-stats.habit-tracker.study-habit";

interface CombinedStreakStats {
  current: number;
  longest: number;
}

function addDays(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function computeWorkoutStreak(dateKeys: string[]): number {
  if (dateKeys.length === 0) return 0;
  const unique = [...new Set(dateKeys)].sort();
  let cursor = unique[unique.length - 1];
  let streak = 0;
  const keySet = new Set(unique);
  while (keySet.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function resolveStudyHabit(habits: HabitDefinition[], selectedSlug: string | null): HabitDefinition | null {
  if (selectedSlug) {
    const direct = habits.find((habit) => habit.slug === selectedSlug);
    if (direct) return direct;
  }
  return (
    habits.find((habit) => habit.mode === "duration" && habit.name.trim().toLowerCase() === "studying") ||
    habits.find((habit) => habit.mode === "duration") ||
    habits[0] ||
    null
  );
}

function computeCombinedStreakStats(habits: HabitDefinition[]): CombinedStreakStats {
  if (habits.length === 0) return { current: 0, longest: 0 };

  const allDates = [...new Set(habits.flatMap((habit) => habit.days.map((day) => day.date)))].sort();
  if (allDates.length === 0) return { current: 0, longest: 0 };

  const allCompletedByDate = new Map<string, boolean>();
  for (const date of allDates) {
    const allCompleted = habits.every((habit) => {
      const day = habit.days.find((entry) => entry.date === date);
      return Boolean(day?.completed);
    });
    allCompletedByDate.set(date, allCompleted);
  }

  let current = 0;
  let cursor = allDates[allDates.length - 1];
  while (allCompletedByDate.get(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let running = 0;
  for (const date of allDates) {
    if (!allCompletedByDate.get(date)) {
      running = 0;
      continue;
    }
    running += 1;
    if (running > longest) longest = running;
  }

  return { current, longest };
}

export default function GamificationPanel() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [habitData, setHabitData] = useState<HabitTrackerData | null>(null);
  const [workoutPayload, setWorkoutPayload] = useState<WorkoutPlannerPayload | null>(null);
  const [selectedStudyHabitSlug, setSelectedStudyHabitSlug] = useState<string | null>(null);

  const fetchData = useCallback(async (force = false) => {
    try {
      setError(null);

      const trackerCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
      const selectedStudySlug = window.localStorage.getItem(STUDY_HABIT_STORAGE_KEY);
      setSelectedStudyHabitSlug(selectedStudySlug || null);
      const cacheKey = `study-stats:streaks:${trackerCalendarId || "default"}:${selectedStudySlug || "default"}`;

      const cached = readCache<{
        habitData: HabitTrackerData | null;
        workoutPayload: WorkoutPlannerPayload | null;
        selectedStudyHabitSlug: string | null;
      }>(cacheKey);
      if (cached) {
        setHabitData(cached.data.habitData);
        setWorkoutPayload(cached.data.workoutPayload);
        setSelectedStudyHabitSlug(cached.data.selectedStudyHabitSlug);
        if (!force && !isStale(cached.fetchedAt)) {
          setLoading(false);
          return;
        }
      }

      setLoading(true);

      const params = new URLSearchParams({ weeks: "26" });
      if (trackerCalendarId) params.set("trackerCalendarId", trackerCalendarId);
      const habitResponse = await fetch(`/api/habit-tracker?${params.toString()}`);
      const habitJson = (await habitResponse.json()) as HabitTrackerData | { error?: string };
      if (!habitResponse.ok) {
        throw new Error(("error" in habitJson && habitJson.error) || "Failed to load habits.");
      }
      setHabitData(habitJson as HabitTrackerData);

      let nextWorkoutPayload: WorkoutPlannerPayload | null = null;
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          const workoutResponse = await fetch("/api/workout-planner", {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          });

          if (workoutResponse.ok) {
            const workoutJson = (await workoutResponse.json()) as {
              payload?: WorkoutPlannerPayload;
            };
            nextWorkoutPayload = workoutJson.payload || null;
          }
        }
      }

      setWorkoutPayload(nextWorkoutPayload);
      const fetchedAt = writeCache(cacheKey, {
        habitData: habitJson as HabitTrackerData,
        workoutPayload: nextWorkoutPayload,
        selectedStudyHabitSlug: selectedStudySlug || null,
      });
      writeGlobalLastFetched(fetchedAt);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load streak data.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    const onRefresh = () => void fetchData();
    window.addEventListener("study-stats:refresh-all", onRefresh);
    return () => window.removeEventListener("study-stats:refresh-all", onRefresh);
  }, [fetchData]);

  const model = useMemo(() => {
    if (!habitData) return null;

    const habits = habitData.habits;
    const studyHabit = resolveStudyHabit(habits, selectedStudyHabitSlug);
    const studyCurrentStreak = studyHabit?.currentStreak || 0;
    const studyLongestStreak = studyHabit?.longestStreak || 0;

    const workoutLogDates = (workoutPayload?.logs || []).map((log) => log.performedOn);
    const workoutStreakFromLogs = computeWorkoutStreak(workoutLogDates);
    const workoutStreakFromHabits = habits
      .filter((habit) => habit.mode === "binary")
      .reduce((max, habit) => Math.max(max, habit.currentStreak), 0);
    const workoutCurrentStreak = Math.max(workoutStreakFromLogs, workoutStreakFromHabits);

    const combinedStreak = computeCombinedStreakStats(habits);

    return {
      studyCurrentStreak,
      studyLongestStreak,
      workoutCurrentStreak,
      combinedCurrentStreak: combinedStreak.current,
      combinedLongestStreak: combinedStreak.longest,
      individualHabitStreaks: habits
        .map((habit) => ({
          slug: habit.slug,
          name: habit.name,
          currentStreak: habit.currentStreak,
          longestStreak: habit.longestStreak,
        }))
        .sort((left, right) => right.currentStreak - left.currentStreak || left.name.localeCompare(right.name)),
    };
  }, [habitData, selectedStudyHabitSlug, workoutPayload]);

  return (
    <div className="surface-card p-6 relative">
      {loading && !model && (
        <div className="h-32 flex items-center justify-center">
          <LoadingIcon />
        </div>
      )}
      {loading && model && (
        <div className="absolute top-3 right-3 z-10">
          <span className="pill-btn text-[11px] px-2 py-1 stat-mono">Updating...</span>
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {model && (
        <div className="space-y-4">
          <div className="rounded-xl border border-sky-300 bg-sky-50 p-4">
            <p className="text-xs uppercase tracking-[0.12em] text-sky-700">Combined streak</p>
            <div className="mt-2 flex items-end justify-between gap-4">
              <p
                className="stat-mono font-bold leading-none text-sky-900"
                style={{ fontSize: "clamp(6rem, 18vw, 16rem)" }}
              >
                {model.combinedCurrentStreak}
                <span className="ml-2 text-2xl md:text-3xl align-baseline">days</span>
              </p>
              <div className="text-right">
                <p className="text-[11px] text-sky-700">Longest combined</p>
                <p className="stat-mono text-lg font-semibold text-sky-900">
                  {model.combinedLongestStreak}d
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[11px] text-zinc-500">Study streak</p>
              <p className="font-semibold text-sm stat-mono">{model.studyCurrentStreak} days</p>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[11px] text-zinc-500">Longest study streak</p>
              <p className="font-semibold text-sm stat-mono">{model.studyLongestStreak} days</p>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[11px] text-zinc-500">Workout streak</p>
              <p className="font-semibold text-sm stat-mono">{model.workoutCurrentStreak} days</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-zinc-600 mb-2">Individual streaks</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {model.individualHabitStreaks.map((habit) => (
                <div key={habit.slug} className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <p className="text-xs text-zinc-500">{habit.name}</p>
                  <p className="text-sm font-semibold stat-mono">{habit.currentStreak}d current</p>
                  <p className="text-[11px] text-zinc-500 stat-mono">{habit.longestStreak}d longest</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
