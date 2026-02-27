"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DailyStudyTimeData,
  StudyDistributionData,
  TodayProgressData,
  WorkoutPlannerPayload,
} from "@/lib/types";
import { computeMuscleFatigue } from "@/lib/workouts";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import LoadingIcon from "./LoadingIcon";

const STUDY_CALENDAR_IDS_STORAGE_KEY = "study-stats.study.calendar-ids";

interface AnalyticsState {
  today: TodayProgressData | null;
  daily: DailyStudyTimeData | null;
  distribution: StudyDistributionData | null;
  workoutPayload: WorkoutPlannerPayload | null;
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

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
  const values = Object.values(map);
  return mean(values);
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

export default function AdvancedAnalytics() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<AnalyticsState>({
    today: null,
    daily: null,
    distribution: null,
    workoutPayload: null,
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

      const [todayRes, dailyRes, distributionRes] = await Promise.all([
        fetch(`/api/today-progress${baseParams.toString() ? `?${baseParams.toString()}` : ""}`),
        fetch(`/api/daily-study-time?${dailyParams.toString()}`),
        fetch(`/api/distribution?${distributionParams.toString()}`),
      ]);

      const todayJson = (await todayRes.json()) as TodayProgressData | { error?: string };
      const dailyJson = (await dailyRes.json()) as DailyStudyTimeData | { error?: string };
      const distributionJson = (await distributionRes.json()) as StudyDistributionData | { error?: string };

      if (!todayRes.ok) throw new Error(("error" in todayJson && todayJson.error) || "Failed today progress.");
      if (!dailyRes.ok) throw new Error(("error" in dailyJson && dailyJson.error) || "Failed daily trend.");
      if (!distributionRes.ok) {
        throw new Error(
          ("error" in distributionJson && distributionJson.error) || "Failed subject distribution."
        );
      }

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
            error?: string;
          };
          if (workoutRes.ok) {
            workoutPayload = workoutJson.payload || null;
          }
        }
      }

      setState({
        today: todayJson as TodayProgressData,
        daily: dailyJson as DailyStudyTimeData,
        distribution: distributionJson as StudyDistributionData,
        workoutPayload,
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
    return () => {
      window.removeEventListener("study-stats:refresh-all", onRefresh);
      window.removeEventListener("study-stats:study-calendars-updated", onRefresh);
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
    const topShare = topSubject && distribution.totalHours > 0
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

      // Prediction assumes no additional workouts are logged.
      for (let day = 1; day <= 14; day += 1) {
        const projected = fatigueScore(state.workoutPayload, dayAtNoonFromNow(day));
        if (projected <= 30) {
          recoveryDays = day;
          break;
        }
      }
    }

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
              <p className="text-xl font-semibold mt-1 stat-mono">
                {analytics.recentAvg.toFixed(1)}h/day
              </p>
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
                  <p className="font-semibold mt-1">Current mean fatigue: <span className="stat-mono">{analytics.fatigueNow.toFixed(1)}%</span></p>
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
        </div>
      )}
    </div>
  );
}
