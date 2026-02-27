"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DAILY_TRACKER_ENTRIES_STORAGE_KEY,
  parseDailyTrackerEntries,
  type DailyTrackerEntry,
} from "@/lib/daily-tracker";

const MIN_DAYS_FOR_CORRELATION = 7;
const MIN_ABS_CORRELATION = 0.3;
const MAX_RESULTS = 16;

const TRACKER_UPDATED_EVENTS = [
  "study-stats:daily-tracker-updated",
  "study-stats:refresh-all",
  "study-stats:settings-updated",
] as const;

type MetricKey =
  | "mood"
  | "productivity"
  | "motivation"
  | "sleep"
  | "fatigue"
  | "headache"
  | "coughing";

const METRIC_LABELS: Record<MetricKey, string> = {
  mood: "Mood",
  productivity: "Productivity",
  motivation: "Motivation",
  sleep: "Sleep",
  fatigue: "Fatigue",
  headache: "Headache",
  coughing: "Coughing",
};

interface DayAggregate {
  date: string;
  features: Set<string>;
  metrics: Partial<Record<MetricKey, number>>;
}

interface CorrelationResult {
  feature: string;
  metric: MetricKey;
  correlation: number;
  sampleSize: number;
  presentCount: number;
  absentCount: number;
  presentAverage: number;
  absentAverage: number;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatFeatureLabel(feature: string): string {
  const [group, value] = feature.split("::");
  if (!group || !value) return feature;
  const groupLabel = group
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return `${groupLabel}: ${value}`;
}

function extractDayAggregates(entries: DailyTrackerEntry[]): DayAggregate[] {
  const byDay = new Map<string, DailyTrackerEntry[]>();
  for (const entry of entries) {
    const existing = byDay.get(entry.date) || [];
    existing.push(entry);
    byDay.set(entry.date, existing);
  }

  return [...byDay.entries()]
    .map(([date, dayEntries]) => {
      const features = new Set<string>();
      const moodValues: number[] = [];
      const productivityValues: number[] = [];
      const motivationValues: number[] = [];
      const sleepValues: number[] = [];
      const fatigueValues: number[] = [];
      const headacheValues: number[] = [];
      const coughingValues: number[] = [];

      for (const entry of dayEntries) {
        const form = entry.form;

        const optionGroups: Array<[string, string[]]> = [
          ["sleep-stuff", form.sleepStuff],
          ["emotions", form.emotions],
          ["supps", form.supplements],
          ["exercise", form.exercise],
          ["school", form.school],
          ["events", form.events],
          ["hobbies", form.hobbies],
          ["chores", form.chores],
          ["other-factors", form.otherFactors],
        ];

        for (const [group, values] of optionGroups) {
          for (const value of values) {
            features.add(`${group}::${value}`);
          }
        }

        if (form.emotionOther.trim()) {
          features.add("emotions::other");
        }
        if (form.todaysNote.trim()) {
          features.add("notes::added");
        }
        if (form.kolbExperience.trim() || form.kolbReflection.trim() || form.kolbAbstraction.trim() || form.kolbExperimentation.trim()) {
          features.add("kolb::used");
        }
        if (form.media.length > 0) {
          features.add("media::attached");
        }

        if (typeof form.moodRating === "number") moodValues.push(form.moodRating);
        if (typeof form.productivity === "number") productivityValues.push(form.productivity);
        if (typeof form.motivation === "number") motivationValues.push(form.motivation);
        if (typeof form.morningSleepRating === "number") sleepValues.push(form.morningSleepRating);
        if (typeof form.fatigue === "number") fatigueValues.push(form.fatigue);
        if (typeof form.headache === "number") headacheValues.push(form.headache);
        if (typeof form.coughing === "number") coughingValues.push(form.coughing);

        if (typeof form.alcohol === "number") {
          if (form.alcohol >= 5) {
            features.add("alcohol::high");
          } else if (form.alcohol > 0) {
            features.add("alcohol::some");
          }
        }

        if (typeof form.caffeineMg === "number") {
          if (form.caffeineMg >= 150) {
            features.add("caffeine::high");
          } else if (form.caffeineMg >= 50) {
            features.add("caffeine::some");
          }
        }
      }

      const metrics: Partial<Record<MetricKey, number>> = {};
      const moodAvg = average(moodValues);
      const productivityAvg = average(productivityValues);
      const motivationAvg = average(motivationValues);
      const sleepAvg = average(sleepValues);
      const fatigueAvg = average(fatigueValues);
      const headacheAvg = average(headacheValues);
      const coughingAvg = average(coughingValues);

      if (moodAvg !== null) metrics.mood = moodAvg;
      if (productivityAvg !== null) metrics.productivity = productivityAvg;
      if (motivationAvg !== null) metrics.motivation = motivationAvg;
      if (sleepAvg !== null) metrics.sleep = sleepAvg;
      if (fatigueAvg !== null) metrics.fatigue = fatigueAvg;
      if (headacheAvg !== null) metrics.headache = headacheAvg;
      if (coughingAvg !== null) metrics.coughing = coughingAvg;

      return { date, features, metrics };
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

function pearsonCorrelation(binary: number[], metric: number[]): number | null {
  if (binary.length !== metric.length || binary.length < MIN_DAYS_FOR_CORRELATION) return null;

  const n = binary.length;
  const meanX = binary.reduce((sum, value) => sum + value, 0) / n;
  const meanY = metric.reduce((sum, value) => sum + value, 0) / n;

  let numerator = 0;
  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < n; i += 1) {
    const dx = binary[i] - meanX;
    const dy = metric[i] - meanY;
    numerator += dx * dy;
    sumX += dx * dx;
    sumY += dy * dy;
  }

  if (sumX === 0 || sumY === 0) return null;
  return numerator / Math.sqrt(sumX * sumY);
}

function computeCorrelations(dayData: DayAggregate[]): CorrelationResult[] {
  const allFeatures = new Set<string>();
  for (const day of dayData) {
    for (const feature of day.features) {
      allFeatures.add(feature);
    }
  }

  const results: CorrelationResult[] = [];

  for (const feature of allFeatures) {
    for (const metric of Object.keys(METRIC_LABELS) as MetricKey[]) {
      const binary: number[] = [];
      const values: number[] = [];
      const presentValues: number[] = [];
      const absentValues: number[] = [];

      for (const day of dayData) {
        const metricValue = day.metrics[metric];
        if (typeof metricValue !== "number") continue;

        const present = day.features.has(feature);
        const bit = present ? 1 : 0;
        binary.push(bit);
        values.push(metricValue);
        if (present) {
          presentValues.push(metricValue);
        } else {
          absentValues.push(metricValue);
        }
      }

      if (values.length < MIN_DAYS_FOR_CORRELATION) continue;
      if (presentValues.length < 2 || absentValues.length < 2) continue;

      const correlation = pearsonCorrelation(binary, values);
      if (correlation === null) continue;
      if (Math.abs(correlation) < MIN_ABS_CORRELATION) continue;

      const presentAverage = average(presentValues);
      const absentAverage = average(absentValues);
      if (presentAverage === null || absentAverage === null) continue;

      results.push({
        feature,
        metric,
        correlation,
        sampleSize: values.length,
        presentCount: presentValues.length,
        absentCount: absentValues.length,
        presentAverage,
        absentAverage,
      });
    }
  }

  return results
    .sort((left, right) => Math.abs(right.correlation) - Math.abs(left.correlation))
    .slice(0, MAX_RESULTS);
}

export default function DailyTrackerCorrelations() {
  const [entries, setEntries] = useState<DailyTrackerEntry[]>([]);

  useEffect(() => {
    const load = () => {
      const raw = window.localStorage.getItem(DAILY_TRACKER_ENTRIES_STORAGE_KEY);
      const parsed = parseDailyTrackerEntries(raw);
      setEntries(parsed);
    };

    load();
    window.addEventListener("storage", load);
    TRACKER_UPDATED_EVENTS.forEach((eventName) => window.addEventListener(eventName, load));

    return () => {
      window.removeEventListener("storage", load);
      TRACKER_UPDATED_EVENTS.forEach((eventName) => window.removeEventListener(eventName, load));
    };
  }, []);

  const dayData = useMemo(() => extractDayAggregates(entries), [entries]);
  const correlations = useMemo(() => computeCorrelations(dayData), [dayData]);

  return (
    <div className="surface-card p-6">
      <h2 className="text-lg font-semibold mb-2">Daily Tracker Correlations</h2>
      <p className="text-xs text-zinc-500 mb-3">
        Showing only detected correlations from daily tracker data (|r| ≥ {MIN_ABS_CORRELATION.toFixed(1)}).
      </p>

      {dayData.length < MIN_DAYS_FOR_CORRELATION && (
        <p className="text-sm text-zinc-500">
          Add at least {MIN_DAYS_FOR_CORRELATION} days of tracker logs to compute correlations.
        </p>
      )}

      {dayData.length >= MIN_DAYS_FOR_CORRELATION && correlations.length === 0 && (
        <p className="text-sm text-zinc-500">No strong correlations found yet.</p>
      )}

      {correlations.length > 0 && (
        <div className="space-y-2">
          {correlations.map((result, index) => (
            <div
              key={`${result.feature}-${result.metric}-${index}`}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
            >
              <p className="text-sm font-medium">
                {formatFeatureLabel(result.feature)} vs {METRIC_LABELS[result.metric]}
              </p>
              <p className="text-xs text-zinc-600 mt-0.5">
                r={result.correlation.toFixed(2)} ({result.correlation > 0 ? "positive" : "negative"}) • n=
                {result.sampleSize}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Present avg {result.presentAverage.toFixed(2)} ({result.presentCount} days) • Absent avg {" "}
                {result.absentAverage.toFixed(2)} ({result.absentCount} days)
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
