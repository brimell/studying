"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const PROJECTION_DATE_STORAGE_KEY = "study-stats.projection.end-date";
const PROJECTION_HOURS_STORAGE_KEY = "study-stats.projection.hours-per-day";
const PROJECTION_EXAM_DATE_STORAGE_KEY = "study-stats.projection.exam-date";
const PROJECTION_SUBJECT_TARGETS_STORAGE_KEY = "study-stats.projection.subject-targets";
const PROJECTION_SETTINGS_STORAGE_KEY = "study-stats.projection.settings";
const EXAM_DATE_UPDATED_EVENT = "study-stats:exam-date-updated";

const MONTH_LENGTH_DAYS = 30.4375;

interface SubjectTarget {
  id: string;
  name: string;
  weeklyTargetHours: number;
  monthlyTargetHours: number;
}

interface ProjectionSettingsSnapshot {
  endDate: string;
  hoursPerDay: number;
  firstExamDate: string;
  subjectTargets: SubjectTarget[];
}

const DEFAULT_SUBJECT_TARGETS: SubjectTarget[] = [
  { id: "maths", name: "Maths", weeklyTargetHours: 8, monthlyTargetHours: 34 },
  { id: "computer-science", name: "Computer Science", weeklyTargetHours: 8, monthlyTargetHours: 34 },
  { id: "physics", name: "Physics", weeklyTargetHours: 8, monthlyTargetHours: 34 },
];

function getDefaultProjectionDate(): string {
  const date = new Date();
  date.setMonth(date.getMonth() + 3);
  return toDateInputValue(date);
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function getTodayAtNoon(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatSignedHours(value: number): string {
  const rounded = round1(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)}h`;
}

function isValidSubjectTargets(value: unknown): value is SubjectTarget[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "id" in item &&
      "name" in item &&
      "weeklyTargetHours" in item &&
      "monthlyTargetHours" in item
  );
}

function createSubjectId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `subject-${Date.now()}`;
}

export default function StudyProjection() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [endDate, setEndDate] = useState(getDefaultProjectionDate);
  const [hoursPerDay, setHoursPerDay] = useState(5);
  const [firstExamDate, setFirstExamDate] = useState(getDefaultProjectionDate);
  const [subjectTargets, setSubjectTargets] = useState<SubjectTarget[]>(
    DEFAULT_SUBJECT_TARGETS
  );
  const [cloudProjectionReady, setCloudProjectionReady] = useState(false);
  const projectionSyncSnapshotRef = useRef<string>("");

  useEffect(() => {
    const consolidated = window.localStorage.getItem(PROJECTION_SETTINGS_STORAGE_KEY);
    if (consolidated) {
      try {
        const parsed = JSON.parse(consolidated) as Partial<ProjectionSettingsSnapshot>;
        if (typeof parsed.endDate === "string") {
          setEndDate(parsed.endDate);
        }
        if (
          typeof parsed.hoursPerDay === "number" &&
          Number.isFinite(parsed.hoursPerDay) &&
          parsed.hoursPerDay >= 1 &&
          parsed.hoursPerDay <= 16
        ) {
          setHoursPerDay(parsed.hoursPerDay);
        }
        if (typeof parsed.firstExamDate === "string") {
          setFirstExamDate(parsed.firstExamDate);
        }
        if (isValidSubjectTargets(parsed.subjectTargets)) {
          setSubjectTargets(
            parsed.subjectTargets.map((subject) => ({
              ...subject,
              weeklyTargetHours: Math.max(0, Number(subject.weeklyTargetHours) || 0),
              monthlyTargetHours: Math.max(0, Number(subject.monthlyTargetHours) || 0),
              name: String(subject.name || "Subject"),
            }))
          );
        }
      } catch {
        // Ignore malformed consolidated localStorage value.
      }
    }

    const storedDate = window.localStorage.getItem(PROJECTION_DATE_STORAGE_KEY);
    if (storedDate) setEndDate(storedDate);

    const storedHours = window.localStorage.getItem(PROJECTION_HOURS_STORAGE_KEY);
    if (storedHours) {
      const parsed = Number(storedHours);
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 16) setHoursPerDay(parsed);
    }

    const storedExamDate = window.localStorage.getItem(PROJECTION_EXAM_DATE_STORAGE_KEY);
    if (storedExamDate) setFirstExamDate(storedExamDate);

    const storedTargets = window.localStorage.getItem(PROJECTION_SUBJECT_TARGETS_STORAGE_KEY);
    if (storedTargets) {
      try {
        const parsed = JSON.parse(storedTargets) as unknown;
        if (isValidSubjectTargets(parsed)) {
          setSubjectTargets(
            parsed.map((subject) => ({
              ...subject,
              weeklyTargetHours: Math.max(0, Number(subject.weeklyTargetHours) || 0),
              monthlyTargetHours: Math.max(0, Number(subject.monthlyTargetHours) || 0),
              name: String(subject.name || "Subject"),
            }))
          );
        }
      } catch {
        // Ignore malformed localStorage value.
      }
    }
  }, []);

  useEffect(() => {
    const snapshot: ProjectionSettingsSnapshot = {
      endDate,
      hoursPerDay,
      firstExamDate,
      subjectTargets,
    };
    window.localStorage.setItem(PROJECTION_SETTINGS_STORAGE_KEY, JSON.stringify(snapshot));
  }, [endDate, firstExamDate, hoursPerDay, subjectTargets]);

  useEffect(() => {
    window.localStorage.setItem(PROJECTION_DATE_STORAGE_KEY, endDate);
  }, [endDate]);

  useEffect(() => {
    window.localStorage.setItem(PROJECTION_HOURS_STORAGE_KEY, String(hoursPerDay));
  }, [hoursPerDay]);

  useEffect(() => {
    const onExamDateUpdated = () => {
      const storedExamDate = window.localStorage.getItem(PROJECTION_EXAM_DATE_STORAGE_KEY);
      if (storedExamDate) setFirstExamDate(storedExamDate);
    };
    window.addEventListener(EXAM_DATE_UPDATED_EVENT, onExamDateUpdated);
    return () => window.removeEventListener(EXAM_DATE_UPDATED_EVENT, onExamDateUpdated);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      PROJECTION_SUBJECT_TARGETS_STORAGE_KEY,
      JSON.stringify(subjectTargets)
    );
  }, [subjectTargets]);

  useEffect(() => {
    if (!supabase) {
      setCloudProjectionReady(true);
      return;
    }

    let cancelled = false;
    const loadCloudProjection = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;

        const response = await fetch("/api/study-projection", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) return;

        const payload = (await response.json()) as {
          endDate?: string | null;
          hoursPerDay?: number | null;
          cloudDisabled?: boolean;
        };
        if (cancelled || payload.cloudDisabled) return;

        if (typeof payload.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.endDate)) {
          setEndDate(payload.endDate);
        }
        if (
          typeof payload.hoursPerDay === "number" &&
          Number.isFinite(payload.hoursPerDay) &&
          payload.hoursPerDay >= 1 &&
          payload.hoursPerDay <= 16
        ) {
          setHoursPerDay(payload.hoursPerDay);
        }

        if (
          typeof payload.endDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(payload.endDate) &&
          typeof payload.hoursPerDay === "number" &&
          Number.isFinite(payload.hoursPerDay) &&
          payload.hoursPerDay >= 1 &&
          payload.hoursPerDay <= 16
        ) {
          projectionSyncSnapshotRef.current = `${payload.endDate}|${payload.hoursPerDay}`;
        }
      } catch {
        // Ignore cloud load errors; localStorage remains active.
      } finally {
        if (!cancelled) setCloudProjectionReady(true);
      }
    };

    void loadCloudProjection();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!cloudProjectionReady || !supabase) return;

    let cancelled = false;
    const syncCloudProjection = async () => {
      const snapshot = `${endDate}|${hoursPerDay}`;
      if (snapshot === projectionSyncSnapshotRef.current) return;

      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;

        const response = await fetch("/api/study-projection", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            endDate,
            hoursPerDay,
          }),
        });
        if (!response.ok) return;
        if (!cancelled) projectionSyncSnapshotRef.current = snapshot;
      } catch {
        // Ignore cloud sync errors; localStorage remains source of truth on this device.
      }
    };

    void syncCloudProjection();
    return () => {
      cancelled = true;
    };
  }, [cloudProjectionReady, endDate, hoursPerDay, supabase]);

  const now = getTodayAtNoon();
  const projectionTargetDate = parseDateInput(endDate);
  const daysRemaining = Math.max(
    0,
    Math.ceil((projectionTargetDate.getTime() - now.getTime()) / (1000 * 86400))
  );
  const totalHours = daysRemaining * hoursPerDay;
  const subjectCount = Math.max(1, subjectTargets.length);
  const hoursPerSubject = Math.round(totalHours / subjectCount);

  const examDateObject = parseDateInput(firstExamDate);
  const daysUntilExam = Math.max(
    0,
    Math.ceil((examDateObject.getTime() - now.getTime()) / (1000 * 86400))
  );

  const targetAnalysis = useMemo(() => {
    const projectedDailyPerSubject = hoursPerDay / subjectCount;
    const projectedWeeklyPerSubject = projectedDailyPerSubject * 7;
    const projectedMonthlyPerSubject = projectedDailyPerSubject * MONTH_LENGTH_DAYS;

    return subjectTargets.map((subject) => {
      const requiredDailyWeekly = subject.weeklyTargetHours / 7;
      const requiredDailyMonthly = subject.monthlyTargetHours / MONTH_LENGTH_DAYS;
      const requiredDaily = Math.max(requiredDailyWeekly, requiredDailyMonthly);
      const extraDailyNeeded = Math.max(0, requiredDaily - projectedDailyPerSubject);

      return {
        ...subject,
        projectedWeeklyPerSubject,
        projectedMonthlyPerSubject,
        weeklyGap: subject.weeklyTargetHours - projectedWeeklyPerSubject,
        monthlyGap: subject.monthlyTargetHours - projectedMonthlyPerSubject,
        requiredDaily,
        requiredWeekly: requiredDaily * 7,
        requiredMonthly: requiredDaily * MONTH_LENGTH_DAYS,
        extraDailyNeeded,
        examGapHours: extraDailyNeeded * daysUntilExam,
      };
    });
  }, [hoursPerDay, subjectCount, subjectTargets, daysUntilExam]);

  const updateSubjectTarget = (
    id: string,
    field: "name" | "weeklyTargetHours" | "monthlyTargetHours",
    value: string
  ) => {
    setSubjectTargets((previous) =>
      previous.map((subject) => {
        if (subject.id !== id) return subject;
        if (field === "name") {
          return { ...subject, name: value };
        }

        const parsed = Number(value);
        return {
          ...subject,
          [field]: Number.isNaN(parsed) ? 0 : Math.max(0, parsed),
        };
      })
    );
  };

  const addSubject = () => {
    const baseName = "New Subject";
    const existingNames = new Set(
      subjectTargets.map((subject) => subject.name.trim().toLowerCase())
    );
    let nextName = baseName;
    let suffix = 2;
    while (existingNames.has(nextName.toLowerCase())) {
      nextName = `${baseName} ${suffix}`;
      suffix += 1;
    }

    setSubjectTargets((previous) => [
      ...previous,
      {
        id: createSubjectId(nextName),
        name: nextName,
        weeklyTargetHours: 0,
        monthlyTargetHours: 0,
      },
    ]);
  };

  const removeSubject = (id: string) => {
    setSubjectTargets((previous) => previous.filter((subject) => subject.id !== id));
  };

  return (
    <div className="surface-card p-6">
      <h2 className="text-lg font-semibold mb-4">Study Projection</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <label className="flex flex-col gap-1 text-sm">
          Target date
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Hours per day
          <input
            type="number"
            min={1}
            max={16}
            value={hoursPerDay}
            onChange={(e) => setHoursPerDay(Number(e.target.value))}
            className="border rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
          />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-4 text-center">
        <StatCard label="Days remaining" value={daysRemaining} />
        <StatCard label="Total hours" value={totalHours} />
        <StatCard label="Hours / subject" value={hoursPerSubject} />
      </div>

      <div className="mt-6 border-t border-zinc-200 dark:border-zinc-800 pt-4">
        <h3 className="text-base font-semibold mb-1">Target Pace Planner</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Set weekly/monthly target hours per subject. Gaps and required pace update automatically.
        </p>
        <div className="mb-4">
          <button
            type="button"
            onClick={addSubject}
            className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
          >
            Add subject
          </button>
        </div>

        <div className="space-y-3">
          {targetAnalysis.map((subject) => {
            const weeklyGapClass = subject.weeklyGap > 0 ? "text-red-500" : "text-emerald-600";
            const monthlyGapClass = subject.monthlyGap > 0 ? "text-red-500" : "text-emerald-600";

            return (
              <div
                key={subject.id}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3"
              >
                <div className="flex justify-end mb-2">
                  <button
                    type="button"
                    onClick={() => removeSubject(subject.id)}
                    className="px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    Subject
                    <input
                      type="text"
                      value={subject.name}
                      onChange={(e) => updateSubjectTarget(subject.id, "name", e.target.value)}
                      className="border rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 dark:border-zinc-700"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Weekly target (hours)
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={subject.weeklyTargetHours}
                      onChange={(e) =>
                        updateSubjectTarget(subject.id, "weeklyTargetHours", e.target.value)
                      }
                      className="border rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 dark:border-zinc-700"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Monthly target (hours)
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={subject.monthlyTargetHours}
                      onChange={(e) =>
                        updateSubjectTarget(subject.id, "monthlyTargetHours", e.target.value)
                      }
                      className="border rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 dark:border-zinc-700"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
                  <div>
                    <p className="text-zinc-500">Projected weekly</p>
                    <p className="font-semibold">{round1(subject.projectedWeeklyPerSubject).toFixed(1)}h</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Projected monthly</p>
                    <p className="font-semibold">{round1(subject.projectedMonthlyPerSubject).toFixed(1)}h</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Weekly gap</p>
                    <p className={`font-semibold ${weeklyGapClass}`}>{formatSignedHours(subject.weeklyGap)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Monthly gap</p>
                    <p className={`font-semibold ${monthlyGapClass}`}>{formatSignedHours(subject.monthlyGap)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <h4 className="text-sm font-semibold mt-5 mb-3">Required Pace Cards</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {targetAnalysis.map((subject) => (
            <div
              key={`${subject.id}-required-pace`}
              className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4"
            >
              <p className="text-sm font-semibold mb-2">{subject.name}</p>
              <div className="space-y-1 text-sm">
                <p>
                  Required pace: <span className="font-semibold">{round1(subject.requiredDaily).toFixed(1)}h/day</span>
                </p>
                <p>
                  Weekly equivalent: <span className="font-semibold">{round1(subject.requiredWeekly).toFixed(1)}h/week</span>
                </p>
                <p>
                  Monthly equivalent: <span className="font-semibold">{round1(subject.requiredMonthly).toFixed(1)}h/month</span>
                </p>
                <p>
                  Extra daily needed: <span className="font-semibold">{round1(subject.extraDailyNeeded).toFixed(1)}h/day</span>
                </p>
                <p>
                  Gap to first exam: <span className="font-semibold">{round1(subject.examGapHours).toFixed(1)}h</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-zinc-500 mt-1">{label}</p>
    </div>
  );
}
