"use client";

import { useEffect, useMemo, useState } from "react";
import FancyDropdown from "@/components/FancyDropdown";
import {
  DAILY_TRACKER_ENTRIES_STORAGE_KEY,
  parseDailyTrackerEntries,
  type DailyTrackerEntry,
} from "@/lib/daily-tracker";
import type { DailyStudyTimeData } from "@/lib/types";

const MIN_DAYS_FOR_CORRELATION = 7;
const MIN_ABS_CORRELATION = 0.3;
const MAX_RESULTS = 16;
const STUDY_CALENDAR_IDS_STORAGE_KEY = "study-stats.study.calendar-ids";

type MetricKey =
  | "sleep"
  | "caffeine"
  | "mood"
  | "productivity"
  | "studyTime"
  | "motivation"
  | "alcohol"
  | "fatigue"
  | "headache"
  | "coughing";

const METRIC_LABELS: Record<MetricKey, string> = {
  sleep: "Sleep",
  caffeine: "Caffeine (mg)",
  mood: "Mood",
  productivity: "Productivity",
  studyTime: "Study Time (h)",
  motivation: "Motivation",
  alcohol: "Alcohol",
  fatigue: "Fatigue",
  headache: "Headache",
  coughing: "Coughing",
};

const TRACKER_UPDATED_EVENTS = [
  "study-stats:daily-tracker-updated",
  "study-stats:refresh-all",
  "study-stats:settings-updated",
  "study-stats:study-calendars-updated",
] as const;

interface DayAggregate {
  date: string;
  metrics: Partial<Record<MetricKey, number>>;
}

interface PairCorrelation {
  x: MetricKey;
  y: MetricKey;
  correlation: number;
  sampleSize: number;
  pValue: number | null;
  confidenceLower: number | null;
  confidenceUpper: number | null;
  xAverage: number;
  yAverage: number;
}

function readStudyCalendarIds(): string[] {
  const stored = window.localStorage.getItem(STUDY_CALENDAR_IDS_STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  } catch {
    return [];
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function pearsonCorrelation(xValues: number[], yValues: number[]): number | null {
  if (xValues.length !== yValues.length || xValues.length < MIN_DAYS_FOR_CORRELATION) return null;

  const n = xValues.length;
  const meanX = xValues.reduce((sum, value) => sum + value, 0) / n;
  const meanY = yValues.reduce((sum, value) => sum + value, 0) / n;

  let numerator = 0;
  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < n; i += 1) {
    const dx = xValues[i] - meanX;
    const dy = yValues[i] - meanY;
    numerator += dx * dy;
    sumX += dx * dx;
    sumY += dy * dy;
  }

  if (sumX === 0 || sumY === 0) return null;
  return numerator / Math.sqrt(sumX * sumY);
}

function computePValueFromCorrelation(correlation: number, sampleSize: number): number | null {
  if (!Number.isFinite(correlation)) return null;
  if (sampleSize <= 3) return null;

  const safeR = Math.max(-0.999999, Math.min(0.999999, correlation));
  const fisherZ = 0.5 * Math.log((1 + safeR) / (1 - safeR));
  const zScore = Math.abs(fisherZ) * Math.sqrt(sampleSize - 3);
  const pValue = 2 * (1 - normalCdf(zScore));
  return Math.max(0, Math.min(1, pValue));
}

function computeCorrelationCI(
  correlation: number,
  sampleSize: number,
  zCritical = 1.96
): { lower: number; upper: number } | null {
  if (sampleSize <= 3) return null;
  const safeR = Math.max(-0.999999, Math.min(0.999999, correlation));
  const fisherZ = 0.5 * Math.log((1 + safeR) / (1 - safeR));
  const standardError = 1 / Math.sqrt(sampleSize - 3);
  const lowerZ = fisherZ - zCritical * standardError;
  const upperZ = fisherZ + zCritical * standardError;
  const lower = Math.tanh(lowerZ);
  const upper = Math.tanh(upperZ);
  return { lower, upper };
}

function confidenceLabel(pValue: number | null): string {
  if (pValue === null) return "Insufficient";
  if (pValue < 0.01) return "Very high";
  if (pValue < 0.05) return "High";
  if (pValue < 0.1) return "Moderate";
  return "Low";
}

function effectLabel(correlation: number): string {
  const absR = Math.abs(correlation);
  if (absR >= 0.7) return "very strong";
  if (absR >= 0.5) return "strong";
  if (absR >= 0.3) return "moderate";
  return "weak";
}

function extractDayAggregates(
  entries: DailyTrackerEntry[],
  studyHoursByDate: Map<string, number>
): DayAggregate[] {
  const byDay = new Map<string, DailyTrackerEntry[]>();
  for (const entry of entries) {
    const existing = byDay.get(entry.date) || [];
    existing.push(entry);
    byDay.set(entry.date, existing);
  }

  return [...byDay.entries()]
    .map(([date, dayEntries]) => {
      const moodValues: number[] = [];
      const productivityValues: number[] = [];
      const motivationValues: number[] = [];
      const sleepValues: number[] = [];
      const fatigueValues: number[] = [];
      const headacheValues: number[] = [];
      const coughingValues: number[] = [];
      const caffeineValues: number[] = [];
      const alcoholValues: number[] = [];

      for (const entry of dayEntries) {
        const form = entry.form;
        if (typeof form.moodRating === "number") moodValues.push(form.moodRating);
        if (typeof form.productivity === "number") productivityValues.push(form.productivity);
        if (typeof form.motivation === "number") motivationValues.push(form.motivation);
        if (typeof form.morningSleepRating === "number") sleepValues.push(form.morningSleepRating);
        if (typeof form.fatigue === "number") fatigueValues.push(form.fatigue);
        if (typeof form.headache === "number") headacheValues.push(form.headache);
        if (typeof form.coughing === "number") coughingValues.push(form.coughing);
        if (typeof form.caffeineMg === "number") caffeineValues.push(form.caffeineMg);
        if (typeof form.alcohol === "number") alcoholValues.push(form.alcohol);
      }

      const metrics: Partial<Record<MetricKey, number>> = {};

      const moodAvg = average(moodValues);
      const productivityAvg = average(productivityValues);
      const motivationAvg = average(motivationValues);
      const sleepAvg = average(sleepValues);
      const fatigueAvg = average(fatigueValues);
      const headacheAvg = average(headacheValues);
      const coughingAvg = average(coughingValues);
      const caffeineAvg = average(caffeineValues);
      const alcoholAvg = average(alcoholValues);

      if (moodAvg !== null) metrics.mood = moodAvg;
      if (productivityAvg !== null) metrics.productivity = productivityAvg;
      if (motivationAvg !== null) metrics.motivation = motivationAvg;
      if (sleepAvg !== null) metrics.sleep = sleepAvg;
      if (fatigueAvg !== null) metrics.fatigue = fatigueAvg;
      if (headacheAvg !== null) metrics.headache = headacheAvg;
      if (coughingAvg !== null) metrics.coughing = coughingAvg;
      if (caffeineAvg !== null) metrics.caffeine = caffeineAvg;
      if (alcoholAvg !== null) metrics.alcohol = alcoholAvg;

      const studyHours = studyHoursByDate.get(date);
      if (typeof studyHours === "number") {
        metrics.studyTime = studyHours;
      }

      return { date, metrics };
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

function computePairCorrelation(
  dayData: DayAggregate[],
  xMetric: MetricKey,
  yMetric: MetricKey
): PairCorrelation | null {
  if (xMetric === yMetric) return null;

  const xValues: number[] = [];
  const yValues: number[] = [];

  for (const day of dayData) {
    const xValue = day.metrics[xMetric];
    const yValue = day.metrics[yMetric];
    if (typeof xValue !== "number" || typeof yValue !== "number") continue;
    xValues.push(xValue);
    yValues.push(yValue);
  }

  const correlation = pearsonCorrelation(xValues, yValues);
  if (correlation === null) return null;

  const sampleSize = xValues.length;
  const pValue = computePValueFromCorrelation(correlation, sampleSize);
  const interval = computeCorrelationCI(correlation, sampleSize);

  return {
    x: xMetric,
    y: yMetric,
    correlation,
    sampleSize,
    pValue,
    confidenceLower: interval?.lower ?? null,
    confidenceUpper: interval?.upper ?? null,
    xAverage: average(xValues) ?? 0,
    yAverage: average(yValues) ?? 0,
  };
}

function computeDetectedCorrelations(dayData: DayAggregate[]): PairCorrelation[] {
  const keys = Object.keys(METRIC_LABELS) as MetricKey[];
  const results: PairCorrelation[] = [];

  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const xMetric = keys[i];
      const yMetric = keys[j];
      const result = computePairCorrelation(dayData, xMetric, yMetric);
      if (!result) continue;
      if (Math.abs(result.correlation) < MIN_ABS_CORRELATION) continue;
      if (result.pValue !== null && result.pValue >= 0.1) continue;
      results.push(result);
    }
  }

  return results
    .sort((left, right) => Math.abs(right.correlation) - Math.abs(left.correlation))
    .slice(0, MAX_RESULTS);
}

export default function DailyTrackerCorrelations() {
  const [entries, setEntries] = useState<DailyTrackerEntry[]>([]);
  const [studyHoursByDate, setStudyHoursByDate] = useState<Map<string, number>>(new Map());
  const [xMetric, setXMetric] = useState<MetricKey>("sleep");
  const [yMetric, setYMetric] = useState<MetricKey>("mood");

  useEffect(() => {
    const loadEntries = () => {
      const raw = window.localStorage.getItem(DAILY_TRACKER_ENTRIES_STORAGE_KEY);
      setEntries(parseDailyTrackerEntries(raw));
    };

    const loadStudyTime = async () => {
      const params = new URLSearchParams({ days: "180" });
      const calendarIds = readStudyCalendarIds();
      if (calendarIds.length > 0) params.set("calendarIds", calendarIds.join(","));

      try {
        const response = await fetch(`/api/daily-study-time?${params.toString()}`);
        const payload = (await response.json()) as DailyStudyTimeData | { error?: string };
        if (!response.ok) {
          setStudyHoursByDate(new Map());
          return;
        }

        const map = new Map<string, number>();
        for (const entry of (payload as DailyStudyTimeData).entries) {
          if (typeof entry.hours !== "number") continue;
          map.set(entry.date, entry.hours);
        }
        setStudyHoursByDate(map);
      } catch {
        setStudyHoursByDate(new Map());
      }
    };

    const loadAll = () => {
      loadEntries();
      void loadStudyTime();
    };

    loadAll();
    window.addEventListener("storage", loadAll);
    TRACKER_UPDATED_EVENTS.forEach((eventName) => window.addEventListener(eventName, loadAll));

    return () => {
      window.removeEventListener("storage", loadAll);
      TRACKER_UPDATED_EVENTS.forEach((eventName) => window.removeEventListener(eventName, loadAll));
    };
  }, []);

  const dayData = useMemo(() => extractDayAggregates(entries, studyHoursByDate), [entries, studyHoursByDate]);
  const pairCorrelation = useMemo(
    () => computePairCorrelation(dayData, xMetric, yMetric),
    [dayData, xMetric, yMetric]
  );
  const detectedCorrelations = useMemo(() => computeDetectedCorrelations(dayData), [dayData]);

  return (
    <div className="surface-card p-6 space-y-3">
      <h2 className="text-lg font-semibold">Correlation Explorer</h2>
      <p className="text-xs text-zinc-500">
        Choose any two tracked variables and review Pearson correlation, significance, and confidence.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FancyDropdown
          value={xMetric}
          onChange={(value) => setXMetric(value as MetricKey)}
          options={(Object.keys(METRIC_LABELS) as MetricKey[]).map((key) => ({
            value: key,
            label: METRIC_LABELS[key],
          }))}
          ariaLabel="Select first variable"
        />
        <FancyDropdown
          value={yMetric}
          onChange={(value) => setYMetric(value as MetricKey)}
          options={(Object.keys(METRIC_LABELS) as MetricKey[]).map((key) => ({
            value: key,
            label: METRIC_LABELS[key],
          }))}
          ariaLabel="Select second variable"
        />
      </div>

      {xMetric === yMetric && (
        <p className="text-sm text-zinc-500">Choose two different variables to compute a correlation.</p>
      )}

      {xMetric !== yMetric && !pairCorrelation && (
        <p className="text-sm text-zinc-500">
          Not enough overlapping data points. Need at least {MIN_DAYS_FOR_CORRELATION} days where both variables are logged.
        </p>
      )}

      {pairCorrelation && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 space-y-1">
          <p className="text-sm font-medium">
            {METRIC_LABELS[pairCorrelation.x]} vs {METRIC_LABELS[pairCorrelation.y]}
          </p>
          <p className="text-xs text-zinc-600">
            r={pairCorrelation.correlation.toFixed(2)} ({pairCorrelation.correlation > 0 ? "positive" : "negative"}, {effectLabel(pairCorrelation.correlation)}) • n={pairCorrelation.sampleSize}
          </p>
          <p className="text-xs text-zinc-600">
            p={pairCorrelation.pValue !== null ? pairCorrelation.pValue.toFixed(4) : "N/A"} • Confidence: {confidenceLabel(pairCorrelation.pValue)}
          </p>
          <p className="text-xs text-zinc-500">
            95% CI: {pairCorrelation.confidenceLower !== null ? pairCorrelation.confidenceLower.toFixed(2) : "N/A"} to {pairCorrelation.confidenceUpper !== null ? pairCorrelation.confidenceUpper.toFixed(2) : "N/A"}
          </p>
          <p className="text-xs text-zinc-500">
            Averages: {METRIC_LABELS[pairCorrelation.x]}={pairCorrelation.xAverage.toFixed(2)} • {METRIC_LABELS[pairCorrelation.y]}={pairCorrelation.yAverage.toFixed(2)}
          </p>
        </div>
      )}

      <div className="pt-1">
        <p className="text-sm font-medium mb-2">Detected correlations</p>
        <p className="text-xs text-zinc-500 mb-2">
          Showing pairs with |r| ≥ {MIN_ABS_CORRELATION.toFixed(1)} and p &lt; 0.10.
        </p>

        {dayData.length < MIN_DAYS_FOR_CORRELATION && (
          <p className="text-sm text-zinc-500">
            Add at least {MIN_DAYS_FOR_CORRELATION} days of tracker logs to compute correlations.
          </p>
        )}

        {dayData.length >= MIN_DAYS_FOR_CORRELATION && detectedCorrelations.length === 0 && (
          <p className="text-sm text-zinc-500">No significant correlations found yet.</p>
        )}

        {detectedCorrelations.length > 0 && (
          <div className="space-y-2">
            {detectedCorrelations.map((result, index) => (
              <div
                key={`${result.x}-${result.y}-${index}`}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
              >
                <p className="text-sm font-medium">
                  {METRIC_LABELS[result.x]} vs {METRIC_LABELS[result.y]}
                </p>
                <p className="text-xs text-zinc-600 mt-0.5">
                  r={result.correlation.toFixed(2)} • p={result.pValue !== null ? result.pValue.toFixed(4) : "N/A"} • n={result.sampleSize}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Confidence: {confidenceLabel(result.pValue)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
