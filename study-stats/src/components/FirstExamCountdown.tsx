"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const PROJECTION_EXAM_DATE_STORAGE_KEY = "study-stats.projection.exam-date";
const PROJECTION_COUNTDOWN_START_STORAGE_KEY = "study-stats.projection.countdown-start";
const EXAM_DATE_UPDATED_EVENT = "study-stats:exam-date-updated";

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultProjectionDate(): string {
  const date = new Date();
  date.setMonth(date.getMonth() + 3);
  return toDateInputValue(date);
}

function parseDateInput(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function getTodayAtNoon(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function FirstExamCountdown() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [firstExamDate, setFirstExamDate] = useState(getDefaultProjectionDate);
  const [countdownStartDate, setCountdownStartDate] = useState(() =>
    toDateInputValue(getTodayAtNoon())
  );
  const syncTimeoutRef = useRef<number | null>(null);
  const hydratedFromCloudRef = useRef(false);

  const callApi = async (
    method: "GET" | "PUT",
    payload?: { examDate: string; countdownStartDate: string }
  ) => {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("No active Supabase session.");

    const response = await fetch("/api/exam-countdown", {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === "PUT" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "PUT" ? JSON.stringify(payload) : undefined,
    });

    const json = (await response.json()) as {
      error?: string;
      examDate?: string | null;
      countdownStartDate?: string | null;
    };
    if (!response.ok) throw new Error(json.error || "Exam countdown sync failed.");
    return json;
  };

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    const storedExamDate = window.localStorage.getItem(PROJECTION_EXAM_DATE_STORAGE_KEY);
    if (storedExamDate) setFirstExamDate(storedExamDate);

    const storedCountdownStart = window.localStorage.getItem(
      PROJECTION_COUNTDOWN_START_STORAGE_KEY
    );
    if (storedCountdownStart) setCountdownStartDate(storedCountdownStart);
  }, []);

  useEffect(() => {
    if (!session || !supabase || hydratedFromCloudRef.current) return;
    let cancelled = false;

    const loadCloud = async () => {
      try {
        const result = await callApi("GET");
        if (cancelled) return;
        if (result.examDate) setFirstExamDate(result.examDate);
        if (result.countdownStartDate) setCountdownStartDate(result.countdownStartDate);
        hydratedFromCloudRef.current = true;
      } catch {
        // Ignore cloud load errors; localStorage still works.
      }
    };

    void loadCloud();
    return () => {
      cancelled = true;
    };
  }, [session, supabase]);

  useEffect(() => {
    window.localStorage.setItem(PROJECTION_EXAM_DATE_STORAGE_KEY, firstExamDate);
    window.dispatchEvent(new CustomEvent(EXAM_DATE_UPDATED_EVENT));
  }, [firstExamDate]);

  useEffect(() => {
    window.localStorage.setItem(
      PROJECTION_COUNTDOWN_START_STORAGE_KEY,
      countdownStartDate
    );
  }, [countdownStartDate]);

  useEffect(() => {
    if (!session || !supabase) return;
    if (syncTimeoutRef.current) window.clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = window.setTimeout(() => {
      void callApi("PUT", {
        examDate: firstExamDate,
        countdownStartDate,
      }).catch(() => {
        // Ignore background sync errors; localStorage remains source of truth on this device.
      });
    }, 600);

    return () => {
      if (syncTimeoutRef.current) {
        window.clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
    };
  }, [countdownStartDate, firstExamDate, session, supabase]);

  const now = getTodayAtNoon();
  const examDateObject = parseDateInput(firstExamDate);
  const countdownStartObject = parseDateInput(countdownStartDate);

  const daysUntilExam = Math.max(
    0,
    Math.ceil((examDateObject.getTime() - now.getTime()) / (1000 * 86400))
  );
  const weeksUntilExam = Math.floor(daysUntilExam / 7);
  const remainingDays = daysUntilExam % 7;
  const totalCountdownDays = Math.max(
    1,
    Math.ceil((examDateObject.getTime() - countdownStartObject.getTime()) / (1000 * 86400))
  );
  const elapsedCountdownDays = Math.ceil(
    (now.getTime() - countdownStartObject.getTime()) / (1000 * 86400)
  );
  const countdownProgress = clamp(
    (elapsedCountdownDays / totalCountdownDays) * 100,
    0,
    100
  );

  const progressLabel = useMemo(() => `${Math.round(countdownProgress)}%`, [countdownProgress]);

  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <h2 className="text-lg font-semibold mb-4">First Exam Countdown</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <label className="flex flex-col gap-1 text-sm">
          First exam date
          <input
            type="date"
            value={firstExamDate}
            onChange={(e) => setFirstExamDate(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Countdown start date
          <input
            type="date"
            value={countdownStartDate}
            onChange={(e) => setCountdownStartDate(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
          />
        </label>
      </div>

      <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 p-4">
        <p className="text-sm text-zinc-500 mb-2">Until first exam</p>
        <p className="text-2xl font-bold mb-3">
          {weeksUntilExam} week{weeksUntilExam === 1 ? "" : "s"} {remainingDays} day
          {remainingDays === 1 ? "" : "s"}
        </p>
        <div className="w-full h-3 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-sky-500 transition-all duration-700"
            style={{ width: `${countdownProgress}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-zinc-500">
          <span>Start: {countdownStartDate}</span>
          <span>Exam: {firstExamDate}</span>
          <span>{progressLabel}</span>
        </div>
      </div>
    </div>
  );
}
