"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HabitDefinition, HabitTrackerData, WorkoutPlannerPayload } from "@/lib/types";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";
const STUDY_HABIT_STORAGE_KEY = "study-stats.habit-tracker.study-habit";

interface Badge {
  id: string;
  name: string;
  description: string;
  metric: number;
  target: number;
  points: number;
}

interface RewardTier {
  threshold: number;
  title: string;
  description: string;
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

export default function GamificationPanel() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [habitData, setHabitData] = useState<HabitTrackerData | null>(null);
  const [workoutPayload, setWorkoutPayload] = useState<WorkoutPlannerPayload | null>(null);
  const [selectedStudyHabitSlug, setSelectedStudyHabitSlug] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const trackerCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
      const selectedStudySlug = window.localStorage.getItem(STUDY_HABIT_STORAGE_KEY);
      setSelectedStudyHabitSlug(selectedStudySlug || null);

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
          const workoutJson = (await workoutResponse.json()) as {
            payload?: WorkoutPlannerPayload;
          };
          if (workoutResponse.ok) {
            nextWorkoutPayload = workoutJson.payload || null;
          }
        }
      }
      setWorkoutPayload(nextWorkoutPayload);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load gamification data.");
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
    const studyTotalDays = studyHabit?.totalCompleted || 0;

    const allCurrentStreaks = habits.reduce((sum, habit) => sum + habit.currentStreak, 0);
    const activeHabitCount = habits.filter((habit) => habit.currentStreak > 0).length;

    const workoutLogDates = (workoutPayload?.logs || []).map((log) => log.performedOn);
    const uniqueWorkoutDays = [...new Set(workoutLogDates)].length;
    const workoutCurrentStreak = computeWorkoutStreak(workoutLogDates);

    const badges: Badge[] = [
      {
        id: "study-streak-3",
        name: "Focus Starter",
        description: "Reach a 3-day study streak.",
        metric: studyCurrentStreak,
        target: 3,
        points: 40,
      },
      {
        id: "study-streak-7",
        name: "Study Warrior",
        description: "Reach a 7-day study streak.",
        metric: studyCurrentStreak,
        target: 7,
        points: 90,
      },
      {
        id: "study-days-30",
        name: "Deep Work",
        description: "Log 30 active study days.",
        metric: studyTotalDays,
        target: 30,
        points: 120,
      },
      {
        id: "workout-streak-3",
        name: "Movement Momentum",
        description: "Reach a 3-day workout streak.",
        metric: workoutCurrentStreak,
        target: 3,
        points: 40,
      },
      {
        id: "workout-days-20",
        name: "Iron Consistency",
        description: "Log workouts on 20 unique days.",
        metric: uniqueWorkoutDays,
        target: 20,
        points: 100,
      },
      {
        id: "duo-streak",
        name: "Dual Discipline",
        description: "Keep both study and workout streaks at 3+.",
        metric: studyCurrentStreak >= 3 && workoutCurrentStreak >= 3 ? 1 : 0,
        target: 1,
        points: 150,
      },
      {
        id: "habit-balance",
        name: "Habit Balancer",
        description: "Keep 2+ habits active in the same period.",
        metric: activeHabitCount,
        target: 2,
        points: 80,
      },
    ];

    const unlockedBadgeCount = badges.filter((badge) => badge.metric >= badge.target).length;
    const badgePoints = badges
      .filter((badge) => badge.metric >= badge.target)
      .reduce((sum, badge) => sum + badge.points, 0);

    const basePoints =
      Math.min(220, studyCurrentStreak * 12) +
      Math.min(260, studyTotalDays * 4) +
      Math.min(180, workoutCurrentStreak * 12) +
      Math.min(220, uniqueWorkoutDays * 6) +
      Math.min(140, allCurrentStreaks * 5);
    const totalPoints = basePoints + badgePoints;
    const level = Math.floor(totalPoints / 250) + 1;
    const levelFloor = (level - 1) * 250;
    const levelCeiling = level * 250;
    const pointsIntoLevel = totalPoints - levelFloor;
    const pointsForNextLevel = levelCeiling - levelFloor;
    const pointsRemaining = levelCeiling - totalPoints;

    const rewardTiers: RewardTier[] = [
      {
        threshold: 250,
        title: "Bronze Reward",
        description: "Earn a bonus 30-minute recovery block this week.",
      },
      {
        threshold: 500,
        title: "Silver Reward",
        description: "Unlock a free-choice focus/workout session.",
      },
      {
        threshold: 1000,
        title: "Gold Reward",
        description: "Take a low-stress day while preserving your momentum.",
      },
    ];

    return {
      studyCurrentStreak,
      studyLongestStreak,
      studyTotalDays,
      workoutCurrentStreak,
      uniqueWorkoutDays,
      activeHabitCount,
      badges,
      unlockedBadgeCount,
      totalPoints,
      level,
      pointsIntoLevel,
      pointsForNextLevel,
      pointsRemaining,
      rewardTiers,
    };
  }, [habitData, selectedStudyHabitSlug, workoutPayload]);

  return (
    <div className="surface-card p-6">
      <h2 className="text-lg font-semibold mb-4">Gamification</h2>

      {loading && (
        <div className="h-32 flex items-center justify-center text-zinc-400 animate-pulse">Loading...</div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {!loading && !error && model && (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-emerald-700">Level</p>
                <p className="text-2xl font-bold text-emerald-800">{model.level}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-emerald-700">Reward Points</p>
                <p className="text-lg font-semibold text-emerald-800">
                  {model.totalPoints}
                </p>
              </div>
            </div>
            <div className="mt-2 h-2 rounded-full bg-emerald-200/80 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${Math.min(100, (model.pointsIntoLevel / model.pointsForNextLevel) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-emerald-700">
              {model.pointsRemaining} points to next level
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[11px] text-zinc-500">Study streak</p>
              <p className="font-semibold text-sm">{model.studyCurrentStreak} days</p>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[11px] text-zinc-500">Longest study streak</p>
              <p className="font-semibold text-sm">{model.studyLongestStreak} days</p>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[11px] text-zinc-500">Workout streak</p>
              <p className="font-semibold text-sm">{model.workoutCurrentStreak} days</p>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[11px] text-zinc-500">Unlocked badges</p>
              <p className="font-semibold text-sm">{model.unlockedBadgeCount}/{model.badges.length}</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-zinc-600 mb-2">Badges</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {model.badges.map((badge) => {
                const unlocked = badge.metric >= badge.target;
                const progress = Math.min(100, (badge.metric / badge.target) * 100);
                return (
                  <div
                    key={badge.id}
                    className={`rounded-md border px-3 py-2 ${
                      unlocked
                        ? "border-amber-300 bg-amber-50/70"
                        : "border-zinc-200 bg-zinc-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{badge.name}</p>
                      <span className="text-[11px] text-zinc-500">+{badge.points} pts</span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">{badge.description}</p>
                    <div className="mt-1 h-1.5 rounded-full bg-zinc-200 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${unlocked ? "bg-amber-500" : "bg-sky-500"}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {Math.min(badge.metric, badge.target)}/{badge.target}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-zinc-600 mb-2">Rewards</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {model.rewardTiers.map((reward) => {
                const unlocked = model.totalPoints >= reward.threshold;
                return (
                  <div
                    key={reward.threshold}
                    className={`rounded-md border px-3 py-2 ${
                      unlocked
                        ? "border-emerald-300 bg-emerald-50/70"
                        : "border-zinc-200 bg-zinc-50"
                    }`}
                  >
                    <p className="text-sm font-medium">{reward.title}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{reward.description}</p>
                    <p className="text-[11px] mt-1 text-zinc-500">
                      {unlocked ? "Unlocked" : `${reward.threshold - model.totalPoints} pts to unlock`}
                    </p>
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
