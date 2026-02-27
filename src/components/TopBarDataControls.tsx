"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { formatTimeSince, readGlobalLastFetched } from "@/lib/client-cache";
import { fetchJsonWithDedupe } from "@/lib/client-cache";
import type { HabitDefinition, HabitTrackerData } from "@/lib/types";
import MorphingText from "./MorphingText";

const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";
const STUDY_HABIT_STORAGE_KEY = "study-stats.habit-tracker.study-habit";
const HABIT_WORKOUT_LINKS_STORAGE_KEY = "study-stats.habit-tracker.workout-links";
type TopBarDataControlsMode = "full" | "refreshOnly";
type TopBarDataControlsModeExtended =
  | TopBarDataControlsMode
  | "streakOnly"
  | "streakIconOnly";

function computeStreakForHabits(habits: HabitDefinition[]): number {
  if (habits.length === 0) return 0;
  const dateKeys = habits[0].days.map((day) => day.date);
  let streak = 0;

  for (let index = dateKeys.length - 1; index >= 0; index -= 1) {
    const date = dateKeys[index];
    const allCompleted = habits.every((habit) => {
      const day = habit.days.find((entry) => entry.date === date);
      return Boolean(day?.completed);
    });
    if (!allCompleted) break;
    streak += 1;
  }

  return streak;
}

function readWorkoutLinkedHabitSlugs(): Set<string> {
  const raw = window.localStorage.getItem(HABIT_WORKOUT_LINKS_STORAGE_KEY);
  if (!raw) return new Set<string>();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const slugs = Object.entries(parsed)
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .map(([slug]) => slug);
    return new Set(slugs);
  } catch {
    return new Set<string>();
  }
}

function resolveCombinedHabits(habits: HabitDefinition[]): HabitDefinition[] {
  if (habits.length === 0) return [];

  const selectedStudySlug = window.localStorage.getItem(STUDY_HABIT_STORAGE_KEY);
  const workoutLinkedSlugs = readWorkoutLinkedHabitSlugs();

  const studyHabit =
    (selectedStudySlug && habits.find((habit) => habit.slug === selectedStudySlug)) ||
    habits.find((habit) => habit.mode === "duration") ||
    null;

  const gymHabits = habits.filter(
    (habit) => workoutLinkedSlugs.has(habit.slug) || habit.mode === "binary"
  );
  const gymHabit = gymHabits.sort((left, right) => right.currentStreak - left.currentStreak)[0] || null;

  if (studyHabit && gymHabit && studyHabit.slug !== gymHabit.slug) {
    return [studyHabit, gymHabit];
  }

  return habits;
}

function computeAllHabitsStreak(habits: HabitDefinition[]): number {
  const combinedHabits = resolveCombinedHabits(habits);
  return computeStreakForHabits(combinedHabits);
}

export default function TopBarDataControls({
  mode = "full",
  stacked = false,
  showLastFetched = true,
  onStreakClick,
}: {
  mode?: TopBarDataControlsModeExtended;
  stacked?: boolean;
  showLastFetched?: boolean;
  onStreakClick?: () => void;
}) {
  const showRefresh = mode === "full" || mode === "refreshOnly";
  const showStreakPill = mode === "full" || mode === "streakOnly";
  const showStreakIconOnly = mode === "streakIconOnly";
  const lastFetchedAt = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("study-stats:last-fetched-updated", onStoreChange);
      return () => window.removeEventListener("study-stats:last-fetched-updated", onStoreChange);
    },
    () => readGlobalLastFetched(),
    () => null
  );
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [allHabitsStreak, setAllHabitsStreak] = useState(0);
  const [gamificationReady, setGamificationReady] = useState(false);
  const mounted = typeof window !== "undefined";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showStreakPill && !showStreakIconOnly) return;
    let cancelled = false;

    const loadGamification = async () => {
      try {
        const trackerCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
        const params = new URLSearchParams({ weeks: "26" });
        if (trackerCalendarId) params.set("trackerCalendarId", trackerCalendarId);

        const query = params.toString();
        const payload = await fetchJsonWithDedupe<HabitTrackerData>(
          `api:habit-tracker:${query}`,
          async () => {
            const response = await fetch(`/api/habit-tracker?${query}`);
            const json = (await response.json()) as HabitTrackerData | { error?: string };
            if (!response.ok) {
              throw new Error(
                ("error" in json && json.error) || "Failed to load gamification data."
              );
            }
            return json as HabitTrackerData;
          }
        );

        if (cancelled) return;
        setAllHabitsStreak(computeAllHabitsStreak(payload.habits));
        setGamificationReady(true);
      } catch {
        if (cancelled) return;
        setAllHabitsStreak(0);
        setGamificationReady(true);
      }
    };

    void loadGamification();
    window.addEventListener("study-stats:refresh-all", loadGamification);
    return () => {
      cancelled = true;
      window.removeEventListener("study-stats:refresh-all", loadGamification);
    };
  }, [showStreakIconOnly, showStreakPill]);

  const refreshAll = () => {
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent("study-stats:refresh-all"));
    window.setTimeout(() => setRefreshing(false), 1000);
  };

  if (showStreakIconOnly) {
    if (onStreakClick) {
      return (
        <button
          type="button"
          onClick={onStreakClick}
          className="pill-btn px-2 py-1 text-sm inline-flex flex-col items-center leading-none gap-0.5"
          aria-label="Open gamification"
        >
          <span className="stat-mono inline-flex">
            <MorphingText text={mounted && gamificationReady ? `${allHabitsStreak}` : "--"} />
          </span>
          <span>🔥</span>
        </button>
      );
    }
    return (
      <span className="pill-btn px-2 py-1 text-sm inline-flex flex-col items-center leading-none gap-0.5">
        <span className="stat-mono inline-flex">
          <MorphingText text={mounted && gamificationReady ? `${allHabitsStreak}` : "--"} />
        </span>
        <span>🔥</span>
      </span>
    );
  }

  return (
    <div className={stacked ? "flex flex-col items-stretch gap-1.5 w-full shrink-0" : "flex items-center gap-2 shrink-0"}>
      {showStreakPill && (
        <div className="flex items-center gap-1.5">
          {showStreakPill && (
            <span className="pill-btn text-[11px] px-2 py-1 hidden md:inline-flex items-center gap-1.5">
              <span>All habits streak</span>
              <span className="text-zinc-400">:</span>
              <span className="stat-mono leading-none inline-flex">
                <MorphingText
                  text={mounted && gamificationReady ? `${allHabitsStreak}d` : "--"}
                />
              </span>
            </span>
          )}
        </div>
      )}
      {showRefresh && (
        <>
          {showLastFetched && (
            <p className={stacked ? "soft-text text-[11px]" : "soft-text text-[11px] hidden lg:block"}>
              Last fetched {formatTimeSince(lastFetchedAt, now)}
            </p>
          )}
          <button
            onClick={refreshAll}
            disabled={refreshing}
            className={stacked ? "pill-btn w-full text-left" : "pill-btn"}
          >
            {refreshing ? "Refreshing..." : "Sync"}
          </button>
        </>
      )}
    </div>
  );
}
