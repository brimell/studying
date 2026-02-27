"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DailyStudyTimeData,
  HabitTrackerData,
  StudyDistributionData,
  TodayProgressData,
  WorkoutPlannerPayload,
} from "@/lib/types";
import {
  DAILY_TRACKER_ENTRIES_STORAGE_KEY,
  parseDailyTrackerEntries,
  type DailyTrackerEntry,
} from "@/lib/daily-tracker";
import { computeMuscleFatigue } from "@/lib/workouts";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { fetchJsonWithDedupe } from "@/lib/client-cache";
import LoadingIcon from "./LoadingIcon";

const STUDY_CALENDAR_IDS_STORAGE_KEY = "study-stats.study.calendar-ids";
const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";
const WEEKLY_STUDY_GOAL_HOURS = 20;
const MONTHLY_STUDY_GOAL_HOURS = 80;
const WEEKLY_ALL_HABITS_GOAL_DAYS = 5;
const MONTHLY_ALL_HABITS_GOAL_DAYS = 22;

interface AnalyticsState {
  today: TodayProgressData | null;
  daily: DailyStudyTimeData | null;
  distribution: StudyDistributionData | null;
  workoutPayload: WorkoutPlannerPayload | null;
  habitData: HabitTrackerData | null;
  dailyTrackerEntries: DailyTrackerEntry[];
}

interface DailyTrackerDaySignals {
  date: string;
  mood: number | null;
  sleep: number | null;
  fatigue: number | null;
  caffeineMg: number | null;
  alcohol: number | null;
  stressSignals: number;
}

interface AnomalyInsight {
  id: string;
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
  likelyCauses: string[];
}

interface GoalForecast {
  id: string;
  title: string;
  period: "Weekly" | "Monthly";
  target: number;
  predicted: number;
  confidenceLow: number;
  confidenceHigh: number;
  probability: number;
  unit: "hours" | "days";
}

function readStudyCalendarIds(): string[] {
  const raw = window.localStorage.getItem(STUDY_CALENDAR_IDS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
  } catch {
    return [];
  }
}

function readDailyTrackerEntries(): DailyTrackerEntry[] {
  return parseDailyTrackerEntries(window.localStorage.getItem(DAILY_TRACKER_ENTRIES_STORAGE_KEY));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function linearSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - xMean;
    numerator += dx * (values[i] - yMean);
    denominator += dx * dx;
  }
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function fatigueScore(payload: WorkoutPlannerPayload, at: Date): number {
  const map = computeMuscleFatigue(payload, at);
  return mean(Object.values(map));
}

function dayAtNoonFromNow(dayOffset: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date;
}

function toPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-absX * absX);
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function probabilityAtLeast(target: number, meanValue: number, stdDev: number): number {
  if (stdDev <= 1e-6) return meanValue >= target ? 1 : 0;
  const z = (target - meanValue) / stdDev;
  return Math.max(0, Math.min(1, 1 - normalCdf(z)));
}

function confidenceLabel(probability: number): string {
  if (probability >= 0.8) return "High";
  if (probability >= 0.6) return "Moderate";
  if (probability >= 0.4) return "Low";
  return "Very low";
}

function statusTone(probability: number): string {
  if (probability >= 0.65) return "text-emerald-700";
  if (probability >= 0.4) return "text-amber-700";
  return "text-rose-700";
}

function addDays(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function buildDailySignals(entries: DailyTrackerEntry[]): DailyTrackerDaySignals[] {
  const byDate = new Map<string, DailyTrackerEntry[]>();
  for (const entry of entries) {
    const existing = byDate.get(entry.date) || [];
    existing.push(entry);
    byDate.set(entry.date, existing);
  }

  return [...byDate.entries()]
    .map(([date, dayEntries]) => {
      const moods: number[] = [];
      const sleeps: number[] = [];
      const fatigues: number[] = [];
      const caffeine: number[] = [];
      const alcohol: number[] = [];
      let stressSignals = 0;

      for (const entry of dayEntries) {
        const form = entry.form;
        if (typeof form.moodRating === "number") moods.push(form.moodRating);
        if (typeof form.morningSleepRating === "number") sleeps.push(form.morningSleepRating);
        if (typeof form.fatigue === "number") fatigues.push(form.fatigue);
        if (typeof form.caffeineMg === "number") caffeine.push(form.caffeineMg);
        if (typeof form.alcohol === "number") alcohol.push(form.alcohol);
        if (
          form.emotions.some((emotion) =>
            ["stressed", "anxious", "sad", "depressed", "angry", "annoyed"].includes(
              emotion.toLowerCase()
            )
          )
        ) {
          stressSignals += 1;
        }
      }

      return {
        date,
        mood: moods.length > 0 ? mean(moods) : null,
        sleep: sleeps.length > 0 ? mean(sleeps) : null,
        fatigue: fatigues.length > 0 ? mean(fatigues) : null,
        caffeineMg: caffeine.length > 0 ? mean(caffeine) : null,
        alcohol: alcohol.length > 0 ? mean(alcohol) : null,
        stressSignals,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function inferLikelyCauses(
  signals: DailyTrackerDaySignals | null,
  studyHours: number | null
): string[] {
  if (!signals) return ["No matching daily tracker data found for this period."];
  const causes: string[] = [];

  if (signals.sleep !== null && signals.sleep <= 4) {
    causes.push("Low sleep rating may be driving recovery and mood volatility.");
  }
  if (signals.fatigue !== null && signals.fatigue >= 7) {
    causes.push("High fatigue self-rating suggests accumulated recovery debt.");
  }
  if (signals.caffeineMg !== null && signals.caffeineMg >= 150) {
    causes.push("High caffeine intake can increase stress load and later energy crashes.");
  }
  if (signals.alcohol !== null && signals.alcohol >= 5) {
    causes.push("Higher alcohol intake can reduce sleep quality and readiness next day.");
  }
  if (signals.stressSignals > 0) {
    causes.push("Logged stress-related emotions align with the anomaly window.");
  }
  if (studyHours !== null && studyHours >= 6) {
    causes.push("High study volume on the same day may have increased overall load.");
  }

  if (causes.length === 0) {
    causes.push("Likely multi-factor accumulation from sleep, stress, and workload shifts.");
  }

  return causes;
}

function detectAnomalies(
  signals: DailyTrackerDaySignals[],
  studyHoursByDate: Map<string, number>,
  habitData: HabitTrackerData | null
): AnomalyInsight[] {
  const results: AnomalyInsight[] = [];

  const fatigueSeries = signals.filter((entry) => entry.fatigue !== null);
  if (fatigueSeries.length >= 8) {
    const latest = fatigueSeries[fatigueSeries.length - 1];
    const baselineValues = fatigueSeries.slice(-8, -1).map((entry) => entry.fatigue as number);
    const baseline = mean(baselineValues);
    const latestFatigue = latest.fatigue as number;

    if (latestFatigue >= Math.max(7, baseline + 2)) {
      results.push({
        id: "fatigue-spike",
        title: "Sudden fatigue spike",
        detail: `Fatigue rose to ${latestFatigue.toFixed(1)}/10 vs recent baseline ${baseline.toFixed(
          1
        )}/10.`,
        severity: "high",
        likelyCauses: inferLikelyCauses(latest, studyHoursByDate.get(latest.date) || null),
      });
    }
  }

  const moodSeries = signals.filter((entry) => entry.mood !== null);
  if (moodSeries.length >= 10) {
    const latest = moodSeries[moodSeries.length - 1];
    const baselineValues = moodSeries.slice(-10, -1).map((entry) => entry.mood as number);
    const baseline = mean(baselineValues);
    const latestMood = latest.mood as number;
    if (latestMood <= Math.max(3, baseline - 1.5)) {
      results.push({
        id: "mood-dip",
        title: "Mood dip detected",
        detail: `Mood dropped to ${latestMood.toFixed(1)}/10 vs recent baseline ${baseline.toFixed(1)}/10.`,
        severity: latestMood <= 2 ? "high" : "medium",
        likelyCauses: inferLikelyCauses(latest, studyHoursByDate.get(latest.date) || null),
      });
    }
  }

  if (habitData && habitData.habits.length > 1) {
    const dateKeys = [...new Set(habitData.habits.flatMap((habit) => habit.days.map((day) => day.date)))].sort();
    const misses = dateKeys.map((date) => {
      const missedHabits = habitData.habits
        .filter((habit) => {
          const day = habit.days.find((entry) => entry.date === date);
          return day ? !day.completed : true;
        })
        .map((habit) => habit.name);
      return { date, missedHabits };
    });

    const recentMisses = misses.filter((entry) => entry.missedHabits.length >= 2).slice(-21);
    let bestCluster: { start: string; end: string; days: number; habits: Set<string> } | null = null;

    for (let i = 0; i < recentMisses.length; i += 1) {
      const start = recentMisses[i];
      let end = start;
      let days = 1;
      const habits = new Set(start.missedHabits);

      for (let j = i + 1; j < recentMisses.length; j += 1) {
        if (recentMisses[j].date !== addDays(end.date, 1)) break;
        end = recentMisses[j];
        days += 1;
        for (const habit of end.missedHabits) habits.add(habit);
      }

      if (!bestCluster || days > bestCluster.days) {
        bestCluster = {
          start: start.date,
          end: end.date,
          days,
          habits,
        };
      }
    }

    if (bestCluster && bestCluster.days >= 2) {
      const clusterSignal =
        signals.find((entry) => entry.date === bestCluster.end) ||
        signals.find((entry) => entry.date === bestCluster.start) ||
        null;
      results.push({
        id: "missed-streak-cluster",
        title: "Missed streak cluster",
        detail: `${bestCluster.days} consecutive days with multiple missed habits (${[
          ...bestCluster.habits,
        ]
          .slice(0, 3)
          .join(", ")}).`,
        severity: bestCluster.days >= 3 ? "high" : "medium",
        likelyCauses: inferLikelyCauses(
          clusterSignal,
          (clusterSignal && studyHoursByDate.get(clusterSignal.date)) || null
        ),
      });
    }
  }

  return results;
}

function forecastContinuousGoal(
  id: string,
  title: string,
  period: "Weekly" | "Monthly",
  target: number,
  unit: "hours" | "days",
  dailyMean: number,
  dailyStdDev: number,
  periodDays: number
): GoalForecast {
  const predicted = dailyMean * periodDays;
  const totalStdDev = dailyStdDev * Math.sqrt(periodDays);
  const margin = 1.96 * totalStdDev;
  const confidenceLow = Math.max(0, predicted - margin);
  const confidenceHigh = Math.max(0, predicted + margin);
  const probability = probabilityAtLeast(target, predicted, totalStdDev);

  return {
    id,
    title,
    period,
    target,
    predicted,
    confidenceLow,
    confidenceHigh,
    probability,
    unit,
  };
}

function buildGoalForecasts(
  daily: DailyStudyTimeData,
  habitData: HabitTrackerData | null
): GoalForecast[] {
  const studyDailyValues = daily.entries.slice(-42).map((entry) => entry.hours);
  const studyDailyMean = mean(studyDailyValues);
  const studyDailyStdDev = standardDeviation(studyDailyValues);

  const forecasts: GoalForecast[] = [
    forecastContinuousGoal(
      "study-weekly",
      "Study hours",
      "Weekly",
      WEEKLY_STUDY_GOAL_HOURS,
      "hours",
      studyDailyMean,
      studyDailyStdDev,
      7
    ),
    forecastContinuousGoal(
      "study-monthly",
      "Study hours",
      "Monthly",
      MONTHLY_STUDY_GOAL_HOURS,
      "hours",
      studyDailyMean,
      studyDailyStdDev,
      30
    ),
  ];

  if (habitData && habitData.habits.length > 0) {
    const dateKeys = [...new Set(habitData.habits.flatMap((habit) => habit.days.map((day) => day.date)))].sort();
    const recentDates = dateKeys.slice(-56);
    const allHabitCompleteByDay = recentDates.map((date) => {
      const allComplete = habitData.habits.every((habit) => {
        const day = habit.days.find((entry) => entry.date === date);
        return Boolean(day?.completed);
      });
      return allComplete ? 1 : 0;
    });

    const completionRate = mean(allHabitCompleteByDay);
    const dailyStdDev = Math.sqrt(Math.max(0, completionRate * (1 - completionRate)));

    forecasts.push(
      forecastContinuousGoal(
        "habits-weekly",
        "All habits completed days",
        "Weekly",
        WEEKLY_ALL_HABITS_GOAL_DAYS,
        "days",
        completionRate,
        dailyStdDev,
        7
      )
    );
    forecasts.push(
      forecastContinuousGoal(
        "habits-monthly",
        "All habits completed days",
        "Monthly",
        MONTHLY_ALL_HABITS_GOAL_DAYS,
        "days",
        completionRate,
        dailyStdDev,
        30
      )
    );
  }

  return forecasts;
}

export default function AdvancedAnalytics() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<AnalyticsState>({
    today: null,
    daily: null,
    distribution: null,
    workoutPayload: null,
    habitData: null,
    dailyTrackerEntries: [],
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const calendarIds = readStudyCalendarIds();
      const baseParams = new URLSearchParams();
      if (calendarIds.length > 0) {
        baseParams.set("calendarIds", calendarIds.join(","));
      }
      const dailyParams = new URLSearchParams(baseParams);
      dailyParams.set("days", "60");
      const distributionParams = new URLSearchParams(baseParams);
      distributionParams.set("days", "120");

      const todayQuery = baseParams.toString();
      const dailyQuery = dailyParams.toString();
      const distributionQuery = distributionParams.toString();

      const [todayJson, dailyJson, distributionJson] = await Promise.all([
        fetchJsonWithDedupe<TodayProgressData>(
          `api:today-progress:${todayQuery || "default"}`,
          async () => {
            const res = await fetch(
              `/api/today-progress${todayQuery ? `?${todayQuery}` : ""}`
            );
            const payload = (await res.json()) as TodayProgressData | { error?: string };
            if (!res.ok) {
              throw new Error(
                ("error" in payload && payload.error) || "Failed today progress."
              );
            }
            return payload as TodayProgressData;
          }
        ),
        fetchJsonWithDedupe<DailyStudyTimeData>(
          `api:daily-study-time:${dailyQuery}`,
          async () => {
            const res = await fetch(`/api/daily-study-time?${dailyQuery}`);
            const payload = (await res.json()) as DailyStudyTimeData | { error?: string };
            if (!res.ok) {
              throw new Error(("error" in payload && payload.error) || "Failed daily trend.");
            }
            return payload as DailyStudyTimeData;
          }
        ),
        fetchJsonWithDedupe<StudyDistributionData>(
          `api:distribution:${distributionQuery}`,
          async () => {
            const res = await fetch(`/api/distribution?${distributionQuery}`);
            const payload = (await res.json()) as StudyDistributionData | { error?: string };
            if (!res.ok) {
              throw new Error(
                ("error" in payload && payload.error) || "Failed subject distribution."
              );
            }
            return payload as StudyDistributionData;
          }
        ),
      ]);

      let workoutPayload: WorkoutPlannerPayload | null = null;
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          const workoutRes = await fetch("/api/workout-planner", {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          });
          const workoutJson = (await workoutRes.json()) as {
            payload?: WorkoutPlannerPayload;
          };
          if (workoutRes.ok) {
            workoutPayload = workoutJson.payload || null;
          }
        }
      }

      let habitData: HabitTrackerData | null = null;
      try {
        const trackerCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
        const params = new URLSearchParams({ weeks: "16" });
        if (trackerCalendarId) params.set("trackerCalendarId", trackerCalendarId);
        const habitRes = await fetch(`/api/habit-tracker?${params.toString()}`);
        const habitJson = (await habitRes.json()) as HabitTrackerData | { error?: string };
        if (habitRes.ok) {
          habitData = habitJson as HabitTrackerData;
        }
      } catch {
        // Non-fatal for advanced analytics.
      }

      setState({
        today: todayJson as TodayProgressData,
        daily: dailyJson as DailyStudyTimeData,
        distribution: distributionJson as StudyDistributionData,
        workoutPayload,
        habitData,
        dailyTrackerEntries: readDailyTrackerEntries(),
      });
    } catch (fetchError: unknown) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load advanced analytics.");
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
    window.addEventListener("study-stats:study-calendars-updated", onRefresh);
    window.addEventListener("study-stats:daily-tracker-updated", onRefresh);
    return () => {
      window.removeEventListener("study-stats:refresh-all", onRefresh);
      window.removeEventListener("study-stats:study-calendars-updated", onRefresh);
      window.removeEventListener("study-stats:daily-tracker-updated", onRefresh);
    };
  }, [fetchData]);

  const analytics = useMemo(() => {
    if (!state.today || !state.daily || !state.distribution) return null;
    const today = state.today;
    const daily = state.daily;
    const distribution = state.distribution;

    const recentHours = daily.entries.slice(-14).map((entry) => entry.hours);
    const previousHours = daily.entries.slice(-28, -14).map((entry) => entry.hours);
    const recentAvg = mean(recentHours);
    const previousAvg = mean(previousHours);
    const trendSlope = linearSlope(daily.entries.slice(-21).map((entry) => entry.hours));
    const nextWeekPrediction = Math.max(0, recentAvg * 7 + trendSlope * 21);

    const efficiencyRatio =
      today.totalPlanned > 0 ? (today.totalCompleted / today.totalPlanned) * 100 : 0;
    const productiveDays = daily.entries.filter((entry) => entry.hours >= daily.averageWeek).length;
    const productiveRatio =
      daily.entries.length > 0 ? (productiveDays / daily.entries.length) * 100 : 0;

    const subjectPairs = [...distribution.subjectTimes]
      .filter((entry) => entry.hours > 0)
      .sort((left, right) => right.hours - left.hours);
    const topSubject = subjectPairs[0] || null;
    const topShare =
      topSubject && distribution.totalHours > 0
        ? (topSubject.hours / distribution.totalHours) * 100
        : 0;
    const balanceScore = Math.max(0, 100 - topShare);

    let fatigueNow: number | null = null;
    let fatigueTrend: number | null = null;
    let recoveryDays: number | null = null;
    if (state.workoutPayload) {
      const recentFatigueSeries = Array.from({ length: 14 }, (_, index) =>
        fatigueScore(state.workoutPayload as WorkoutPlannerPayload, dayAtNoonFromNow(index - 13))
      );
      fatigueNow = recentFatigueSeries[recentFatigueSeries.length - 1] || 0;
      fatigueTrend = linearSlope(recentFatigueSeries.slice(-7));

      for (let day = 1; day <= 14; day += 1) {
        const projected = fatigueScore(state.workoutPayload, dayAtNoonFromNow(day));
        if (projected <= 30) {
          recoveryDays = day;
          break;
        }
      }
    }

    const dailySignals = buildDailySignals(state.dailyTrackerEntries);
    const studyHoursByDate = new Map(daily.entries.map((entry) => [entry.date, entry.hours]));
    const anomalies = detectAnomalies(dailySignals, studyHoursByDate, state.habitData);
    const goalForecasts = buildGoalForecasts(daily, state.habitData);

    return {
      recentAvg,
      previousAvg,
      trendSlope,
      nextWeekPrediction,
      efficiencyRatio,
      productiveRatio,
      topSubject,
      topShare,
      balanceScore,
      fatigueNow,
      fatigueTrend,
      recoveryDays,
      anomalies,
      goalForecasts,
    };
  }, [state]);

  return (
    <div className="surface-card p-6">
      {loading && (
        <div className="h-32 flex items-center justify-center">
          <LoadingIcon />
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!loading && !error && analytics && (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3">
              <p className="text-zinc-500">Study Efficiency</p>
              <p className="text-xl font-semibold mt-1 stat-mono">{toPercent(analytics.efficiencyRatio)}</p>
              <p className="text-xs text-zinc-500 mt-1">
                Productive-day ratio: <span className="stat-mono">{toPercent(analytics.productiveRatio)}</span>
              </p>
            </div>
            <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3">
              <p className="text-zinc-500">Study Trend</p>
              <p className="text-xl font-semibold mt-1 stat-mono">{analytics.recentAvg.toFixed(1)}h/day</p>
              <p className="text-xs text-zinc-500 mt-1">
                Vs previous: <span className="stat-mono">{(analytics.recentAvg - analytics.previousAvg).toFixed(1)}h/day</span>
              </p>
            </div>
            <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3">
              <p className="text-zinc-500">Next 7-Day Prediction</p>
              <p className="text-xl font-semibold mt-1 stat-mono">{analytics.nextWeekPrediction.toFixed(1)}h</p>
              <p className="text-xs text-zinc-500 mt-1">
                Daily trend slope: <span className="stat-mono">{analytics.trendSlope.toFixed(2)}h/day</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3">
              <p className="text-zinc-500">Subject Mastery Signal</p>
              <p className="font-semibold mt-1">
                {analytics.topSubject
                  ? `${analytics.topSubject.subject} (${analytics.topSubject.hours.toFixed(1)}h)`
                  : "No subject data"}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                Concentration: <span className="stat-mono">{toPercent(analytics.topShare)}</span> • Balance score:{" "}
                <span className="stat-mono">{toPercent(analytics.balanceScore)}</span>
              </p>
            </div>
            <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3">
              <p className="text-zinc-500">Fatigue Analysis</p>
              {analytics.fatigueNow === null ? (
                <p className="text-xs text-zinc-500 mt-1">
                  Sign in to Supabase (`☁️ Account Sync`) to include workout fatigue predictions.
                </p>
              ) : (
                <>
                  <p className="font-semibold mt-1">
                    Current mean fatigue: <span className="stat-mono">{analytics.fatigueNow.toFixed(1)}%</span>
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    7-day fatigue trend: <span className="stat-mono">{(analytics.fatigueTrend || 0).toFixed(2)}%/day</span>
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    Recovery to sub-30%:{" "}
                    <span className="stat-mono">{analytics.recoveryDays ? `${analytics.recoveryDays} day(s)` : "beyond 14 days"}</span>
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 space-y-2">
            <p className="font-semibold">Habit anomaly detection</p>
            {analytics.anomalies.length === 0 && (
              <p className="text-xs text-zinc-500">No major anomalies detected in recent logs.</p>
            )}
            {analytics.anomalies.length > 0 && (
              <div className="space-y-2">
                {analytics.anomalies.map((anomaly) => (
                  <div key={anomaly.id} className="rounded-md border border-zinc-200 bg-white px-3 py-2">
                    <p className="font-medium">{anomaly.title}</p>
                    <p className="text-xs text-zinc-600 mt-0.5">{anomaly.detail}</p>
                    <p className="text-xs mt-1">
                      Severity: <span className="stat-mono uppercase">{anomaly.severity}</span>
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {anomaly.likelyCauses.slice(0, 3).map((cause) => (
                        <li key={`${anomaly.id}-${cause}`} className="text-xs text-zinc-500">
                          • {cause}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 space-y-2">
            <p className="font-semibold">Goal forecasting</p>
            <p className="text-xs text-zinc-500">
              Forecasts use recent trend variability and show 95% confidence ranges.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {analytics.goalForecasts.map((forecast) => (
                <div key={forecast.id} className="rounded-md border border-zinc-200 bg-white px-3 py-2">
                  <p className="text-sm font-medium">{forecast.period} {forecast.title}</p>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    Target: <span className="stat-mono">{forecast.target.toFixed(0)} {forecast.unit}</span>
                  </p>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    Predicted: <span className="stat-mono">{forecast.predicted.toFixed(1)} {forecast.unit}</span>
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    95% range: <span className="stat-mono">{forecast.confidenceLow.toFixed(1)} - {forecast.confidenceHigh.toFixed(1)} {forecast.unit}</span>
                  </p>
                  <p className={`text-xs mt-1 ${statusTone(forecast.probability)}`}>
                    Hit probability: <span className="stat-mono">{toPercent(forecast.probability * 100)}</span> ({confidenceLabel(forecast.probability)} confidence)
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
