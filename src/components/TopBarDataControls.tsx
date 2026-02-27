"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { formatTimeSince, readGlobalLastFetched } from "@/lib/client-cache";
import type { HabitDefinition, HabitTrackerData } from "@/lib/types";

const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";
type TopBarDataControlsMode = "full" | "levelOnly" | "refreshOnly";
type TopBarDataControlsModeExtended =
  | TopBarDataControlsMode
  | "streakOnly"
  | "inlineLevel"
  | "streakIconOnly";

function computeAllHabitsStreak(habits: HabitDefinition[]): number {
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

function computeTopBarLevel(habits: HabitDefinition[]): number {
  if (habits.length === 0) return 1;
  const allCurrentStreaks = habits.reduce((sum, habit) => sum + habit.currentStreak, 0);
  const allTotalCompletedDays = habits.reduce((sum, habit) => sum + habit.totalCompleted, 0);
  const activeHabitCount = habits.filter((habit) => habit.currentStreak > 0).length;

  const points =
    Math.min(360, allCurrentStreaks * 10) +
    Math.min(900, allTotalCompletedDays * 3) +
    activeHabitCount * 25;
  return Math.floor(points / 250) + 1;
}

export default function TopBarDataControls({
  mode = "full",
  stacked = false,
  showLastFetched = true,
}: {
  mode?: TopBarDataControlsModeExtended;
  stacked?: boolean;
  showLastFetched?: boolean;
}) {
  const showLevel = mode === "full" || mode === "levelOnly" || mode === "inlineLevel";
  const showRefresh = mode === "full" || mode === "refreshOnly";
  const showInlineLevel = mode === "inlineLevel";
  const showStreakPill = mode === "full" || mode === "levelOnly" || mode === "streakOnly";
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
  const [topBarLevel, setTopBarLevel] = useState(1);
  const [allHabitsStreak, setAllHabitsStreak] = useState(0);
  const [gamificationReady, setGamificationReady] = useState(false);
  const mounted = typeof window !== "undefined";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showLevel) return;
    let cancelled = false;

    const loadGamification = async () => {
      try {
        const trackerCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
        const params = new URLSearchParams({ weeks: "26" });
        if (trackerCalendarId) params.set("trackerCalendarId", trackerCalendarId);

        const response = await fetch(`/api/habit-tracker?${params.toString()}`);
        const payload = (await response.json()) as HabitTrackerData | { error?: string };
        if (!response.ok) {
          throw new Error(("error" in payload && payload.error) || "Failed to load gamification data.");
        }

        if (cancelled) return;
        const data = payload as HabitTrackerData;
        setAllHabitsStreak(computeAllHabitsStreak(data.habits));
        setTopBarLevel(computeTopBarLevel(data.habits));
        setGamificationReady(true);
      } catch {
        if (cancelled) return;
        setTopBarLevel(1);
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
  }, [showLevel]);

  const refreshAll = () => {
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent("study-stats:refresh-all"));
    window.setTimeout(() => setRefreshing(false), 1000);
  };

  if (showInlineLevel) {
    return (
      <span className="stat-mono text-[11px] leading-none">
        Lvl {mounted && gamificationReady ? topBarLevel : "--"}
      </span>
    );
  }

  if (showStreakIconOnly) {
    return (
      <span className="pill-btn px-2 py-1 text-sm inline-flex flex-col items-center leading-none gap-0.5">
        <span className="stat-mono">{mounted && gamificationReady ? allHabitsStreak : "--"}</span>
        <span>🔥</span>
      </span>
    );
  }

  return (
    <div className={stacked ? "flex flex-col items-stretch gap-1.5 w-full shrink-0" : "flex items-center gap-2 shrink-0"}>
      {(showLevel || showStreakPill) && (
        <div className="flex items-center gap-1.5">
          {showLevel && (
            <span className="pill-btn text-[11px] px-2 py-1 inline-flex items-center gap-1">
              <span>Lvl</span>
              <span className="stat-mono leading-none">{mounted && gamificationReady ? topBarLevel : "--"}</span>
            </span>
          )}
          {showStreakPill && (
            <span className="pill-btn text-[11px] px-2 py-1 hidden md:inline-flex items-center gap-1.5">
              <span>All habits streak</span>
              <span className="text-zinc-400">:</span>
              <span className="stat-mono leading-none">{mounted && gamificationReady ? `${allHabitsStreak}d` : "--"}</span>
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
