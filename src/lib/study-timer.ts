export const STUDY_TIMER_STORAGE_KEY = "study-stats.study-timer.state.v1";

export type StudyTimerStatus = "idle" | "running" | "paused";
export type StudyTimerPhase = "study" | "break";

export interface StudyTimerState {
  status: StudyTimerStatus;
  phase: StudyTimerPhase;
  remainingSeconds: number;
  phaseEndAt: number | null;
  studyMinutes: number;
  breakEnabled: boolean;
  breakMinutes: number;
  examMode: boolean;
  completedStudyCycles: number;
}

function clampMinutes(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(180, Math.round(value)));
}

function clampSeconds(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(3600 * 24, Math.round(value)));
}

export function defaultStudyTimerState(): StudyTimerState {
  const studyMinutes = 50;
  return {
    status: "idle",
    phase: "study",
    remainingSeconds: studyMinutes * 60,
    phaseEndAt: null,
    studyMinutes,
    breakEnabled: true,
    breakMinutes: 10,
    examMode: false,
    completedStudyCycles: 0,
  };
}

export function normalizeStudyTimerState(raw: unknown): StudyTimerState {
  const fallback = defaultStudyTimerState();
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Partial<StudyTimerState>;

  const studyMinutes = clampMinutes(Number(value.studyMinutes), fallback.studyMinutes);
  const breakMinutes = clampMinutes(Number(value.breakMinutes), fallback.breakMinutes);
  const breakEnabled =
    typeof value.breakEnabled === "boolean" ? value.breakEnabled : fallback.breakEnabled;
  const phase = value.phase === "break" ? "break" : "study";
  const status =
    value.status === "running" || value.status === "paused" || value.status === "idle"
      ? value.status
      : fallback.status;
  const phaseEndAt = typeof value.phaseEndAt === "number" ? value.phaseEndAt : null;
  const defaultRemaining = (phase === "study" ? studyMinutes : breakMinutes) * 60;
  const remainingSeconds = clampSeconds(Number(value.remainingSeconds), defaultRemaining);
  const completedStudyCycles = Math.max(0, Math.round(Number(value.completedStudyCycles) || 0));
  const examMode = Boolean(value.examMode);

  return {
    status,
    phase,
    remainingSeconds,
    phaseEndAt: status === "running" ? phaseEndAt : null,
    studyMinutes,
    breakEnabled,
    breakMinutes,
    examMode,
    completedStudyCycles,
  };
}

export function readStudyTimerState(): StudyTimerState {
  if (typeof window === "undefined") return defaultStudyTimerState();
  try {
    const raw = window.localStorage.getItem(STUDY_TIMER_STORAGE_KEY);
    if (!raw) return defaultStudyTimerState();
    return normalizeStudyTimerState(JSON.parse(raw));
  } catch {
    return defaultStudyTimerState();
  }
}

export function writeStudyTimerState(state: StudyTimerState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STUDY_TIMER_STORAGE_KEY, JSON.stringify(state));
}

export function formatStudyTimerClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds
    ).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function studyTimerSidebarLabel(state: StudyTimerState): string {
  if (state.status === "idle") return "";
  const phaseLabel = state.phase === "study" ? "Study" : "Break";
  const statusLabel = state.status === "paused" ? "Paused" : phaseLabel;
  return `${statusLabel} ${formatStudyTimerClock(state.remainingSeconds)}`;
}

export function advanceStudyTimerState(
  state: StudyTimerState,
  nowMs = Date.now()
): StudyTimerState {
  if (state.status !== "running" || !state.phaseEndAt) return state;

  const next = { ...state };
  let phaseEndAt = next.phaseEndAt;
  let changed = false;

  while (phaseEndAt !== null && nowMs >= phaseEndAt) {
    changed = true;

    if (next.phase === "study") {
      next.completedStudyCycles += 1;
      if (next.breakEnabled && next.breakMinutes > 0) {
        next.phase = "break";
        next.remainingSeconds = next.breakMinutes * 60;
        phaseEndAt += next.breakMinutes * 60 * 1000;
      } else {
        next.phase = "study";
        next.remainingSeconds = next.studyMinutes * 60;
        phaseEndAt += next.studyMinutes * 60 * 1000;
      }
      continue;
    }

    next.phase = "study";
    next.remainingSeconds = next.studyMinutes * 60;
    phaseEndAt += next.studyMinutes * 60 * 1000;
  }

  if (phaseEndAt === null) {
    return {
      ...next,
      status: "paused",
      phaseEndAt: null,
    };
  }

  const remainingSeconds = Math.max(0, Math.ceil((phaseEndAt - nowMs) / 1000));
  if (remainingSeconds !== next.remainingSeconds) {
    changed = true;
    next.remainingSeconds = remainingSeconds;
  }

  next.phaseEndAt = phaseEndAt;
  return changed ? next : state;
}

export function startStudyTimer(state: StudyTimerState, nowMs = Date.now()): StudyTimerState {
  const next = advanceStudyTimerState(state, nowMs);
  if (next.status === "running" && next.phaseEndAt) return next;

  const baseRemaining =
    next.status === "idle"
      ? next.studyMinutes * 60
      : Math.max(1, next.remainingSeconds);

  return {
    ...next,
    status: "running",
    phase: next.status === "idle" ? "study" : next.phase,
    remainingSeconds: baseRemaining,
    phaseEndAt: nowMs + baseRemaining * 1000,
  };
}

export function pauseStudyTimer(state: StudyTimerState, nowMs = Date.now()): StudyTimerState {
  const next = advanceStudyTimerState(state, nowMs);
  if (next.status !== "running") return next;
  return {
    ...next,
    status: "paused",
    phaseEndAt: null,
  };
}

export function resetStudyTimer(state: StudyTimerState): StudyTimerState {
  return {
    ...state,
    status: "idle",
    phase: "study",
    remainingSeconds: state.studyMinutes * 60,
    phaseEndAt: null,
    completedStudyCycles: 0,
  };
}

export function applyStudyTimerSettings(
  state: StudyTimerState,
  updates: {
    studyMinutes: number;
    breakEnabled: boolean;
    breakMinutes: number;
  }
): StudyTimerState {
  const studyMinutes = clampMinutes(updates.studyMinutes, state.studyMinutes);
  const breakEnabled = updates.breakEnabled;
  const breakMinutes = clampMinutes(updates.breakMinutes, state.breakMinutes);

  if (state.status === "running") {
    return {
      ...state,
      studyMinutes,
      breakEnabled,
      breakMinutes,
    };
  }

  const phaseDuration =
    state.phase === "study" ? studyMinutes * 60 : Math.max(1, breakMinutes * 60);

  return {
    ...state,
    studyMinutes,
    breakEnabled,
    breakMinutes,
    remainingSeconds: phaseDuration,
    phaseEndAt: null,
  };
}
