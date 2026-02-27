"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatStudyTimerClock,
  type StudyTimerState,
} from "@/lib/study-timer";

interface StudyTimerPopupProps {
  state: StudyTimerState;
  onClose: () => void;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onApplySettings: (settings: {
    studyMinutes: number;
    breakEnabled: boolean;
    breakMinutes: number;
  }) => void;
  onToggleExamMode: () => void;
}

function AnalogClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const seconds = now.getSeconds();
  const minutes = now.getMinutes();
  const hours = now.getHours() % 12;
  const secondAngle = seconds * 6;
  const minuteAngle = minutes * 6 + seconds * 0.1;
  const hourAngle = hours * 30 + minutes * 0.5;

  return (
    <div className="study-analog-clockface" aria-label="Analog clock">
      <div
        className="study-analog-hand study-analog-second"
        style={{ transform: `translateX(-50%) rotate(${secondAngle}deg)` }}
      />
      <div
        className="study-analog-hand study-analog-minute"
        style={{ transform: `translateX(-50%) rotate(${minuteAngle}deg)` }}
      />
      <div
        className="study-analog-hand study-analog-hour"
        style={{ transform: `translateX(-50%) rotate(${hourAngle}deg)` }}
      />
      {Array.from({ length: 12 }, (_, index) => {
        const number = index + 1;
        const angle = ((number - 3) * 30 * Math.PI) / 180;
        const x = 50 + Math.cos(angle) * 42;
        const y = 50 + Math.sin(angle) * 42;
        return (
          <div
            key={`label-${number}`}
            className="study-analog-label"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <span className="study-analog-label-number">{number}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function StudyTimerPopup({
  state,
  onClose,
  onStart,
  onPause,
  onReset,
  onApplySettings,
  onToggleExamMode,
}: StudyTimerPopupProps) {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!popupRef.current) return;
    if (!document.fullscreenElement) {
      await popupRef.current.requestFullscreen();
      return;
    }
    await document.exitFullscreen();
  };

  const applySettings = () => {
    onApplySettings({
      studyMinutes: state.studyMinutes,
      breakEnabled: state.breakEnabled,
      breakMinutes: state.breakMinutes,
    });
  };

  const phaseLabel = state.phase === "study" ? "Study" : "Break";

  return (
    <div
      ref={popupRef}
      className={`surface-card-strong w-full ${isFullscreen ? "h-[100dvh]" : "h-[85vh]"} overflow-hidden p-4 sm:p-5 flex flex-col`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Study Timer</h2>
        <div className="flex items-center gap-2">
          <button type="button" className="pill-btn" onClick={toggleFullscreen}>
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>
          <button type="button" className="pill-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className={`flex-1 min-h-0 ${isFullscreen ? "flex flex-col" : "overflow-y-auto pr-1"}`}>
        {isFullscreen ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6">
            {state.examMode ? (
              <div className="study-analog-wrap study-analog-wrap-fullscreen">
                <AnalogClock />
              </div>
            ) : (
              <p className="stat-mono font-semibold leading-none text-zinc-900 text-[clamp(4rem,18vw,13rem)]">
                {formatStudyTimerClock(state.remainingSeconds)}
              </p>
            )}
            <p className="text-sm text-zinc-600">
              {state.status === "paused" ? "Paused" : phaseLabel} mode
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs uppercase tracking-[0.12em] text-zinc-500">
                  {state.status === "paused" ? "Paused" : phaseLabel}
                </span>
                <span className="text-xs text-zinc-500 stat-mono">
                  Completed study cycles: {state.completedStudyCycles}
                </span>
              </div>
              <p className="mt-2 stat-mono text-5xl sm:text-6xl font-semibold leading-none">
                {state.examMode ? "Exam Mode" : formatStudyTimerClock(state.remainingSeconds)}
              </p>
              {state.examMode && (
                <div className="mt-4 flex justify-center">
                  <div className="study-analog-wrap study-analog-wrap-compact">
                    <AnalogClock />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm text-zinc-700 space-y-1">
                <span>Study duration (minutes)</span>
                <input
                  type="number"
                  min={1}
                  max={180}
                  step={1}
                  value={state.studyMinutes}
                  onChange={(event) =>
                    onApplySettings({
                      studyMinutes: Number(event.target.value),
                      breakEnabled: state.breakEnabled,
                      breakMinutes: state.breakMinutes,
                    })
                  }
                  className="field-select w-full"
                />
              </label>
              <label className="text-sm text-zinc-700 space-y-1">
                <span>Break duration (minutes)</span>
                <input
                  type="number"
                  min={1}
                  max={180}
                  step={1}
                  value={state.breakMinutes}
                  onChange={(event) =>
                    onApplySettings({
                      studyMinutes: state.studyMinutes,
                      breakEnabled: state.breakEnabled,
                      breakMinutes: Number(event.target.value),
                    })
                  }
                  disabled={!state.breakEnabled}
                  className="field-select w-full disabled:opacity-50"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={state.breakEnabled}
                  onChange={(event) =>
                    onApplySettings({
                      studyMinutes: state.studyMinutes,
                      breakEnabled: event.target.checked,
                      breakMinutes: state.breakMinutes,
                    })
                  }
                  className="h-4 w-4 accent-zinc-900"
                />
                Enable breaks
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={state.examMode}
                  onChange={onToggleExamMode}
                  className="h-4 w-4 accent-zinc-900"
                />
                Exam mode (analog clock only)
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="pill-btn" onClick={applySettings}>
                Apply settings
              </button>
              {state.status === "running" ? (
                <button type="button" className="pill-btn" onClick={onPause}>
                  Pause
                </button>
              ) : (
                <button type="button" className="pill-btn pill-btn-primary" onClick={onStart}>
                  Start
                </button>
              )}
              <button type="button" className="pill-btn" onClick={onReset}>
                Reset
              </button>
            </div>
          </div>
        )}
      </div>

      {isFullscreen && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button type="button" className="pill-btn" onClick={applySettings}>
            Apply settings
          </button>
          {state.status === "running" ? (
            <button type="button" className="pill-btn" onClick={onPause}>
              Pause
            </button>
          ) : (
            <button type="button" className="pill-btn pill-btn-primary" onClick={onStart}>
              Start
            </button>
          )}
          <button type="button" className="pill-btn" onClick={onReset}>
            Reset
          </button>
          <button type="button" className="pill-btn" onClick={onToggleExamMode}>
            {state.examMode ? "Disable exam mode" : "Enable exam mode"}
          </button>
        </div>
      )}
    </div>
  );
}
