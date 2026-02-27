"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/scroll-lock";
import StudyProjection from "@/components/StudyProjection";

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
  const [showStudyProjection, setShowStudyProjection] = useState(false);
  const [showFullscreenCountdown, setShowFullscreenCountdown] = useState(false);
  const [localHydrated, setLocalHydrated] = useState(false);
  const syncTimeoutRef = useRef<number | null>(null);
  const hydratedFromCloudRef = useRef(false);
  const cloudHydrationCompleteRef = useRef(false);
  const mounted = typeof window !== "undefined";

  const callApi = useCallback(
    async (
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
    },
    [supabase]
  );

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

    setLocalHydrated(true);
  }, []);

  useEffect(() => {
    const handleExternalDateUpdate = () => {
      const storedExamDate = window.localStorage.getItem(PROJECTION_EXAM_DATE_STORAGE_KEY);
      const storedCountdownStart = window.localStorage.getItem(
        PROJECTION_COUNTDOWN_START_STORAGE_KEY
      );
      if (storedExamDate) setFirstExamDate(storedExamDate);
      if (storedCountdownStart) setCountdownStartDate(storedCountdownStart);
    };
    window.addEventListener(EXAM_DATE_UPDATED_EVENT, handleExternalDateUpdate);
    return () => window.removeEventListener(EXAM_DATE_UPDATED_EVENT, handleExternalDateUpdate);
  }, []);

  useEffect(() => {
    if (!session || !supabase || !localHydrated || hydratedFromCloudRef.current || cloudHydrationCompleteRef.current) return;
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
      } finally {
        if (!cancelled) cloudHydrationCompleteRef.current = true;
      }
    };

    void loadCloud();
    return () => {
      cancelled = true;
    };
  }, [callApi, localHydrated, session, supabase]);

  useEffect(() => {
    if (!localHydrated) return;
    window.localStorage.setItem(PROJECTION_EXAM_DATE_STORAGE_KEY, firstExamDate);
    window.dispatchEvent(new CustomEvent(EXAM_DATE_UPDATED_EVENT));
  }, [firstExamDate, localHydrated]);

  useEffect(() => {
    if (!localHydrated) return;
    window.localStorage.setItem(
      PROJECTION_COUNTDOWN_START_STORAGE_KEY,
      countdownStartDate
    );
  }, [countdownStartDate, localHydrated]);

  useEffect(() => {
    if (!session || !supabase || !localHydrated || !cloudHydrationCompleteRef.current) return;
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
  }, [callApi, countdownStartDate, firstExamDate, localHydrated, session, supabase]);

  useEffect(() => {
    if (!showStudyProjection && !showFullscreenCountdown) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [showFullscreenCountdown, showStudyProjection]);

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
    <div className="surface-card p-6">
      <div className="rounded-xl bg-zinc-50 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xl font-bold stat-mono">
            {weeksUntilExam} week{weeksUntilExam === 1 ? "" : "s"} {remainingDays} day
            {remainingDays === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFullscreenCountdown(true)}
              className="pill-btn"
            >
              Fullscreen
            </button>
            <button
              type="button"
              onClick={() => setShowStudyProjection(true)}
              className="pill-btn"
            >
              Project Future Studying
            </button>
          </div>
        </div>
        <div className="w-full h-3 bg-zinc-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-sky-500 transition-all duration-700"
            style={{ width: `${countdownProgress}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-zinc-500">
          <span className="stat-mono">Start: {countdownStartDate}</span>
          <span className="stat-mono">Exam: {firstExamDate}</span>
          <span className="stat-mono">{progressLabel}</span>
        </div>
      </div>

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
                <h4 className="text-sm font-semibold">Project Future Studying</h4>
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

      {mounted &&
        showFullscreenCountdown &&
        createPortal(
          <div
            className="fixed inset-0 z-[210] bg-white flex items-center justify-center p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShowFullscreenCountdown(false);
            }}
          >
            <button
              type="button"
              onClick={() => setShowFullscreenCountdown(false)}
              className="pill-btn absolute top-4 right-4"
            >
              Close
            </button>
            <div className="w-full max-w-5xl text-center">
              <p className="text-sm text-zinc-500 mb-4">Until exam</p>
              <p
                className="stat-mono font-bold tracking-tight text-zinc-900 leading-none"
                style={{ fontSize: "min(50vh, 42vw)" }}
              >
                {weeksUntilExam}w {remainingDays}d
              </p>
              <div className="mx-auto mt-8 w-full max-w-4xl h-6 bg-zinc-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all duration-700"
                  style={{ width: `${countdownProgress}%` }}
                />
              </div>
              <p className="stat-mono mt-3 text-sm text-zinc-500">{progressLabel}</p>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
