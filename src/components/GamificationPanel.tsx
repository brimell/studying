"use client";

import goalsConfig from "@/data/goals.json";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HabitCompletionDay, HabitDefinition, HabitTrackerData, WorkoutPlannerPayload } from "@/lib/types";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import LoadingIcon from "./LoadingIcon";

const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";
const STUDY_HABIT_STORAGE_KEY = "study-stats.habit-tracker.study-habit";
const GOALS_PROGRESS_SYNC_KEY = "study-stats.goals.progress.v1";

type GoalCategory = "streak" | "study" | "fitness" | "combined";
type GoalHabitType = "study" | "fitness" | "mixed";
type GoalMetric = "streak_days" | "count" | "minutes" | "hours" | "days" | "unique_days";

interface GoalRule {
  requiresSameDay?: boolean;
  requiredHabitTypes?: Array<"study" | "fitness">;
  requiresConcurrentStreaks?: boolean;
  minStreakDaysPerType?: number;
  minHabits?: number;
  minStreakDays?: number;
  requiresActiveHabitsInPeriod?: boolean;
  period?: "rolling_7_days" | "rolling_14_days";
  minActiveHabits?: number;
  requiresWeeklyTargetsMet?: boolean;
}

interface GoalDefinition {
  id: string;
  title: string;
  points: number;
  category: GoalCategory;
  habitType: GoalHabitType;
  metric: GoalMetric;
  target: number;
  description: string;
  rules?: GoalRule;
}

interface StoredGoalProgress {
  best: number;
  completedAt: string | null;
}

interface GoalProgressView extends GoalDefinition {
  current: number;
  best: number;
  completed: boolean;
  completedAt: string | null;
}

interface RewardTier {
  threshold: number;
  title: string;
  description: string;
}

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

function computeMaxRollingCount(dateKeys: string[], windowDays: number): number {
  if (dateKeys.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const key of dateKeys) {
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.keys()].sort();
  let maxCount = 0;
  for (const endDate of sorted) {
    const startDate = addDays(endDate, -(windowDays - 1));
    let running = 0;
    for (const [date, count] of counts.entries()) {
      if (date >= startDate && date <= endDate) running += count;
    }
    if (running > maxCount) maxCount = running;
  }
  return maxCount;
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

function parseStoredGoalProgress(raw: string | null): Record<string, StoredGoalProgress> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const goals = (parsed as { goals?: unknown }).goals;
    if (!goals || typeof goals !== "object" || Array.isArray(goals)) return {};
    const next: Record<string, StoredGoalProgress> = {};
    for (const [goalId, value] of Object.entries(goals as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const best = (value as { best?: unknown }).best;
      const completedAt = (value as { completedAt?: unknown }).completedAt;
      if (typeof best !== "number" || !Number.isFinite(best)) continue;
      if (completedAt !== null && typeof completedAt !== "string") continue;
      next[goalId] = {
        best,
        completedAt,
      };
    }
    return next;
  } catch {
    return {};
  }
}

function getCompletedDates(days: HabitCompletionDay[]): Set<string> {
  const dates = new Set<string>();
  for (const day of days) {
    if (day.completed) dates.add(day.date);
  }
  return dates;
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
  const lastSyncedSnapshotRef = useRef("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [habitData, setHabitData] = useState<HabitTrackerData | null>(null);
  const [workoutPayload, setWorkoutPayload] = useState<WorkoutPlannerPayload | null>(null);
  const [selectedStudyHabitSlug, setSelectedStudyHabitSlug] = useState<string | null>(null);
  const [storedProgressByGoalId, setStoredProgressByGoalId] = useState<Record<string, StoredGoalProgress>>({});

  const goals = useMemo(() => {
    return (goalsConfig.goals || []) as GoalDefinition[];
  }, []);

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
      let nextStoredProgressByGoalId: Record<string, StoredGoalProgress> = {};

      if (supabase) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          const [workoutResponse, syncResponse] = await Promise.all([
            fetch("/api/workout-planner", {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` },
            }),
            fetch("/api/account-sync", {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` },
            }),
          ]);

          if (workoutResponse.ok) {
            const workoutJson = (await workoutResponse.json()) as {
              payload?: WorkoutPlannerPayload;
            };
            nextWorkoutPayload = workoutJson.payload || null;
          }

          if (syncResponse.ok) {
            const syncJson = (await syncResponse.json()) as { payload?: Record<string, string> };
            nextStoredProgressByGoalId = parseStoredGoalProgress(
              syncJson.payload?.[GOALS_PROGRESS_SYNC_KEY] || null
            );
            lastSyncedSnapshotRef.current = syncJson.payload?.[GOALS_PROGRESS_SYNC_KEY] || "";
          }
        }
      }

      setWorkoutPayload(nextWorkoutPayload);
      setStoredProgressByGoalId(nextStoredProgressByGoalId);
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
    const studyTotalHours = studyHabit?.totalHours || 0;
    const studyTotalMinutes = Math.round(studyTotalHours * 60);
    const bestStudyHoursInDay = studyHabit
      ? Math.max(...studyHabit.days.map((day) => day.hours), 0)
      : 0;
    const estimatedStudySessionsInBestDay = Math.max(0, Math.round(bestStudyHoursInDay));

    const workoutLogDates = (workoutPayload?.logs || []).map((log) => log.performedOn);
    const uniqueWorkoutDays = [...new Set(workoutLogDates)].length;
    const workoutCurrentStreak = computeWorkoutStreak(workoutLogDates);
    const maxWorkoutLogsRollingWeek = computeMaxRollingCount(workoutLogDates, 7);
    const combinedStreak = computeCombinedStreakStats(habits);

    const endDate = habitData.trackerRange.endDate;
    const studyHoursLast7 = studyHabit
      ? studyHabit.days
          .filter((day) => day.date >= addDays(endDate, -6) && day.date <= endDate)
          .reduce((sum, day) => sum + day.hours, 0)
      : 0;
    const workoutCountLast7 = workoutLogDates.filter(
      (date) => date >= addDays(endDate, -6) && date <= endDate
    ).length;

    const workoutDateSet = new Set(workoutLogDates);
    const studyCompletedDates = studyHabit ? getCompletedDates(studyHabit.days) : new Set<string>();
    const hasStudyWorkoutSameDay = [...studyCompletedDates].some((date) => workoutDateSet.has(date));

    const goalsWithProgress: GoalProgressView[] = goals.map((goal) => {
      let current = 0;

      if (goal.category === "streak") {
        current = goal.habitType === "study" ? studyCurrentStreak : workoutCurrentStreak;
      } else if (goal.category === "study") {
        if (goal.metric === "days") current = studyTotalDays;
        if (goal.metric === "hours") current = studyTotalHours;
        if (goal.metric === "minutes") current = studyTotalMinutes;
        if (goal.metric === "count") current = estimatedStudySessionsInBestDay;
      } else if (goal.category === "fitness") {
        if (goal.metric === "count") {
          current = goal.id.includes("week") ? maxWorkoutLogsRollingWeek : workoutLogDates.length;
        }
        if (goal.metric === "unique_days") current = uniqueWorkoutDays;
        if (goal.metric === "minutes") current = 0;
      } else if (goal.category === "combined") {
        const rules = goal.rules || {};

        if (rules.requiresSameDay) {
          current = hasStudyWorkoutSameDay ? 1 : 0;
        } else if (rules.requiresConcurrentStreaks) {
          if (rules.requiredHabitTypes && rules.requiredHabitTypes.length > 0) {
            const minStreak = rules.minStreakDaysPerType || 1;
            const studyOk = !rules.requiredHabitTypes.includes("study") || studyCurrentStreak >= minStreak;
            const fitnessOk =
              !rules.requiredHabitTypes.includes("fitness") || workoutCurrentStreak >= minStreak;
            current = studyOk && fitnessOk ? 1 : 0;
          } else {
            const minHabits = rules.minHabits || 2;
            const minStreakDays = rules.minStreakDays || 1;
            const habitsAtTarget = habits.filter((habit) => habit.currentStreak >= minStreakDays).length;
            current = habitsAtTarget >= minHabits ? 1 : habitsAtTarget;
          }
        } else if (rules.requiresActiveHabitsInPeriod) {
          const periodDays = rules.period === "rolling_14_days" ? 14 : 7;
          const periodStart = addDays(endDate, -(periodDays - 1));
          const activeHabits = habits.filter((habit) =>
            habit.days.some((day) => day.completed && day.date >= periodStart && day.date <= endDate)
          ).length;
          current = activeHabits;
        } else if (rules.requiresWeeklyTargetsMet) {
          const weeklyStudyTargetHours = 10;
          const weeklyWorkoutTarget = 3;
          current = studyHoursLast7 >= weeklyStudyTargetHours && workoutCountLast7 >= weeklyWorkoutTarget ? 1 : 0;
        }
      }

      const stored = storedProgressByGoalId[goal.id];
      const best = Math.max(stored?.best || 0, current);
      const justCompleted = best >= goal.target;
      const completedAt = stored?.completedAt || (justCompleted ? new Date().toISOString() : null);

      return {
        ...goal,
        current,
        best,
        completed: justCompleted,
        completedAt,
      };
    });

    const unlockedGoals = goalsWithProgress.filter((goal) => goal.completed);
    const totalPoints = unlockedGoals.reduce((sum, goal) => sum + goal.points, 0);
    const level = Math.floor(totalPoints / 250) + 1;
    const levelFloor = (level - 1) * 250;
    const levelCeiling = level * 250;
    const pointsIntoLevel = totalPoints - levelFloor;
    const pointsForNextLevel = levelCeiling - levelFloor;
    const pointsRemaining = Math.max(0, levelCeiling - totalPoints);

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

    const progressForStorage: Record<string, StoredGoalProgress> = {};
    for (const goal of goalsWithProgress) {
      progressForStorage[goal.id] = {
        best: goal.best,
        completedAt: goal.completedAt,
      };
    }

    const progressSnapshot = JSON.stringify({
      schemaVersion: "1.0",
      updatedAt: habitData.trackerRange.endDate,
      goals: progressForStorage,
    });

    const goalsSorted = [...goalsWithProgress].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const aRatio = a.target > 0 ? a.best / a.target : 0;
      const bRatio = b.target > 0 ? b.best / b.target : 0;
      return bRatio - aRatio;
    });

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
      unlockedGoalCount: unlockedGoals.length,
      totalGoals: goalsWithProgress.length,
      totalPoints,
      level,
      pointsIntoLevel,
      pointsForNextLevel,
      pointsRemaining,
      goals: goalsSorted,
      rewardTiers,
      progressSnapshot,
    };
  }, [goals, habitData, selectedStudyHabitSlug, storedProgressByGoalId, workoutPayload]);

  useEffect(() => {
    if (!supabase || !model) return;
    const serialized = model.progressSnapshot;
    if (!serialized || serialized === lastSyncedSnapshotRef.current) return;

    let cancelled = false;

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token || cancelled) return;

        const readResponse = await fetch("/api/account-sync", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!readResponse.ok || cancelled) return;

        const readJson = (await readResponse.json()) as { payload?: Record<string, string> };
        const existing = readJson.payload || {};
        if (existing[GOALS_PROGRESS_SYNC_KEY] === serialized) {
          lastSyncedSnapshotRef.current = serialized;
          return;
        }

        const writeResponse = await fetch("/api/account-sync", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            payload: {
              ...existing,
              [GOALS_PROGRESS_SYNC_KEY]: serialized,
            },
          }),
        });

        if (!writeResponse.ok || cancelled) return;
        lastSyncedSnapshotRef.current = serialized;
      } catch {
        // Ignore sync errors and keep local progress as source of truth.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [model, supabase]);

  return (
    <div className="surface-card p-6">
      {loading && (
        <div className="h-32 flex items-center justify-center">
          <LoadingIcon />
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {!loading && !error && model && (
        <div className="space-y-4">
          <div className="rounded-xl border border-sky-300 bg-sky-50 p-4">
            <p className="text-xs uppercase tracking-[0.12em] text-sky-700">Combined streak</p>
            <div className="mt-2 flex items-end justify-between gap-4">
              <p className="stat-mono text-7xl md:text-8xl font-bold leading-none text-sky-900">
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

          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-emerald-700">Level</p>
                <p className="text-2xl font-bold text-emerald-800 stat-mono">{model.level}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-emerald-700">Goal Points</p>
                <p className="text-lg font-semibold text-emerald-800 stat-mono">{model.totalPoints}</p>
              </div>
            </div>
            <div className="mt-2 h-2 rounded-full bg-emerald-200/80 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${Math.min(100, (model.pointsIntoLevel / model.pointsForNextLevel) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-emerald-700">
              <span className="stat-mono">{model.pointsRemaining}</span> points to next level
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[11px] text-zinc-500">Study streak</p>
              <p className="font-semibold text-sm stat-mono">{model.studyCurrentStreak} days</p>
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

          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-[11px] text-zinc-500">Goals unlocked</p>
            <p className="font-semibold text-sm stat-mono">
              {model.unlockedGoalCount}/{model.totalGoals}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-zinc-600 mb-2">Goals</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[26rem] overflow-y-auto pr-1">
              {model.goals.map((goal) => {
                const progress = Math.min(100, (goal.best / goal.target) * 100);
                return (
                  <div
                    key={goal.id}
                    className={`rounded-md border px-3 py-2 ${
                      goal.completed ? "border-amber-300 bg-amber-50/70" : "border-zinc-200 bg-zinc-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{goal.title}</p>
                      <span className="text-[11px] text-zinc-500 stat-mono">+{goal.points} pts</span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">{goal.description}</p>
                    <div className="mt-1 h-1.5 rounded-full bg-zinc-200 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${goal.completed ? "bg-amber-500" : "bg-sky-500"}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-500 stat-mono">
                      {Math.min(goal.best, goal.target)}/{goal.target}
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
                      unlocked ? "border-emerald-300 bg-emerald-50/70" : "border-zinc-200 bg-zinc-50"
                    }`}
                  >
                    <p className="text-sm font-medium">{reward.title}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{reward.description}</p>
                    <p className="text-[11px] mt-1 text-zinc-500 stat-mono">
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
