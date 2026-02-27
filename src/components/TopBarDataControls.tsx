"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { formatTimeSince, readGlobalLastFetched } from "@/lib/client-cache";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/scroll-lock";
import StudyProjection from "@/components/StudyProjection";
import type { HabitDefinition, HabitTrackerData } from "@/lib/types";

const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";

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

export default function TopBarDataControls() {
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
  const [showStudyProjection, setShowStudyProjection] = useState(false);
  const [topBarLevel, setTopBarLevel] = useState(1);
  const [allHabitsStreak, setAllHabitsStreak] = useState(0);
  const [gamificationReady, setGamificationReady] = useState(false);
  const mounted = typeof window !== "undefined";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showStudyProjection) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [showStudyProjection]);

  useEffect(() => {
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
  }, []);

  const refreshAll = () => {
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent("study-stats:refresh-all"));
    window.setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="hidden md:flex items-center gap-1.5">
        <span className="pill-btn text-[11px] px-2 py-1">
          Level {mounted && gamificationReady ? topBarLevel : "--"}
        </span>
        <span className="pill-btn text-[11px] px-2 py-1">
          All habits streak: {mounted && gamificationReady ? `${allHabitsStreak}d` : "--"}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setShowStudyProjection(true)}
        className="pill-btn"
      >
        <span className="sm:hidden">Project</span>
        <span className="hidden sm:inline">Project Studying</span>
      </button>
      <p className="soft-text text-[11px] hidden lg:block">
        Last fetched {formatTimeSince(lastFetchedAt, now)}
      </p>
      <button
        onClick={refreshAll}
        disabled={refreshing}
        className="pill-btn"
      >
        {refreshing ? "Refreshing..." : "Refresh"}
      </button>

      {mounted &&
        showStudyProjection &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-900/55 p-4 overflow-y-auto"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShowStudyProjection(false);
            }}
          >
            <div
              className="surface-card-strong w-full max-w-4xl max-h-[90vh] overflow-y-auto p-4 my-auto"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold">Project Studying</h4>
                <button
                  type="button"
                  onClick={() => setShowStudyProjection(false)}
                  className="pill-btn"
                >
                  Close
                </button>
              </div>
              <StudyProjection />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
