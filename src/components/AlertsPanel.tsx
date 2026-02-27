"use client";

import { useEffect, useMemo, useState } from "react";
import type { HabitTrackerData } from "@/lib/types";

const PROJECTION_HOURS_STORAGE_KEY = "study-stats.projection.hours-per-day";
const PROJECTION_SUBJECT_TARGETS_STORAGE_KEY = "study-stats.projection.subject-targets";
const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";

interface SubjectTarget {
  id: string;
  name: string;
  weeklyTargetHours: number;
  monthlyTargetHours: number;
}

interface AppWarning {
  key: string;
  title: string;
  message: string;
  severity: "warning" | "critical";
}

function readSubjectTargets(): SubjectTarget[] {
  const raw = window.localStorage.getItem(PROJECTION_SUBJECT_TARGETS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is SubjectTarget => {
        return (
          typeof item === "object" &&
          item !== null &&
          "id" in item &&
          "name" in item &&
          "weeklyTargetHours" in item &&
          "monthlyTargetHours" in item
        );
      })
      .map((item) => ({
        id: String(item.id),
        name: String(item.name || "Subject"),
        weeklyTargetHours: Math.max(0, Number(item.weeklyTargetHours) || 0),
        monthlyTargetHours: Math.max(0, Number(item.monthlyTargetHours) || 0),
      }));
  } catch {
    return [];
  }
}

function readHoursPerDay(): number {
  const raw = window.localStorage.getItem(PROJECTION_HOURS_STORAGE_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return parsed;
}

export default function AlertsPanel() {
  const [warnings, setWarnings] = useState<AppWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadWarnings = async () => {
      try {
        setLoading(true);
        setError(null);

        const nextWarnings: AppWarning[] = [];

        // 1) Missed target risk from StudyProjection settings
        const subjectTargets = readSubjectTargets();
        const hoursPerDay = readHoursPerDay();
        const subjectCount = Math.max(1, subjectTargets.length);
        const projectedDailyPerSubject = hoursPerDay / subjectCount;
        const projectedWeeklyPerSubject = projectedDailyPerSubject * 7;
        const projectedMonthlyPerSubject = projectedDailyPerSubject * 30.4375;

        for (const subject of subjectTargets) {
          const weeklyGap = subject.weeklyTargetHours - projectedWeeklyPerSubject;
          const monthlyGap = subject.monthlyTargetHours - projectedMonthlyPerSubject;
          if (weeklyGap <= 0 && monthlyGap <= 0) continue;
          const severity: "warning" | "critical" =
            weeklyGap >= 3 || monthlyGap >= 10 ? "critical" : "warning";
          nextWarnings.push({
            key: `target-${subject.id}`,
            title: `Missed-target risk: ${subject.name}`,
            message: `Current pace is short by ${Math.max(weeklyGap, 0).toFixed(
              1
            )}h/week and ${Math.max(monthlyGap, 0).toFixed(1)}h/month.`,
            severity,
          });
        }

        // 2) Streak risk from habit tracker
        const params = new URLSearchParams({ weeks: "2" });
        const trackerCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
        if (trackerCalendarId) params.set("trackerCalendarId", trackerCalendarId);
        const trackerResponse = await fetch(`/api/habit-tracker?${params.toString()}`);
        const trackerPayload = (await trackerResponse.json()) as HabitTrackerData | { error?: string };
        if (trackerResponse.ok) {
          const data = trackerPayload as HabitTrackerData;
          for (const habit of data.habits) {
            const lastDay = habit.days[habit.days.length - 1];
            if (!lastDay) continue;
            if (habit.currentStreak <= 0) continue;
            if (lastDay.completed) continue;
            nextWarnings.push({
              key: `streak-${habit.slug}`,
              title: `Streak risk: ${habit.name}`,
              message: `Your ${habit.currentStreak}-day streak is at risk today. Log ${habit.name.toLowerCase()} to keep it alive.`,
              severity: habit.currentStreak >= 7 ? "critical" : "warning",
            });
          }
        }

        if (cancelled) return;
        const limitedWarnings = nextWarnings.slice(0, 8);
        setWarnings(limitedWarnings);

        if (limitedWarnings.length > 0) {
          await fetch("/api/alerts/notify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ warnings: limitedWarnings }),
          });
        }
      } catch (loadError: unknown) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load warnings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadWarnings();
    return () => {
      cancelled = true;
    };
  }, []);

  const criticalCount = useMemo(
    () => warnings.filter((item) => item.severity === "critical").length,
    [warnings]
  );

  if (loading) return null;
  if (error) return null;
  if (warnings.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-amber-800">
          Alerts: {warnings.length} warning{warnings.length === 1 ? "" : "s"}
        </h3>
        {criticalCount > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-700">
            {criticalCount} critical
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {warnings.map((warning) => (
          <div key={warning.key} className="text-xs text-zinc-700">
            <span className="font-medium">{warning.title}:</span> {warning.message}
          </div>
        ))}
      </div>
    </div>
  );
}
