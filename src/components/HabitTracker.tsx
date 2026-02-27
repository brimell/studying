"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  HabitCompletionDay,
  HabitDefinition,
  HabitMode,
  HabitTrackerData,
  TrackerCalendarOption,
} from "@/lib/types";
import { DEFAULT_SUBJECTS } from "@/lib/types";
import { isStale, readCache, writeCache, writeGlobalLastFetched } from "@/lib/client-cache";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/scroll-lock";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TRACKER_CALENDAR_STORAGE_KEY = "study-stats.tracker-calendar-id";
const HABIT_WEEKS_STORAGE_KEY = "study-stats.habit-tracker.weeks";
const TRACKER_CALENDARS_CACHE_KEY = "study-stats:habit-tracker:calendars";
const MILESTONES_STORAGE_KEY = "study-stats.habit-tracker.milestones";
const HABIT_SOURCE_CALENDARS_STORAGE_KEY = "study-stats.habit-tracker.new-habit.sources";
const HABIT_MATCH_TERMS_STORAGE_KEY = "study-stats.habit-tracker.new-habit.match-terms";
const HABIT_COLORS_STORAGE_KEY = "study-stats.habit-tracker.colors";
const HABIT_WORKOUT_LINKS_STORAGE_KEY = "study-stats.habit-tracker.workout-links";
const HABIT_SHOW_FUTURE_DAYS_STORAGE_KEY = "study-stats.habit-tracker.show-future-days";
const HABIT_FUTURE_PREVIEW_SETTINGS_STORAGE_KEY = "study-stats.habit-tracker.future-preview";
const HABIT_ORDER_STORAGE_KEY = "study-stats.habit-tracker.order";
const STUDY_HABIT_STORAGE_KEY = "study-stats.habit-tracker.study-habit";
const PROJECTION_EXAM_DATE_STORAGE_KEY = "study-stats.projection.exam-date";
const OPEN_ADD_HABIT_EVENT = "study-stats:open-add-habit";
const OPEN_ADD_MILESTONE_EVENT = "study-stats:open-add-milestone";
const DEFAULT_CUSTOM_FUTURE_PREVIEW_DAYS = 35;
const DEFAULT_STUDY_HABIT_NAME = "Studying";
const DEFAULT_GYM_HABIT_NAME = "Gym";
const DEFAULT_HABITS = [
  {
    key: "studying",
    name: DEFAULT_STUDY_HABIT_NAME,
    mode: "duration" as HabitMode,
    description: "Linked to studying cards",
  },
  {
    key: "gym",
    name: DEFAULT_GYM_HABIT_NAME,
    mode: "binary" as HabitMode,
    description: "Can be linked to workout planner logs",
  },
] as const;
const DEFAULT_STUDY_MATCH_TERMS_DICTIONARY = Object.entries(DEFAULT_SUBJECTS)
  .map(([subject, terms]) => `${subject}: ${terms.join(", ")}`)
  .join("\n");
const HABIT_COLOR_PRESETS = [
  "#10b981",
  "#0ea5e9",
  "#f97316",
  "#a855f7",
  "#22c55e",
  "#ef4444",
  "#14b8a6",
  "#eab308",
] as const;
const DEFAULT_HABIT_COLORS = [...HABIT_COLOR_PRESETS];
const HABIT_COLOR_OPTIONS: { value: (typeof HABIT_COLOR_PRESETS)[number]; label: string }[] = [
  { value: "#10b981", label: "Emerald" },
  { value: "#0ea5e9", label: "Sky" },
  { value: "#f97316", label: "Orange" },
  { value: "#a855f7", label: "Violet" },
  { value: "#22c55e", label: "Green" },
  { value: "#ef4444", label: "Red" },
  { value: "#14b8a6", label: "Teal" },
  { value: "#eab308", label: "Amber" },
];
const BINARY_COMPLETED_COLOR_CLASS: Record<(typeof HABIT_COLOR_PRESETS)[number], string> = {
  "#10b981": "bg-emerald-500",
  "#0ea5e9": "bg-sky-500",
  "#f97316": "bg-orange-500",
  "#a855f7": "bg-violet-500",
  "#22c55e": "bg-green-500",
  "#ef4444": "bg-red-500",
  "#14b8a6": "bg-teal-500",
  "#eab308": "bg-amber-500",
};

interface TrackerCalendarResponse {
  trackerCalendars: TrackerCalendarOption[];
  sourceCalendars: TrackerCalendarOption[];
  defaultTrackerCalendarId: string | null;
  defaultSourceCalendarIds: string[];
}

interface MilestoneDate {
  id: string;
  type: "exam" | "coursework";
  title: string;
  date: string;
}

interface WorkoutLinkEntry {
  name: string;
  enabled: boolean;
}

interface QueuedHabitDayUpdate {
  trackerCalendarId: string;
  habitName: string;
  habitMode: HabitMode;
  date: string;
  completed: boolean;
  hours: number;
}

interface MatchTermDraftEntry {
  id: string;
  subject: string;
  terms: string;
}

type FuturePreviewMode = "auto" | "custom";
interface HabitFuturePreviewSetting {
  mode: FuturePreviewMode;
  customDays: number;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function withAlpha(hexColor: string, alpha: number): string {
  if (!isHexColor(hexColor)) return `rgba(16, 185, 129, ${alpha})`;
  const hex = hexColor.slice(1);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function getBlankCellColor(): string {
  return "rgba(113, 113, 122, 0.28)";
}

function getHeatCellColor(baseColor: string, level: 0 | 1 | 2 | 3 | 4): string {
  if (level === 0) return getBlankCellColor();
  const alphaByLevel: Record<0 | 1 | 2 | 3 | 4, number> = {
    0: 0.08,
    1: 0.22,
    2: 0.4,
    3: 0.6,
    4: 0.82,
  };
  return withAlpha(baseColor, alphaByLevel[level]);
}

function getFutureCellColor(): string {
  // Lighter than completed cells while still distinct from empty history cells.
  return "rgba(186, 196, 212, 0.72)";
}

function resolveDefaultHabitColor(slug: string, preferred = "#10b981"): string {
  const fromHash =
    DEFAULT_HABIT_COLORS[
      Math.abs(slug.split("").reduce((acc, character) => acc + character.charCodeAt(0), 0)) %
        DEFAULT_HABIT_COLORS.length
    ];
  return fromHash || preferred;
}

function getBinaryCompletedColorClass(color: string): string {
  if (color in BINARY_COMPLETED_COLOR_CLASS) {
    return BINARY_COMPLETED_COLOR_CLASS[color as keyof typeof BINARY_COMPLETED_COLOR_CLASS];
  }
  return "bg-sky-500";
}

function formatShortDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
}

function slugifyHabitName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "habit";
}

function addDays(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function addMonths(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCMonth(date.getUTCMonth() + amount);
  // If month math overflows (e.g. Jan 31 -> May 1), clamp to last day of target month.
  if (date.getUTCDate() !== day) {
    date.setUTCDate(0);
  }
  return date.toISOString().slice(0, 10);
}

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseMilestonesSerialized(raw: string | null): MilestoneDate[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter((item): item is MilestoneDate => {
      return (
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "type" in item &&
        "title" in item &&
        "date" in item &&
        typeof item.id === "string" &&
        (item.type === "exam" || item.type === "coursework") &&
        typeof item.title === "string" &&
        typeof item.date === "string" &&
        isValidDateInput(item.date)
      );
    });
    return valid.sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function readMilestonesFromStorage(): MilestoneDate[] {
  const raw = window.localStorage.getItem(MILESTONES_STORAGE_KEY);
  return parseMilestonesSerialized(raw);
}

function toHabitLevel(hours: number): 0 | 1 | 2 | 3 | 4 {
  if (hours <= 0) return 0;
  if (hours < 1) return 1;
  if (hours < 3) return 2;
  if (hours < 5) return 3;
  return 4;
}

function normalizeHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(Math.min(24, hours) * 100) / 100;
}

function normalizeHabitName(name: string): string {
  return name.trim().toLowerCase();
}

function clampFuturePreviewDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CUSTOM_FUTURE_PREVIEW_DAYS;
  return Math.max(1, Math.min(365, Math.round(value)));
}

function createMatchTermDraftEntry(subject = "", terms = ""): MatchTermDraftEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    subject,
    terms,
  };
}

function parseMatchTermsText(input: string): MatchTermDraftEntry[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [createMatchTermDraftEntry()];

  const entries: MatchTermDraftEntry[] = [];
  let lastSubjectEntryIndex = -1;
  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex >= 0) {
      const subject = line.slice(0, separatorIndex).trim();
      const terms = line.slice(separatorIndex + 1).trim();
      entries.push(createMatchTermDraftEntry(subject, terms));
      if (subject) {
        lastSubjectEntryIndex = entries.length - 1;
      }
      continue;
    }

    if (lastSubjectEntryIndex >= 0) {
      const existing = entries[lastSubjectEntryIndex];
      const nextTerms = [existing.terms, line].filter(Boolean).join(", ");
      entries[lastSubjectEntryIndex] = {
        ...existing,
        terms: nextTerms,
      };
      continue;
    }

    entries.push(createMatchTermDraftEntry("", line));
  }
  return entries.length > 0 ? entries : [createMatchTermDraftEntry()];
}

function serializeMatchTermsEntries(entries: MatchTermDraftEntry[]): string {
  return entries
    .map((entry) => {
      const subject = entry.subject.trim();
      const terms = entry.terms.trim();
      if (!subject && !terms) return "";
      if (subject) return `${subject}: ${terms}`;
      return terms;
    })
    .filter(Boolean)
    .join("\n");
}

function computeHabitStats(days: HabitCompletionDay[]) {
  let currentStreak = 0;
  let longestStreak = 0;
  let runningStreak = 0;
  let totalCompleted = 0;
  let totalHours = 0;

  for (const day of days) {
    totalHours += day.hours;
    if (day.completed) {
      runningStreak += 1;
      totalCompleted += 1;
      if (runningStreak > longestStreak) longestStreak = runningStreak;
    } else {
      runningStreak = 0;
    }
  }

  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (!days[i].completed) break;
    currentStreak += 1;
  }

  return {
    currentStreak,
    longestStreak,
    totalCompleted,
    totalHours: Math.round(totalHours * 100) / 100,
  };
}

function buildEmptyHabit(
  name: string,
  mode: HabitMode,
  startDate: string,
  endDate: string
): HabitDefinition {
  const days: HabitCompletionDay[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    days.push({ date, completed: false, hours: 0, level: 0 });
  }

  const stats = computeHabitStats(days);

  return {
    name,
    slug: slugifyHabitName(name),
    mode,
    trackingCalendarId: null,
    sourceCalendarIds: [],
    matchTerms: [],
    days,
    currentStreak: stats.currentStreak,
    longestStreak: stats.longestStreak,
    totalCompleted: stats.totalCompleted,
    totalHours: stats.totalHours,
  };
}

function buildWeeklyGrid<T extends { date: string }>(days: T[]): (T | null)[][] {
  if (days.length === 0) return [];

  const firstDate = new Date(`${days[0].date}T12:00:00`);
  const firstDayOfWeek = (firstDate.getDay() + 6) % 7;

  const paddedDays: (T | null)[] = [...Array(firstDayOfWeek).fill(null), ...days];

  const columns: (T | null)[][] = [];
  for (let i = 0; i < paddedDays.length; i += 7) {
    columns.push(paddedDays.slice(i, i + 7));
  }

  if (columns.length > 0) {
    const lastColumn = columns[columns.length - 1];
    while (lastColumn.length < 7) lastColumn.push(null);
  }

  return columns;
}

function buildGridMonthLabels<T extends { date: string }>(
  grid: (T | null)[][]
): { label: string; colIndex: number }[] {
  const labels: { label: string; colIndex: number }[] = [];
  let lastMonth = "";

  for (let col = 0; col < grid.length; col += 1) {
    const day = grid[col].find((entry) => entry !== null);
    if (!day) continue;

    const month = new Date(`${day.date}T12:00:00`).toLocaleDateString("en-GB", {
      month: "short",
    });

    if (month !== lastMonth) {
      labels.push({ label: month, colIndex: col });
      lastMonth = month;
    }
  }

  return labels;
}

function updateHabitInData(
  previous: HabitTrackerData,
  habitName: string,
  updater: (habit: HabitDefinition) => HabitDefinition
): HabitTrackerData {
  const habits = previous.habits.map((habit) =>
    habit.name.toLowerCase() === habitName.toLowerCase() ? updater(habit) : habit
  );

  return {
    ...previous,
    habits,
  };
}

export default function HabitTracker() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [data, setData] = useState<HabitTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(20);
  const [selectedStudyHabitSlug, setSelectedStudyHabitSlug] = useState<string | null>(null);

  const [calendars, setCalendars] = useState<TrackerCalendarOption[]>([]);
  const [sourceCalendars, setSourceCalendars] = useState<TrackerCalendarOption[]>([]);
  const [calendarsLoading, setCalendarsLoading] = useState(true);
  const [selectedTrackerCalendarId, setSelectedTrackerCalendarId] = useState<string | null>(null);

  const [newHabitName, setNewHabitName] = useState("");
  const [newHabitMode, setNewHabitMode] = useState<HabitMode>("binary");
  const [newHabitTrackingCalendarId, setNewHabitTrackingCalendarId] = useState<string | null>(null);
  const [newHabitSourceCalendarIds, setNewHabitSourceCalendarIds] = useState<string[]>([]);
  const [newHabitMatchEntries, setNewHabitMatchEntries] = useState<MatchTermDraftEntry[]>([
    createMatchTermDraftEntry(),
  ]);
  const [habitTrackingCalendarDrafts, setHabitTrackingCalendarDrafts] = useState<
    Record<string, string | null>
  >({});
  const [habitSourceDrafts, setHabitSourceDrafts] = useState<Record<string, string[]>>({});
  const [habitTermsDrafts, setHabitTermsDrafts] = useState<
    Record<string, MatchTermDraftEntry[]>
  >({});
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [habitColorSyncMessage, setHabitColorSyncMessage] = useState<string | null>(null);
  const [habitColors, setHabitColors] = useState<Record<string, string>>({});
  const [habitWorkoutLinks, setHabitWorkoutLinks] = useState<Record<string, WorkoutLinkEntry>>({});
  const [habitShowFutureDays, setHabitShowFutureDays] = useState<Record<string, boolean>>({});
  const [habitFuturePreviewSettings, setHabitFuturePreviewSettings] = useState<
    Record<string, HabitFuturePreviewSetting>
  >({});
  const [habitOrder, setHabitOrder] = useState<string[]>([]);
  const [draggingHabitSlug, setDraggingHabitSlug] = useState<string | null>(null);
  const [dragOverHabitSlug, setDragOverHabitSlug] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<MilestoneDate[]>([]);
  const [newMilestoneType, setNewMilestoneType] = useState<"exam" | "coursework">("exam");
  const [newMilestoneTitle, setNewMilestoneTitle] = useState("");
  const [newMilestoneDate, setNewMilestoneDate] = useState("");
  const [projectionExamDate, setProjectionExamDate] = useState<string | null>(null);
  const [cloudExamDate, setCloudExamDate] = useState<string | null>(null);
  const [showAddMilestoneModal, setShowAddMilestoneModal] = useState(false);
  const [showAddHabitModal, setShowAddHabitModal] = useState(false);
  const [editingBinaryHabitSlug, setEditingBinaryHabitSlug] = useState<string | null>(null);
  const [editingDurationHabitSlug, setEditingDurationHabitSlug] = useState<string | null>(null);
  const [activeHabitSettingsSlug, setActiveHabitSettingsSlug] = useState<string | null>(null);
  const habitDayQueueRef = useRef<QueuedHabitDayUpdate[]>([]);
  const habitDayQueueRunningRef = useRef(false);
  const milestoneSyncTimeoutRef = useRef<number | null>(null);
  const milestonesReadyToPersistRef = useRef(false);
  const milestonesCloudHydratedRef = useRef(false);
  const localSettingsPersistTimeoutRef = useRef<number | null>(null);
  const localSettingsPersistReadyRef = useRef(false);
  const lastMilestoneSnapshotRef = useRef("");
  const milestonesHydratedRef = useRef(false);
  const habitColorsSyncTimeoutRef = useRef<number | null>(null);
  const habitColorsSyncMessageTimeoutRef = useRef<number | null>(null);
  const lastHabitColorsSnapshotRef = useRef("");
  const habitColorsHydratedRef = useRef(false);
  const hasOpenModal =
    showAddMilestoneModal ||
    showAddHabitModal ||
    editingBinaryHabitSlug !== null ||
    editingDurationHabitSlug !== null ||
    activeHabitSettingsSlug !== null;

  useEffect(() => {
    if (!hasOpenModal) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [hasOpenModal]);

  useEffect(() => {
    const onOpenAddHabit = () => setShowAddHabitModal(true);
    const onOpenAddMilestone = () => setShowAddMilestoneModal(true);
    window.addEventListener(OPEN_ADD_HABIT_EVENT, onOpenAddHabit);
    window.addEventListener(OPEN_ADD_MILESTONE_EVENT, onOpenAddMilestone);
    return () => {
      window.removeEventListener(OPEN_ADD_HABIT_EVENT, onOpenAddHabit);
      window.removeEventListener(OPEN_ADD_MILESTONE_EVENT, onOpenAddMilestone);
    };
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(HABIT_WEEKS_STORAGE_KEY);
    if (!raw) return;
    const parsed = Number(raw);
    if ([12, 20, 26, 52].includes(parsed)) setWeeks(parsed);

    const storedStudyHabitSlug = window.localStorage.getItem(STUDY_HABIT_STORAGE_KEY);
    if (storedStudyHabitSlug) setSelectedStudyHabitSlug(storedStudyHabitSlug);
  }, []);

  useEffect(() => {
    const rawCalendars = window.localStorage.getItem(HABIT_SOURCE_CALENDARS_STORAGE_KEY);
    if (rawCalendars) {
      try {
        const parsed = JSON.parse(rawCalendars) as unknown;
        if (Array.isArray(parsed)) {
          setNewHabitSourceCalendarIds(
            parsed.filter((value): value is string => typeof value === "string")
          );
        }
      } catch {
        // Ignore malformed localStorage payload.
      }
    }

    const rawTerms = window.localStorage.getItem(HABIT_MATCH_TERMS_STORAGE_KEY);
    if (rawTerms) setNewHabitMatchEntries(parseMatchTermsText(rawTerms));
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(HABIT_COLORS_STORAGE_KEY);
    const next: Record<string, string> = {};
    try {
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof key !== "string" || typeof value !== "string") continue;
            if (!isHexColor(value)) continue;
            next[key] = value;
          }
        }
      }
    } catch {
      // Ignore malformed localStorage payload.
    } finally {
      setHabitColors(next);
      lastHabitColorsSnapshotRef.current = JSON.stringify(next);
      habitColorsHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    const serialized = JSON.stringify(habitColors);

    if (!supabase) return;
    if (!habitColorsHydratedRef.current) return;
    if (serialized === lastHabitColorsSnapshotRef.current) return;

    if (habitColorsSyncTimeoutRef.current) {
      window.clearTimeout(habitColorsSyncTimeoutRef.current);
    }

    habitColorsSyncTimeoutRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (!token) return;

          const readResponse = await fetch("/api/account-sync", {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (!readResponse.ok) return;

          const readJson = (await readResponse.json()) as { payload?: Record<string, string> };
          const existing = readJson.payload || {};
          if (existing[HABIT_COLORS_STORAGE_KEY] === serialized) {
            lastHabitColorsSnapshotRef.current = serialized;
            return;
          }

          const writeResponse = await fetch("/api/account-sync", {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              payload: {
                ...existing,
                [HABIT_COLORS_STORAGE_KEY]: serialized,
              },
            }),
          });

          if (!writeResponse.ok) return;
          lastHabitColorsSnapshotRef.current = serialized;
          setHabitColorSyncMessage("Habit colors synced to cloud.");
          if (habitColorsSyncMessageTimeoutRef.current) {
            window.clearTimeout(habitColorsSyncMessageTimeoutRef.current);
          }
          habitColorsSyncMessageTimeoutRef.current = window.setTimeout(() => {
            setHabitColorSyncMessage(null);
            habitColorsSyncMessageTimeoutRef.current = null;
          }, 2500);
        } catch {
          // Keep localStorage as source of truth if cloud sync fails.
        }
      })();
    }, 600);

    return () => {
      if (habitColorsSyncTimeoutRef.current) {
        window.clearTimeout(habitColorsSyncTimeoutRef.current);
        habitColorsSyncTimeoutRef.current = null;
      }
    };
  }, [habitColors, supabase]);

  useEffect(() => {
    return () => {
      if (habitColorsSyncMessageTimeoutRef.current) {
        window.clearTimeout(habitColorsSyncMessageTimeoutRef.current);
        habitColorsSyncMessageTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(HABIT_WORKOUT_LINKS_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const next: Record<string, WorkoutLinkEntry> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof key !== "string") continue;
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const name = (value as { name?: unknown }).name;
        const enabled = (value as { enabled?: unknown }).enabled;
        if (typeof name !== "string" || typeof enabled !== "boolean") continue;
        next[key] = { name, enabled };
      }
      setHabitWorkoutLinks(next);
    } catch {
      // Ignore malformed localStorage payload.
    }
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(HABIT_SHOW_FUTURE_DAYS_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof key !== "string" || typeof value !== "boolean") continue;
        next[key] = value;
      }
      setHabitShowFutureDays(next);
    } catch {
      // Ignore malformed localStorage payload.
    }
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(HABIT_FUTURE_PREVIEW_SETTINGS_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const next: Record<string, HabitFuturePreviewSetting> = {};

      // New per-habit shape: { [slug]: { mode, customDays } }
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof key !== "string") continue;
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const mode = (value as { mode?: unknown }).mode;
        const customDays = (value as { customDays?: unknown }).customDays;
        if (mode !== "auto" && mode !== "custom") continue;
        if (typeof customDays !== "number") continue;
        next[key] = {
          mode,
          customDays: clampFuturePreviewDays(customDays),
        };
      }

      // Legacy global shape fallback: { mode, customDays }
      if (Object.keys(next).length === 0) {
        const mode = (parsed as { mode?: unknown }).mode;
        const customDays = (parsed as { customDays?: unknown }).customDays;
        if ((mode === "auto" || mode === "custom") && typeof customDays === "number") {
          const fallbackValue = {
            mode,
            customDays: clampFuturePreviewDays(customDays),
          } as HabitFuturePreviewSetting;
          setHabitFuturePreviewSettings((previous) => {
            if (!data?.habits?.length) return previous;
            const seeded: Record<string, HabitFuturePreviewSetting> = {};
            for (const habit of data.habits) {
              seeded[habit.slug] = fallbackValue;
            }
            return seeded;
          });
          return;
        }
      }

      setHabitFuturePreviewSettings(next);
    } catch {
      // Ignore malformed localStorage payload.
    }
  }, [data]);

  useEffect(() => {
    const raw = window.localStorage.getItem(HABIT_ORDER_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const next = parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
      setHabitOrder(next);
    } catch {
      // Ignore malformed localStorage payload.
    }
  }, []);

  const defaultHabitOrder = useMemo(() => {
    if (!data) return [];
    return [...data.habits]
      .sort((a, b) => {
        if (a.slug === selectedStudyHabitSlug) return -1;
        if (b.slug === selectedStudyHabitSlug) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((habit) => habit.slug);
  }, [data, selectedStudyHabitSlug]);

  useEffect(() => {
    if (!data) return;
    setHabitOrder((previous) => {
      const valid = new Set(data.habits.map((habit) => habit.slug));
      const filtered = previous.filter((slug) => valid.has(slug));
      const used = new Set(filtered);
      const missing = defaultHabitOrder.filter((slug) => !used.has(slug));
      const next = [...filtered, ...missing];
      if (next.length === previous.length && next.every((slug, index) => slug === previous[index])) {
        return previous;
      }
      return next;
    });
  }, [data, defaultHabitOrder]);

  const orderedHabits = useMemo(() => {
    if (!data) return [];
    const bySlug = new Map(data.habits.map((habit) => [habit.slug, habit]));
    const ordered = habitOrder
      .map((slug) => bySlug.get(slug))
      .filter((habit): habit is HabitDefinition => Boolean(habit));
    if (ordered.length === data.habits.length) return ordered;

    for (const slug of defaultHabitOrder) {
      const habit = bySlug.get(slug);
      if (!habit || ordered.some((entry) => entry.slug === slug)) continue;
      ordered.push(habit);
    }
    return ordered;
  }, [data, defaultHabitOrder, habitOrder]);

  const moveHabit = useCallback((sourceSlug: string, targetSlug: string) => {
    if (sourceSlug === targetSlug) return;
    setHabitOrder((previous) => {
      const sourceIndex = previous.indexOf(sourceSlug);
      const targetIndex = previous.indexOf(targetSlug);
      if (sourceIndex === -1 || targetIndex === -1) return previous;
      const next = [...previous];
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, sourceSlug);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!localSettingsPersistReadyRef.current) {
      localSettingsPersistReadyRef.current = true;
      return;
    }

    if (localSettingsPersistTimeoutRef.current) {
      window.clearTimeout(localSettingsPersistTimeoutRef.current);
    }

    localSettingsPersistTimeoutRef.current = window.setTimeout(() => {
      window.localStorage.setItem(HABIT_WEEKS_STORAGE_KEY, String(weeks));

      if (selectedStudyHabitSlug) {
        window.localStorage.setItem(STUDY_HABIT_STORAGE_KEY, selectedStudyHabitSlug);
      } else {
        window.localStorage.removeItem(STUDY_HABIT_STORAGE_KEY);
      }

      window.localStorage.setItem(
        HABIT_SOURCE_CALENDARS_STORAGE_KEY,
        JSON.stringify(newHabitSourceCalendarIds)
      );
      window.localStorage.setItem(
        HABIT_MATCH_TERMS_STORAGE_KEY,
        serializeMatchTermsEntries(newHabitMatchEntries)
      );
      window.localStorage.setItem(HABIT_COLORS_STORAGE_KEY, JSON.stringify(habitColors));
      window.localStorage.setItem(HABIT_WORKOUT_LINKS_STORAGE_KEY, JSON.stringify(habitWorkoutLinks));
      window.localStorage.setItem(
        HABIT_SHOW_FUTURE_DAYS_STORAGE_KEY,
        JSON.stringify(habitShowFutureDays)
      );
      window.localStorage.setItem(
        HABIT_FUTURE_PREVIEW_SETTINGS_STORAGE_KEY,
        JSON.stringify(habitFuturePreviewSettings)
      );
      window.localStorage.setItem(HABIT_ORDER_STORAGE_KEY, JSON.stringify(habitOrder));
    }, 140);

    return () => {
      if (localSettingsPersistTimeoutRef.current) {
        window.clearTimeout(localSettingsPersistTimeoutRef.current);
        localSettingsPersistTimeoutRef.current = null;
      }
    };
  }, [
    habitColors,
    habitFuturePreviewSettings,
    habitShowFutureDays,
    habitWorkoutLinks,
    habitOrder,
    newHabitMatchEntries,
    newHabitSourceCalendarIds,
    selectedStudyHabitSlug,
    weeks,
  ]);

  useEffect(() => {
    const initialMilestones = readMilestonesFromStorage();
    setMilestones(initialMilestones);
    lastMilestoneSnapshotRef.current = JSON.stringify(initialMilestones);
    milestonesHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!supabase) return;
    if (!milestonesHydratedRef.current) return;
    if (milestonesCloudHydratedRef.current) return;

    milestonesCloudHydratedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;

        const readResponse = await fetch("/api/account-sync", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!readResponse.ok) return;

        const readJson = (await readResponse.json()) as { payload?: Record<string, string> };
        const cloudSerialized = readJson.payload?.[MILESTONES_STORAGE_KEY];
        const cloudMilestones = parseMilestonesSerialized(
          typeof cloudSerialized === "string" ? cloudSerialized : null
        );
        const localMilestones = readMilestonesFromStorage();
        const localSerialized = JSON.stringify(localMilestones);
        const cloudNormalizedSerialized = JSON.stringify(cloudMilestones);

        // Prefer local if it exists on this device; cloud is used to hydrate new/empty devices.
        if (localMilestones.length > 0) {
          if (cloudNormalizedSerialized === localSerialized) {
            lastMilestoneSnapshotRef.current = localSerialized;
            return;
          }

          const writeResponse = await fetch("/api/account-sync", {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              payload: {
                ...(readJson.payload || {}),
                [MILESTONES_STORAGE_KEY]: localSerialized,
              },
            }),
          });
          if (!writeResponse.ok) return;
          lastMilestoneSnapshotRef.current = localSerialized;
          return;
        }

        if (cloudMilestones.length === 0) return;
        if (cancelled) return;

        window.localStorage.setItem(MILESTONES_STORAGE_KEY, cloudNormalizedSerialized);
        setMilestones(cloudMilestones);
        lastMilestoneSnapshotRef.current = cloudNormalizedSerialized;
        window.dispatchEvent(new CustomEvent("study-stats:milestones-updated"));
      } catch {
        // Keep localStorage as source of truth if cloud hydration fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!milestonesHydratedRef.current) return;
    if (!milestonesReadyToPersistRef.current) {
      milestonesReadyToPersistRef.current = true;
      return;
    }

    const serialized = JSON.stringify(milestones);
    const previousSerialized = window.localStorage.getItem(MILESTONES_STORAGE_KEY);
    const changed = previousSerialized !== serialized;

    if (changed) {
      window.localStorage.setItem(MILESTONES_STORAGE_KEY, serialized);
      window.dispatchEvent(new CustomEvent("study-stats:milestones-updated"));
    }

    if (!supabase) return;
    if (serialized === lastMilestoneSnapshotRef.current) return;

    if (milestoneSyncTimeoutRef.current) {
      window.clearTimeout(milestoneSyncTimeoutRef.current);
    }

    milestoneSyncTimeoutRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (!token) return;

          const readResponse = await fetch("/api/account-sync", {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (!readResponse.ok) return;

          const readJson = (await readResponse.json()) as { payload?: Record<string, string> };
          const existing = readJson.payload || {};
          if (existing[MILESTONES_STORAGE_KEY] === serialized) {
            lastMilestoneSnapshotRef.current = serialized;
            return;
          }

          const writeResponse = await fetch("/api/account-sync", {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              payload: {
                ...existing,
                [MILESTONES_STORAGE_KEY]: serialized,
              },
            }),
          });

          if (!writeResponse.ok) return;
          lastMilestoneSnapshotRef.current = serialized;
        } catch {
          // Keep localStorage as source of truth if cloud sync fails.
        }
      })();
    }, 600);

    return () => {
      if (milestoneSyncTimeoutRef.current) {
        window.clearTimeout(milestoneSyncTimeoutRef.current);
        milestoneSyncTimeoutRef.current = null;
      }
    };
  }, [milestones, supabase]);

  const dataCacheKey = useMemo(
    () => `study-stats:habit-tracker:${weeks}:${selectedTrackerCalendarId || "auto"}`,
    [weeks, selectedTrackerCalendarId]
  );

  useEffect(() => {
    let cancelled = false;

    const loadCalendars = async () => {
      try {
        setCalendarsLoading(true);

        const cached = readCache<TrackerCalendarResponse>(TRACKER_CALENDARS_CACHE_KEY);
        if (cached) {
          const trackerCalendarData =
            cached.data.trackerCalendars ||
            (cached.data as unknown as { calendars?: TrackerCalendarOption[] }).calendars ||
            [];
          const sourceCalendarData = cached.data.sourceCalendars || [];
          setCalendars(trackerCalendarData);
          setSourceCalendars(sourceCalendarData);

          const storedCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
          const storedIsValid =
            storedCalendarId &&
            trackerCalendarData.some((entry) => entry.id === storedCalendarId);

          const nextSelectedId =
            (storedIsValid
              ? storedCalendarId
              : cached.data.defaultTrackerCalendarId ||
                (cached.data as unknown as { defaultCalendarId?: string | null })
                  .defaultCalendarId) || null;

          setSelectedTrackerCalendarId(nextSelectedId);

          if (newHabitSourceCalendarIds.length === 0) {
            const defaults = cached.data.defaultSourceCalendarIds || [];
            if (defaults.length > 0) setNewHabitSourceCalendarIds(defaults);
          }

          if (!isStale(cached.fetchedAt)) {
            setCalendarsLoading(false);
            return;
          }
        }

        const response = await fetch("/api/habit-tracker/calendars");
        const payload = (await response.json()) as TrackerCalendarResponse | { error?: string };

        if (!response.ok) {
          const message = "error" in payload ? payload.error : "Failed to fetch calendars";
          throw new Error(message || "Failed to fetch calendars");
        }

        if (cancelled) return;

        const typedPayload = payload as TrackerCalendarResponse;
        const trackerCalendarData = typedPayload.trackerCalendars;
        setCalendars(trackerCalendarData);
        setSourceCalendars(typedPayload.sourceCalendars);
        writeCache(TRACKER_CALENDARS_CACHE_KEY, typedPayload);

        const storedCalendarId = window.localStorage.getItem(TRACKER_CALENDAR_STORAGE_KEY);
        const storedIsValid =
          storedCalendarId &&
          trackerCalendarData.some((entry) => entry.id === storedCalendarId);

        const nextSelectedId =
          (storedIsValid
            ? storedCalendarId
            : typedPayload.defaultTrackerCalendarId) || null;

        setSelectedTrackerCalendarId(nextSelectedId);
        if (newHabitSourceCalendarIds.length === 0 && typedPayload.defaultSourceCalendarIds.length > 0) {
          setNewHabitSourceCalendarIds(typedPayload.defaultSourceCalendarIds);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to fetch calendars";
        setActionError(message);
      } finally {
        if (!cancelled) setCalendarsLoading(false);
      }
    };

    loadCalendars();

    return () => {
      cancelled = true;
    };
  }, [newHabitSourceCalendarIds.length]);

  useEffect(() => {
    if (!selectedTrackerCalendarId) return;
    window.localStorage.setItem(TRACKER_CALENDAR_STORAGE_KEY, selectedTrackerCalendarId);
  }, [selectedTrackerCalendarId]);

  useEffect(() => {
    if (!newHabitTrackingCalendarId && selectedTrackerCalendarId) {
      setNewHabitTrackingCalendarId(selectedTrackerCalendarId);
    }
  }, [newHabitTrackingCalendarId, selectedTrackerCalendarId]);

  useEffect(() => {
    if (sourceCalendars.length === 0) return;
    const validIds = new Set(sourceCalendars.map((entry) => entry.id));
    setNewHabitSourceCalendarIds((previous) => previous.filter((id) => validIds.has(id)));
  }, [sourceCalendars]);

  useEffect(() => {
    if (calendars.length === 0) return;
    if (newHabitTrackingCalendarId && calendars.some((entry) => entry.id === newHabitTrackingCalendarId)) {
      return;
    }
    setNewHabitTrackingCalendarId(selectedTrackerCalendarId || calendars[0].id);
  }, [calendars, newHabitTrackingCalendarId, selectedTrackerCalendarId]);

  useEffect(() => {
    if (calendarsLoading) return;

    let cancelled = false;

    const loadData = async (force = false) => {
      try {
        setError(null);

        const cached = readCache<HabitTrackerData>(dataCacheKey);
        if (cached) {
          setData(cached.data);
          if (!force && !isStale(cached.fetchedAt)) {
            setLoading(false);
            return;
          }
        }

        setLoading(true);

        const params = new URLSearchParams({ weeks: String(weeks) });
        if (selectedTrackerCalendarId) {
          params.set("trackerCalendarId", selectedTrackerCalendarId);
        }

        const response = await fetch(`/api/habit-tracker?${params.toString()}`);
        const payload = (await response.json()) as HabitTrackerData | { error?: string };

        if (!response.ok) {
          const message = "error" in payload ? payload.error : "Failed to fetch habit tracker";
          throw new Error(message || "Failed to fetch habit tracker");
        }

        if (cancelled) return;

        const typedPayload = payload as HabitTrackerData;
        setData(typedPayload);
        const fetchedAt = writeCache(dataCacheKey, typedPayload);
        writeGlobalLastFetched(fetchedAt);

        if (
          typedPayload.trackerCalendarId &&
          selectedTrackerCalendarId !== typedPayload.trackerCalendarId
        ) {
          setSelectedTrackerCalendarId(typedPayload.trackerCalendarId);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to fetch habit tracker";
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadData(true);

    return () => {
      cancelled = true;
    };
  }, [weeks, selectedTrackerCalendarId, calendarsLoading, dataCacheKey]);

  const selectedStudyHabit = useMemo(() => {
    if (!data) return null;
    if (selectedStudyHabitSlug) {
      const directMatch = data.habits.find((habit) => habit.slug === selectedStudyHabitSlug);
      if (directMatch && directMatch.mode === "duration") return directMatch;
    }
    return (
      data.habits.find((habit) => habit.name.trim().toLowerCase() === "studying") ||
      data.habits.find((habit) => habit.mode === "duration") ||
      data.habits[0] ||
      null
    );
  }, [data, selectedStudyHabitSlug]);

  const examAwareStudyHabitSlug = useMemo(
    () => selectedStudyHabit?.slug || null,
    [selectedStudyHabit]
  );

  const editingDurationHabit = useMemo(() => {
    if (!data || !editingDurationHabitSlug) return null;
    return data.habits.find((habit) => habit.slug === editingDurationHabitSlug) || null;
  }, [data, editingDurationHabitSlug]);
  const editingBinaryHabit = useMemo(() => {
    if (!data || !editingBinaryHabitSlug) return null;
    return data.habits.find((habit) => habit.slug === editingBinaryHabitSlug) || null;
  }, [data, editingBinaryHabitSlug]);
  const activeHabitSettings = useMemo(() => {
    if (!data || !activeHabitSettingsSlug) return null;
    return data.habits.find((habit) => habit.slug === activeHabitSettingsSlug) || null;
  }, [activeHabitSettingsSlug, data]);

  useEffect(() => {
    if (!data) return;
    setHabitColors((previous) => {
      const next: Record<string, string> = {};
      let changed = false;

      for (const habit of data.habits) {
        const existing = previous[habit.slug];
        if (existing && isHexColor(existing)) {
          next[habit.slug] = existing;
          continue;
        }
        const defaultColor =
          habit.name.toLowerCase() === "studying"
            ? "#10b981"
            : resolveDefaultHabitColor(habit.slug);
        next[habit.slug] = defaultColor;
        changed = true;
      }

      for (const key of Object.keys(previous)) {
        if (!(key in next)) changed = true;
      }

      return changed ? next : previous;
    });
  }, [data]);

  useEffect(() => {
    if (!data) return;
    setHabitShowFutureDays((previous) => {
      const next: Record<string, boolean> = {};
      let changed = false;

      for (const habit of data.habits) {
        if (typeof previous[habit.slug] === "boolean") {
          next[habit.slug] = previous[habit.slug];
          continue;
        }
        next[habit.slug] = habit.slug === examAwareStudyHabitSlug;
        changed = true;
      }

      for (const key of Object.keys(previous)) {
        if (!(key in next)) changed = true;
      }

      return changed ? next : previous;
    });
  }, [data, examAwareStudyHabitSlug]);

  useEffect(() => {
    if (!data) return;
    setHabitWorkoutLinks((previous) => {
      const next: Record<string, WorkoutLinkEntry> = {};
      let changed = false;

      for (const habit of data.habits) {
        if (habit.mode !== "binary") continue;
        const existing = previous[habit.slug];
        if (existing) {
          const normalizedName =
            existing.name.trim().toLowerCase() === habit.name.trim().toLowerCase()
              ? existing.name
              : habit.name;
          next[habit.slug] = { name: normalizedName, enabled: existing.enabled };
          if (normalizedName !== existing.name) changed = true;
          continue;
        }

        const isDefaultGymLink = habit.name.trim().toLowerCase() === "gym";
        next[habit.slug] = { name: habit.name, enabled: isDefaultGymLink };
        if (isDefaultGymLink) changed = true;
      }

      for (const key of Object.keys(previous)) {
        if (!(key in next)) changed = true;
      }

      return changed ? next : previous;
    });
  }, [data]);

  const studyExamDateSet = useMemo(() => {
    const dates = new Set<string>();
    for (const milestone of milestones) {
      if (milestone.type !== "exam") continue;
      dates.add(milestone.date);
    }
    if (projectionExamDate) dates.add(projectionExamDate);
    if (cloudExamDate) dates.add(cloudExamDate);
    return dates;
  }, [cloudExamDate, milestones, projectionExamDate]);

  const latestExamDate = useMemo(() => {
    let latest = "";
    for (const date of studyExamDateSet) {
      if (date > latest) latest = date;
    }
    return latest;
  }, [studyExamDateSet]);
  const activeHabitFuturePreview = useMemo(() => {
    if (!activeHabitSettings) return null;
    return (
      habitFuturePreviewSettings[activeHabitSettings.slug] || {
        mode: "auto" as FuturePreviewMode,
        customDays: DEFAULT_CUSTOM_FUTURE_PREVIEW_DAYS,
      }
    );
  }, [activeHabitSettings, habitFuturePreviewSettings]);
  const activeHabitColor = useMemo(() => {
    if (!activeHabitSettings) return null;
    return habitColors[activeHabitSettings.slug] && isHexColor(habitColors[activeHabitSettings.slug])
      ? habitColors[activeHabitSettings.slug]
      : resolveDefaultHabitColor(activeHabitSettings.slug);
  }, [activeHabitSettings, habitColors]);

  useEffect(() => {
    if (!data || data.habits.length === 0) return;
    if (!selectedStudyHabit) return;
    if (selectedStudyHabitSlug === selectedStudyHabit.slug) return;
    setSelectedStudyHabitSlug(selectedStudyHabit.slug);
  }, [data, selectedStudyHabit, selectedStudyHabitSlug]);

  const hasWritableCalendars = calendars.length > 0;
  const hasSourceCalendars = sourceCalendars.length > 0;
  const durationSourceOptions = hasSourceCalendars ? sourceCalendars : calendars;
  const habitNameSet = useMemo(() => {
    const next = new Set<string>();
    for (const habit of data?.habits || []) {
      next.add(normalizeHabitName(habit.name));
    }
    return next;
  }, [data]);

  const addMilestone = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValidDateInput(newMilestoneDate)) return;

    const title = newMilestoneTitle.trim();
    const milestone: MilestoneDate = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: newMilestoneType,
      title: title || (newMilestoneType === "exam" ? "Exam" : "Coursework"),
      date: newMilestoneDate,
    };

    setMilestones((previous) =>
      [...previous, milestone].sort((a, b) => a.date.localeCompare(b.date))
    );
    setNewMilestoneTitle("");
    setNewMilestoneDate("");
    setShowAddMilestoneModal(false);
  };

  const removeMilestone = (id: string) => {
    setMilestones((previous) => previous.filter((milestone) => milestone.id !== id));
  };

  const runAction = async (input: RequestInit) => {
    const response = await fetch("/api/habit-tracker", {
      ...input,
      headers: {
        "Content-Type": "application/json",
      },
    });

    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
  };

  const flushHabitDayQueue = useCallback(async () => {
    if (habitDayQueueRunningRef.current) return;
    habitDayQueueRunningRef.current = true;

    try {
      while (habitDayQueueRef.current.length > 0) {
        const next = habitDayQueueRef.current.shift();
        if (!next) continue;

        const response = await fetch("/api/habit-tracker", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(next),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error || "Failed to update habit");
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update habit";
      setActionError(message);
    } finally {
      habitDayQueueRunningRef.current = false;
      if (habitDayQueueRef.current.length > 0) {
        void flushHabitDayQueue();
      }
    }
  }, []);

  const enqueueHabitDayUpdate = useCallback(
    (update: QueuedHabitDayUpdate) => {
      const queue = habitDayQueueRef.current;
      const existingIndex = queue.findIndex(
        (entry) =>
          entry.trackerCalendarId === update.trackerCalendarId &&
          entry.habitName.toLowerCase() === update.habitName.toLowerCase() &&
          entry.habitMode === update.habitMode &&
          entry.date === update.date
      );

      if (existingIndex >= 0) {
        queue[existingIndex] = update;
      } else {
        queue.push(update);
      }

      void flushHabitDayQueue();
    },
    [flushHabitDayQueue]
  );

  const createHabit = useCallback(
    async (input: {
      habitName: string;
      habitMode: HabitMode;
      trackingCalendarId?: string | null;
      sourceCalendarIds?: string[];
      matchTerms?: string;
      closeModal?: boolean;
      onCreated?: (slug: string) => void;
      presetWorkoutLinkEnabled?: boolean;
    }) => {
      if (!selectedTrackerCalendarId) {
        setActionError("Select a writable tracking calendar first.");
        return false;
      }
      if (!data) {
        setActionError("Habit data is still loading. Try again in a moment.");
        return false;
      }

      const habitName = input.habitName.trim();
      if (!habitName) return false;
      const habitMode = input.habitMode;
      const sourceCalendarIds = habitMode === "duration" ? input.sourceCalendarIds || [] : [];
      const trackingCalendarId =
        habitMode === "binary"
          ? input.trackingCalendarId || newHabitTrackingCalendarId || selectedTrackerCalendarId
          : null;
      const matchTerms = habitMode === "duration" ? input.matchTerms || "" : "";

      if (habitMode === "duration" && sourceCalendarIds.length === 0) {
        setActionError("Select at least one calendar for time tracking habits.");
        return false;
      }

      if (data.habits.some((habit) => habit.name.toLowerCase() === habitName.toLowerCase())) {
        setActionError("Habit already exists.");
        return false;
      }

      const previousData = data;
      const previousWorkoutLinks = habitWorkoutLinks;
      const optimisticHabit = buildEmptyHabit(
        habitName,
        habitMode,
        data.trackerRange.startDate,
        data.trackerRange.endDate
      );
      optimisticHabit.trackingCalendarId = trackingCalendarId;
      optimisticHabit.sourceCalendarIds = [...sourceCalendarIds];
      optimisticHabit.matchTerms = matchTerms
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean);
      const nextData = {
        ...data,
        habits: [...data.habits, optimisticHabit],
      };

      if (typeof input.presetWorkoutLinkEnabled === "boolean" && habitMode === "binary") {
        setHabitWorkoutLinks((previous) => ({
          ...previous,
          [optimisticHabit.slug]: {
            name: habitName,
            enabled: input.presetWorkoutLinkEnabled as boolean,
          },
        }));
      }

      setData(nextData);
      writeCache(dataCacheKey, nextData);

      try {
        setActionLoading(true);
        setActionError(null);

        await runAction({
          method: "POST",
          body: JSON.stringify({
            trackerCalendarId: selectedTrackerCalendarId,
            habitName,
            habitMode,
            trackingCalendarId,
            sourceCalendarIds,
            matchTerms,
          }),
        });

        input.onCreated?.(optimisticHabit.slug);
        if (input.closeModal !== false) setShowAddHabitModal(false);
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to add habit";
        setActionError(message);
        setData(previousData);
        writeCache(dataCacheKey, previousData);
        setHabitWorkoutLinks(previousWorkoutLinks);
        return false;
      } finally {
        setActionLoading(false);
      }
    },
    [
      data,
      dataCacheKey,
      habitWorkoutLinks,
      newHabitTrackingCalendarId,
      selectedTrackerCalendarId,
    ]
  );

  const handleAddHabit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const habitName = newHabitName.trim();
    if (!habitName) return;

    const created = await createHabit({
      habitName,
      habitMode: newHabitMode,
      trackingCalendarId: newHabitTrackingCalendarId,
      sourceCalendarIds: newHabitSourceCalendarIds,
      matchTerms: serializeMatchTermsEntries(newHabitMatchEntries),
      closeModal: true,
    });

    if (created) {
      setNewHabitName("");
    }
  };

  const addDefaultHabit = async (defaultHabitKey: (typeof DEFAULT_HABITS)[number]["key"]) => {
    if (!selectedTrackerCalendarId) {
      setActionError("Select a writable tracking calendar first.");
      return;
    }
    if (!data) {
      setActionError("Habit data is still loading. Try again in a moment.");
      return;
    }
    const defaultHabit = DEFAULT_HABITS.find((entry) => entry.key === defaultHabitKey);
    if (!defaultHabit) return;
    if (habitNameSet.has(normalizeHabitName(defaultHabit.name))) {
      setActionError(`"${defaultHabit.name}" already exists.`);
      return;
    }

    if (defaultHabit.mode === "duration") {
      const sourceIds = newHabitSourceCalendarIds.length
        ? newHabitSourceCalendarIds
        : sourceCalendars.length > 0
          ? sourceCalendars.slice(0, 1).map((entry) => entry.id)
          : [selectedTrackerCalendarId];
      const created = await createHabit({
        habitName: defaultHabit.name,
        habitMode: "duration",
        sourceCalendarIds: sourceIds,
        matchTerms: DEFAULT_STUDY_MATCH_TERMS_DICTIONARY,
        closeModal: false,
      });
      if (created && !selectedStudyHabitSlug) {
        setSelectedStudyHabitSlug(slugifyHabitName(defaultHabit.name));
      }
      return;
    }

    await createHabit({
      habitName: defaultHabit.name,
      habitMode: "binary",
      trackingCalendarId: selectedTrackerCalendarId,
      closeModal: false,
      presetWorkoutLinkEnabled: false,
    });
  };

  const updateHabitDay = async (
    habitName: string,
    habitMode: HabitMode,
    date: string,
    nextValue: { completed?: boolean; hours?: number }
  ) => {
    if (!selectedTrackerCalendarId || !data) return;

    const hours =
      habitMode === "duration"
        ? normalizeHours(nextValue.hours || 0)
        : nextValue.completed
          ? 1
          : 0;
    const completed = habitMode === "duration" ? hours > 0 : Boolean(nextValue.completed);

    const nextData = updateHabitInData(data, habitName, (habit) => {
      const days = habit.days.map((day) =>
        day.date === date ? { ...day, completed, hours, level: toHabitLevel(hours) } : day
      );
      const stats = computeHabitStats(days);

      return {
        ...habit,
        days,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        totalCompleted: stats.totalCompleted,
        totalHours: stats.totalHours,
      };
    });
    setData(nextData);
    writeCache(dataCacheKey, nextData);

    setActionError(null);
    enqueueHabitDayUpdate({
      trackerCalendarId: selectedTrackerCalendarId,
      habitName,
      habitMode,
      date,
      completed,
      hours,
    });
  };

  const toggleHabit = async (habitName: string, date: string, completed: boolean) => {
    await updateHabitDay(habitName, "binary", date, { completed });
  };

  const updateDurationHabitConfig = async (
    habitName: string,
    sourceIds: string[],
    terms: string
  ): Promise<boolean> => {
    if (!selectedTrackerCalendarId || sourceIds.length === 0) {
      setActionError("Select at least one calendar for time tracking habits.");
      setActionSuccess(null);
      return false;
    }

    try {
      setActionLoading(true);
      setActionError(null);
      setActionSuccess(null);
      await runAction({
        method: "PUT",
        body: JSON.stringify({
          trackerCalendarId: selectedTrackerCalendarId,
          habitName,
          sourceCalendarIds: sourceIds,
          matchTerms: terms,
        }),
      });
      await refreshData();
      setActionSuccess("Tracking source saved and confirmed.");
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update habit settings";
      setActionError(message);
      setActionSuccess(null);
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const updateBinaryHabitConfig = async (
    habitName: string,
    trackingCalendarId: string
  ): Promise<boolean> => {
    if (!selectedTrackerCalendarId || !trackingCalendarId) {
      setActionError("Select a writable calendar for this habit.");
      setActionSuccess(null);
      return false;
    }

    try {
      setActionLoading(true);
      setActionError(null);
      setActionSuccess(null);
      await runAction({
        method: "PUT",
        body: JSON.stringify({
          trackerCalendarId: selectedTrackerCalendarId,
          habitName,
          trackingCalendarId,
        }),
      });
      await refreshData();
      setActionSuccess("Tracking source saved and confirmed.");
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update habit settings";
      setActionError(message);
      setActionSuccess(null);
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const removeHabit = async (habitName: string) => {
    if (!selectedTrackerCalendarId || !data) return;

    const previousData = data;

    const nextData = {
      ...data,
      habits: data.habits.filter(
        (habit) => habit.name.toLowerCase() !== habitName.toLowerCase()
      ),
    };
    setData(nextData);
    writeCache(dataCacheKey, nextData);

    try {
      setActionLoading(true);
      setActionError(null);

      await runAction({
        method: "DELETE",
        body: JSON.stringify({
          trackerCalendarId: selectedTrackerCalendarId,
          habitName,
        }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete habit";
      setActionError(message);
      setData(previousData);
      writeCache(dataCacheKey, previousData);
    } finally {
      setActionLoading(false);
    }
  };

  const refreshData = useCallback(async () => {
    if (calendarsLoading) return;

    try {
      setError(null);

      const params = new URLSearchParams({ weeks: String(weeks) });
      if (selectedTrackerCalendarId) {
        params.set("trackerCalendarId", selectedTrackerCalendarId);
      }

      const response = await fetch(`/api/habit-tracker?${params.toString()}`);
      const payload = (await response.json()) as HabitTrackerData | { error?: string };

      if (!response.ok) {
        const message = "error" in payload ? payload.error : "Failed to fetch habit tracker";
        throw new Error(message || "Failed to fetch habit tracker");
      }

      const typedPayload = payload as HabitTrackerData;
      setData(typedPayload);
      const fetchedAt = writeCache(dataCacheKey, typedPayload);
      writeGlobalLastFetched(fetchedAt);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch habit tracker";
      setError(message);
    }
  }, [calendarsLoading, dataCacheKey, selectedTrackerCalendarId, weeks]);

  useEffect(() => {
    const onRefreshAll = () => refreshData();
    window.addEventListener("study-stats:refresh-all", onRefreshAll);
    return () => window.removeEventListener("study-stats:refresh-all", onRefreshAll);
  }, [refreshData]);

  useEffect(() => {
    const onMilestonesUpdated = () =>
      setMilestones((previous) => {
        const next = readMilestonesFromStorage();
        return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
      });
    window.addEventListener("study-stats:milestones-updated", onMilestonesUpdated);
    return () => window.removeEventListener("study-stats:milestones-updated", onMilestonesUpdated);
  }, []);

  useEffect(() => {
    const onExamDateUpdated = () => {
      const raw = window.localStorage.getItem(PROJECTION_EXAM_DATE_STORAGE_KEY);
      setProjectionExamDate(raw && isValidDateInput(raw) ? raw : null);
    };

    onExamDateUpdated();
    window.addEventListener("study-stats:exam-date-updated", onExamDateUpdated);
    return () => window.removeEventListener("study-stats:exam-date-updated", onExamDateUpdated);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    const loadCloudExamDate = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          if (!cancelled) setCloudExamDate(null);
          return;
        }

        const response = await fetch("/api/exam-countdown", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) return;

        const payload = (await response.json()) as { examDate?: string | null };
        if (cancelled) return;
        setCloudExamDate(
          payload.examDate && isValidDateInput(payload.examDate) ? payload.examDate : null
        );
      } catch {
        // Keep local exam dates if cloud fetch fails.
      }
    };

    void loadCloudExamDate();
    const onRefresh = () => {
      void loadCloudExamDate();
    };
    window.addEventListener("study-stats:refresh-all", onRefresh);
    window.addEventListener("study-stats:exam-date-updated", onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener("study-stats:refresh-all", onRefresh);
      window.removeEventListener("study-stats:exam-date-updated", onRefresh);
    };
  }, [supabase]);

  useEffect(() => {
    if (!data) return;
    const nextTrackingCalendars: Record<string, string | null> = {};
    const nextSources: Record<string, string[]> = {};
    const nextTerms: Record<string, MatchTermDraftEntry[]> = {};
    for (const habit of data.habits) {
      if (habit.mode === "binary") {
        nextTrackingCalendars[habit.slug] = habit.trackingCalendarId;
        continue;
      }
      const sourceIds = Array.isArray(habit.sourceCalendarIds) ? habit.sourceCalendarIds : [];
      const matchTerms = Array.isArray(habit.matchTerms) ? habit.matchTerms : [];
      nextSources[habit.slug] = sourceIds;
      nextTerms[habit.slug] = parseMatchTermsText(matchTerms.join("\n"));
    }
    setHabitTrackingCalendarDrafts(nextTrackingCalendars);
    setHabitSourceDrafts(nextSources);
    setHabitTermsDrafts(nextTerms);
  }, [data]);

  return (
    <div className="surface-card p-6">
      <div className="mb-2" />

      {loading && (
        <div className="h-40 flex items-center justify-center text-zinc-400 animate-pulse">
          Loading...
        </div>
      )}
      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {data && !loading && (
        <div className="space-y-3">
          <div className="border-t border-zinc-200 pt-4">
            {actionError && <p className="text-sm text-red-500 mb-3">{actionError}</p>}
            {actionSuccess && <p className="text-sm text-emerald-600 mb-3">{actionSuccess}</p>}
            {habitColorSyncMessage && (
              <p className="text-sm text-emerald-600 mb-3">{habitColorSyncMessage}</p>
            )}

            {!selectedTrackerCalendarId && (
              <p className="text-sm text-zinc-500">
                No writable tracking calendar is available. Connect Google Calendar and ensure at least one
                writable calendar exists.
              </p>
            )}

            {selectedTrackerCalendarId && data.habits.length === 0 && (
              <p className="text-sm text-zinc-500">No habits yet. Add one above to start tracking.</p>
            )}

            <div className="space-y-4">
              {orderedHabits.map((habit) => {
                const isExamAwareStudyHabit = habit.slug === examAwareStudyHabitSlug;
                const habitFuturePreview = habitFuturePreviewSettings[habit.slug] || {
                  mode: "auto" as FuturePreviewMode,
                  customDays: DEFAULT_CUSTOM_FUTURE_PREVIEW_DAYS,
                };
                const shouldShowFutureDays = Boolean(habitShowFutureDays[habit.slug]);
                const habitDaysForGrid =
                  shouldShowFutureDays
                    ? (() => {
                        const next = [...habit.days];
                        const lastTrackedDate =
                          next[next.length - 1]?.date || data.trackerRange.endDate;
                        const finalEndDate =
                          habitFuturePreview.mode === "custom"
                            ? addDays(
                                lastTrackedDate,
                                clampFuturePreviewDays(habitFuturePreview.customDays)
                              )
                            : isExamAwareStudyHabit &&
                                latestExamDate !== "" &&
                                latestExamDate > lastTrackedDate
                              ? latestExamDate
                              : addMonths(lastTrackedDate, 1);
                        for (
                          let date = addDays(lastTrackedDate, 1);
                          date <= finalEndDate;
                          date = addDays(date, 1)
                        ) {
                          next.push({
                            date,
                            completed: false,
                            hours: 0,
                            level: 0,
                          });
                        }
                        return next;
                      })()
                    : habit.days;

                const habitGrid = buildWeeklyGrid(habitDaysForGrid);
                const habitMonthLabels = buildGridMonthLabels(habitGrid);
                const habitColor =
                  habitColors[habit.slug] && isHexColor(habitColors[habit.slug])
                    ? habitColors[habit.slug]
                    : resolveDefaultHabitColor(habit.slug);

                return (
                  <div
                    key={habit.slug}
                    className={`rounded-xl border bg-zinc-50 p-3 ${
                      dragOverHabitSlug === habit.slug
                        ? "border-sky-400"
                        : "border-zinc-200"
                    }`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", habit.slug);
                      setDraggingHabitSlug(habit.slug);
                      setDragOverHabitSlug(null);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      if (draggingHabitSlug && draggingHabitSlug !== habit.slug) {
                        setDragOverHabitSlug(habit.slug);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceSlug = draggingHabitSlug || event.dataTransfer.getData("text/plain");
                      if (sourceSlug && sourceSlug !== habit.slug) {
                        moveHabit(sourceSlug, habit.slug);
                      }
                      setDraggingHabitSlug(null);
                      setDragOverHabitSlug(null);
                    }}
                    onDragEnd={() => {
                      setDraggingHabitSlug(null);
                      setDragOverHabitSlug(null);
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div>
                        <p className="font-medium text-sm flex items-center gap-2">
                          <span
                            className="cursor-grab active:cursor-grabbing select-none text-zinc-400"
                            title="Drag to reorder"
                            aria-hidden="true"
                          >
                            ↕
                          </span>
                          <span>{habit.name}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveHabitSettingsSlug(habit.slug)}
                          className="pill-btn px-2 py-0.5 text-xs"
                        >
                          Settings
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto pb-2">
                      <div className="flex ml-8 mb-1 relative" style={{ gap: 0 }}>
                        {habitMonthLabels.map((monthLabel) => (
                          <span
                            key={`${habit.slug}-${monthLabel.label}-${monthLabel.colIndex}`}
                            className="text-[10px] text-zinc-400 absolute"
                            style={{ left: `${monthLabel.colIndex * 16 + 32}px` }}
                          >
                            {monthLabel.label}
                          </span>
                        ))}
                      </div>

                      <div className="flex gap-[3px] mt-5">
                        <div className="flex flex-col gap-[3px] pr-1">
                          {DAY_LABELS.map((label, index) => (
                            <div
                              key={`${habit.slug}-${label}`}
                              className="h-[13px] text-[10px] text-zinc-400 leading-[13px] w-6 text-right"
                            >
                              {index % 2 === 0 ? label : ""}
                            </div>
                          ))}
                        </div>

                        {habitGrid.map((week, weekIndex) => (
                          <div key={`${habit.slug}-${weekIndex}`} className="flex flex-col gap-[3px]">
                            {week.map((day, dayIndex) => {
                              const dayDate = day?.date || "";
                              const isFutureDay =
                                dayDate !== "" ? dayDate > data.trackerRange.endDate : false;
                              const isMilestoneDay =
                                dayDate !== "" && isExamAwareStudyHabit
                                  ? studyExamDateSet.has(dayDate)
                                  : false;
                              return (
                              <button
                                key={`${habit.slug}-${weekIndex}-${dayIndex}`}
                                type="button"
                                disabled={!day || habit.mode === "duration" || isFutureDay}
                                aria-label={
                                  day
                                    ? habit.mode === "duration"
                                      ? `${habit.name} ${day.date} ${day.hours.toFixed(1)} hours`
                                      : `${habit.name} ${day.date} ${day.completed ? "complete" : "incomplete"}`
                                    : `${habit.name} empty`
                                }
                                title={
                                  day
                                    ? habit.mode === "duration"
                                      ? `${formatShortDate(day.date)} - ${
                                          isFutureDay ? "Future day" : `${day.hours.toFixed(1)}h`
                                        }`
                                      : `${formatShortDate(day.date)} - ${day.completed ? "Complete" : "Not done"}`
                                    : ""
                                }
                                onClick={() => {
                                  if (!day) return;
                                  if (isFutureDay) return;
                                  void toggleHabit(habit.name, day.date, !day.completed);
                                }}
                                className={`w-[13px] h-[13px] rounded-[2px] transition-colors ${
                                  day
                                    ? habit.mode === "duration"
                                      ? `${
                                          isMilestoneDay
                                            ? "ring-1 ring-red-500 ring-inset"
                                            : "hover:ring-1 hover:ring-zinc-400"
                                        }`
                                      : day.completed
                                        ? `${getBinaryCompletedColorClass(habitColor)} hover:opacity-90 ring-1 ring-zinc-400/30`
                                        : isFutureDay
                                          ? ""
                                          : "hover:ring-1 hover:ring-zinc-400"
                                    : "bg-transparent"
                                }`}
                                style={{
                                  backgroundColor: day
                                    ? habit.mode === "duration"
                                      ? isFutureDay
                                        ? getFutureCellColor()
                                        : getHeatCellColor(habitColor, day.level)
                                      : day.completed
                                        ? undefined
                                        : isFutureDay
                                          ? getFutureCellColor()
                                          : getBlankCellColor()
                                    : undefined,
                                }}
                              />
                            )})}
                          </div>
                        ))}
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {activeHabitSettings &&
            activeHabitFuturePreview &&
            activeHabitColor &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-900/55 p-4 overflow-y-auto"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setActiveHabitSettingsSlug(null);
                }}
              >
                <div
                  className="w-full max-w-xl rounded-xl border border-zinc-200 bg-white p-4 my-auto shadow-2xl"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold">Habit Settings: {activeHabitSettings.name}</h4>
                    <button
                      type="button"
                      onClick={() => setActiveHabitSettingsSlug(null)}
                      className="px-2 py-1 rounded-md text-xs bg-zinc-200"
                    >
                      Close
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <StudyStatBadge label="Current streak" value={`${activeHabitSettings.currentStreak}d`} />
                    <StudyStatBadge label="Longest streak" value={`${activeHabitSettings.longestStreak}d`} />
                    <StudyStatBadge label="Active days" value={`${activeHabitSettings.totalCompleted}`} />
                    <StudyStatBadge
                      label={activeHabitSettings.mode === "duration" ? "Total hours" : "Mode"}
                      value={
                        activeHabitSettings.mode === "duration"
                          ? `${activeHabitSettings.totalHours.toFixed(1)}h`
                          : "Yes/No"
                      }
                    />
                  </div>

                  <div className="space-y-3">
                    {activeHabitSettings.mode === "binary" && (
                      <button
                        type="button"
                        onClick={() => {
                          setActionError(null);
                          setActiveHabitSettingsSlug(null);
                          setEditingBinaryHabitSlug(activeHabitSettings.slug);
                        }}
                        className="px-2 py-1 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 transition-colors"
                      >
                        Edit tracking source
                      </button>
                    )}

                    {activeHabitSettings.mode === "duration" && (
                      <button
                        type="button"
                        onClick={() => {
                          setActionError(null);
                          setActiveHabitSettingsSlug(null);
                          setEditingDurationHabitSlug(activeHabitSettings.slug);
                        }}
                        className="px-2 py-1 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 transition-colors"
                      >
                        Edit time tracking sources
                      </button>
                    )}

                    <label className="flex items-center gap-2 text-xs text-zinc-500">
                      <input
                        type="checkbox"
                        checked={Boolean(habitShowFutureDays[activeHabitSettings.slug])}
                        onChange={(event) =>
                          setHabitShowFutureDays((previous) => ({
                            ...previous,
                            [activeHabitSettings.slug]: event.target.checked,
                          }))
                        }
                      />
                      <span>Show future days</span>
                    </label>

                    {habitShowFutureDays[activeHabitSettings.slug] && (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1 text-xs text-zinc-500">
                          <span>Future preview</span>
                          <select
                            value={activeHabitFuturePreview.mode}
                            onChange={(event) =>
                              setHabitFuturePreviewSettings((previous) => ({
                                ...previous,
                                [activeHabitSettings.slug]: {
                                  mode: event.target.value === "custom" ? "custom" : "auto",
                                  customDays: clampFuturePreviewDays(
                                    previous[activeHabitSettings.slug]?.customDays ??
                                      DEFAULT_CUSTOM_FUTURE_PREVIEW_DAYS
                                  ),
                                },
                              }))
                            }
                            className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs"
                          >
                            <option value="auto">Auto</option>
                            <option value="custom">Custom</option>
                          </select>
                        </label>
                        {activeHabitFuturePreview.mode === "custom" && (
                          <label className="flex items-center gap-1 text-xs text-zinc-500">
                            <span>Days</span>
                            <input
                              type="number"
                              min={1}
                              max={365}
                              step={1}
                              value={activeHabitFuturePreview.customDays}
                              onChange={(event) =>
                                setHabitFuturePreviewSettings((previous) => ({
                                  ...previous,
                                  [activeHabitSettings.slug]: {
                                    mode: previous[activeHabitSettings.slug]?.mode || "auto",
                                    customDays: clampFuturePreviewDays(Number(event.target.value || "0")),
                                  },
                                }))
                              }
                              className="w-16 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs"
                              aria-label={`Custom future days for ${activeHabitSettings.name}`}
                            />
                          </label>
                        )}
                      </div>
                    )}

                    <label className="flex items-center gap-2 text-xs text-zinc-500">
                      <span>Color</span>
                      <select
                        value={activeHabitColor}
                        onChange={(event) =>
                          setHabitColors((previous) => ({
                            ...previous,
                            [activeHabitSettings.slug]: event.target.value,
                          }))
                        }
                        className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs"
                        aria-label={`Set ${activeHabitSettings.name} color`}
                      >
                        {HABIT_COLOR_OPTIONS.map((option) => (
                          <option key={`${activeHabitSettings.slug}-${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      type="button"
                      aria-label={`Remove ${activeHabitSettings.name}`}
                      onClick={() => {
                        const confirmed = window.confirm(
                          `Remove "${activeHabitSettings.name}" from your habit tracker? This will delete its tracked history in the current date range.`
                        );
                        if (!confirmed) return;
                        setActiveHabitSettingsSlug(null);
                        void removeHabit(activeHabitSettings.name);
                      }}
                      disabled={actionLoading}
                      className="px-2 py-1 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 transition-colors"
                    >
                      Remove habit
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )}

          {editingDurationHabit &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-900/55 p-4 overflow-y-auto"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setEditingDurationHabitSlug(null);
                }}
              >
                <div
                  className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-4 my-auto shadow-2xl"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold">
                    Edit Time Tracking Sources: {editingDurationHabit.name}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setEditingDurationHabitSlug(null)}
                    className="px-2 py-1 rounded-md text-xs bg-zinc-200"
                  >
                    Close
                  </button>
                </div>

                <div className="space-y-3">
                  <p className="text-xs text-zinc-500">Select calendars to scan for this habit.</p>
                  <label className="inline-flex items-center gap-2 text-xs text-zinc-600">
                    <input
                      type="checkbox"
                      checked={selectedStudyHabitSlug === editingDurationHabit.slug}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedStudyHabitSlug(editingDurationHabit.slug);
                        } else if (selectedStudyHabitSlug === editingDurationHabit.slug) {
                          setSelectedStudyHabitSlug(null);
                        }
                      }}
                    />
                    <span>Use this habit as studying source</span>
                  </label>
                  {!hasSourceCalendars && durationSourceOptions.length > 0 && (
                    <p className="text-xs text-zinc-500">
                      Using writable calendars as source options because no separate readable-source list was found.
                    </p>
                  )}
                  <div className="grid sm:grid-cols-2 gap-2">
                    {durationSourceOptions.map((calendarOption) => (
                      <label
                        key={`${editingDurationHabit.slug}-${calendarOption.id}`}
                        className="flex items-center gap-2 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={(habitSourceDrafts[editingDurationHabit.slug] || []).includes(
                            calendarOption.id
                          )}
                          onChange={(event) => {
                            setHabitSourceDrafts((previous) => {
                              const existing = previous[editingDurationHabit.slug] || [];
                              return {
                                ...previous,
                                [editingDurationHabit.slug]: event.target.checked
                                  ? [...existing, calendarOption.id]
                                  : existing.filter((id) => id !== calendarOption.id),
                              };
                            });
                          }}
                        />
                        <span>
                          {calendarOption.summary}
                          {calendarOption.primary ? " (Primary)" : ""}
                        </span>
                      </label>
                    ))}
                    {durationSourceOptions.length === 0 && (
                      <p className="text-xs text-zinc-500">No calendar sources available.</p>
                    )}
                  </div>

                  <label className="block">
                    <span className="text-xs text-zinc-500">Subject dictionary match terms (optional)</span>
                    <div className="mt-2 space-y-2">
                      {(
                        habitTermsDrafts[editingDurationHabit.slug] || [createMatchTermDraftEntry()]
                      ).map((entry, _index, entries) => (
                        <div
                          key={`${editingDurationHabit.slug}-modal-terms-${entry.id}`}
                          className="grid grid-cols-[1fr_2fr_auto] gap-2"
                        >
                          <input
                            type="text"
                            value={entry.subject}
                            onChange={(event) =>
                              setHabitTermsDrafts((previous) => ({
                                ...previous,
                                [editingDurationHabit.slug]: (
                                  previous[editingDurationHabit.slug] &&
                                  previous[editingDurationHabit.slug].length > 0
                                    ? previous[editingDurationHabit.slug]
                                    : [entry]
                                ).map((row) =>
                                  row.id === entry.id ? { ...row, subject: event.target.value } : row
                                ),
                              }))
                            }
                            placeholder="Subject (e.g. Maths)"
                            className="border rounded-lg px-2 py-1.5 text-sm bg-zinc-50"
                          />
                          <input
                            type="text"
                            value={entry.terms}
                            onChange={(event) =>
                              setHabitTermsDrafts((previous) => ({
                                ...previous,
                                [editingDurationHabit.slug]: (
                                  previous[editingDurationHabit.slug] &&
                                  previous[editingDurationHabit.slug].length > 0
                                    ? previous[editingDurationHabit.slug]
                                    : [entry]
                                ).map((row) =>
                                  row.id === entry.id ? { ...row, terms: event.target.value } : row
                                ),
                              }))
                            }
                            placeholder="Terms (e.g. math, maths, mathematics)"
                            className="border rounded-lg px-2 py-1.5 text-sm bg-zinc-50"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setHabitTermsDrafts((previous) => {
                                const rows =
                                  previous[editingDurationHabit.slug] &&
                                  previous[editingDurationHabit.slug].length > 0
                                    ? previous[editingDurationHabit.slug]
                                    : [entry];
                                if (rows.length <= 1) return previous;
                                return {
                                  ...previous,
                                  [editingDurationHabit.slug]: rows.filter((row) => row.id !== entry.id),
                                };
                              })
                            }
                            disabled={entries.length <= 1}
                            className="px-2 py-1.5 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setHabitTermsDrafts((previous) => ({
                            ...previous,
                            [editingDurationHabit.slug]: [
                              ...(previous[editingDurationHabit.slug] &&
                              previous[editingDurationHabit.slug].length > 0
                                ? previous[editingDurationHabit.slug]
                                : [createMatchTermDraftEntry()]),
                              createMatchTermDraftEntry(),
                            ],
                          }))
                        }
                        className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 transition-colors"
                      >
                        Add new subject to match
                      </button>
                    </div>
                  </label>
                </div>

                <div className="flex justify-end gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => setEditingDurationHabitSlug(null)}
                    className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const saved = await updateDurationHabitConfig(
                        editingDurationHabit.name,
                        habitSourceDrafts[editingDurationHabit.slug] || [],
                        serializeMatchTermsEntries(
                          habitTermsDrafts[editingDurationHabit.slug] || [createMatchTermDraftEntry()]
                        )
                      );
                      if (saved) {
                        setEditingDurationHabitSlug(null);
                      }
                    }}
                    disabled={actionLoading}
                    className="px-3 py-1.5 rounded-md text-xs bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-50 transition-colors"
                  >
                    Save sources
                  </button>
                </div>
              </div>
              </div>,
              document.body
            )}

          {editingBinaryHabit &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-900/55 p-4 overflow-y-auto"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setEditingBinaryHabitSlug(null);
                }}
              >
                <div
                  className="w-full max-w-xl rounded-xl border border-zinc-200 bg-white p-4 my-auto shadow-2xl"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold">
                      Edit Tracking Source: {editingBinaryHabit.name}
                    </h4>
                    <button
                      type="button"
                      onClick={() => setEditingBinaryHabitSlug(null)}
                      className="px-2 py-1 rounded-md text-xs bg-zinc-200"
                    >
                      Close
                    </button>
                  </div>

                  <div className="space-y-3">
                    <label className="block">
                      <span className="text-xs text-zinc-500">Tracking calendar</span>
                      <select
                        value={
                          habitTrackingCalendarDrafts[editingBinaryHabit.slug] ||
                          selectedTrackerCalendarId ||
                          ""
                        }
                        onChange={(event) =>
                          setHabitTrackingCalendarDrafts((previous) => ({
                            ...previous,
                            [editingBinaryHabit.slug]: event.target.value || null,
                          }))
                        }
                        className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-zinc-50"
                        disabled={actionLoading || !hasWritableCalendars}
                      >
                        {calendars.map((calendarOption) => (
                          <option
                            key={`${editingBinaryHabit.slug}-${calendarOption.id}`}
                            value={calendarOption.id}
                          >
                            {calendarOption.summary}
                            {calendarOption.primary ? " (Primary)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(habitWorkoutLinks[editingBinaryHabit.slug]?.enabled)}
                        onChange={(event) =>
                          setHabitWorkoutLinks((previous) => ({
                            ...previous,
                            [editingBinaryHabit.slug]: {
                              name: editingBinaryHabit.name,
                              enabled: event.target.checked,
                            },
                          }))
                        }
                      />
                      <span className="text-zinc-600">
                        Link to workout planner logs
                      </span>
                    </label>
                  </div>

                  <div className="flex justify-end gap-2 mt-4">
                    <button
                      type="button"
                      onClick={() => setEditingBinaryHabitSlug(null)}
                      className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const saved = await updateBinaryHabitConfig(
                          editingBinaryHabit.name,
                          habitTrackingCalendarDrafts[editingBinaryHabit.slug] ||
                            selectedTrackerCalendarId ||
                            ""
                        );
                        if (saved) {
                          setEditingBinaryHabitSlug(null);
                        }
                      }}
                      disabled={actionLoading || !hasWritableCalendars}
                      className="px-3 py-1.5 rounded-md text-xs bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-50 transition-colors"
                    >
                      Save tracking source
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            )}

          {showAddMilestoneModal &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/45 p-4"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setShowAddMilestoneModal(false);
                }}
              >
                <div
                  className="w-full max-w-xl rounded-xl border border-zinc-200 bg-white p-4"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold">Add Exam/Coursework Date</h4>
                  <button
                    type="button"
                    onClick={() => setShowAddMilestoneModal(false)}
                    className="px-2 py-1 rounded-md text-xs bg-zinc-200"
                  >
                    Close
                  </button>
                </div>
                <div className="mb-3">
                  <p className="text-xs text-zinc-500 mb-2">Outlined in red on the study calendar.</p>
                  {milestones.length === 0 && (
                    <p className="text-sm text-zinc-500">No exam or coursework dates added yet.</p>
                  )}
                  {milestones.length > 0 && (
                    <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                      {milestones.map((milestone) => (
                        <div
                          key={milestone.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{milestone.title}</p>
                            <p className="text-xs text-zinc-500">
                              {milestone.type === "exam" ? "🧪 Exam" : "📚 Coursework"} on{" "}
                              {new Date(`${milestone.date}T12:00:00`).toLocaleDateString("en-GB", {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeMilestone(milestone.id)}
                            className="px-2 py-1 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 transition-colors shrink-0"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <form onSubmit={addMilestone} className="flex flex-wrap gap-2">
                  <select
                    value={newMilestoneType}
                    onChange={(event) =>
                      setNewMilestoneType(event.target.value as "exam" | "coursework")
                    }
                    className="text-sm border rounded-lg px-3 py-2 bg-zinc-50"
                  >
                    <option value="exam">🧪 Exam</option>
                    <option value="coursework">📚 Coursework</option>
                  </select>
                  <input
                    type="text"
                    value={newMilestoneTitle}
                    onChange={(event) => setNewMilestoneTitle(event.target.value)}
                    placeholder="Title (optional)"
                    className="flex-1 min-w-48 border rounded-lg px-3 py-2 text-sm bg-zinc-50"
                  />
                  <input
                    type="date"
                    value={newMilestoneDate}
                    onChange={(event) => setNewMilestoneDate(event.target.value)}
                    className="text-sm border rounded-lg px-3 py-2 bg-zinc-50"
                    required
                  />
                  <button
                    type="submit"
                    disabled={!newMilestoneDate}
                    className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    Add
                  </button>
                </form>
              </div>
              </div>,
              document.body
            )}

          {showAddHabitModal &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/45 p-4"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setShowAddHabitModal(false);
                }}
              >
                <div
                  className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-4"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold">Add Habit</h4>
                  <button
                    type="button"
                    onClick={() => setShowAddHabitModal(false)}
                    className="px-2 py-1 rounded-md text-xs bg-zinc-200"
                  >
                    Close
                  </button>
                </div>

                <form onSubmit={handleAddHabit} className="flex flex-wrap gap-2 mb-3">
                  <select
                    value={newHabitMode}
                    onChange={(event) => setNewHabitMode(event.target.value as HabitMode)}
                    className="text-sm border rounded-lg px-3 py-2 bg-zinc-50"
                    disabled={!selectedTrackerCalendarId || actionLoading}
                    aria-label="Select habit tracking mode"
                  >
                    <option value="binary">✅ Yes/No</option>
                    <option value="duration">⏱️ Hours</option>
                  </select>
                  <input
                    type="text"
                    value={newHabitName}
                    onChange={(event) => setNewHabitName(event.target.value)}
                    placeholder="Add a habit (e.g. 🏋️ Gym)"
                    className="flex-1 min-w-56 border rounded-lg px-3 py-2 text-sm bg-zinc-50"
                    disabled={!selectedTrackerCalendarId || actionLoading}
                  />
                  <button
                    type="submit"
                    disabled={
                      !selectedTrackerCalendarId ||
                      actionLoading ||
                      !newHabitName.trim() ||
                      (newHabitMode === "duration" && newHabitSourceCalendarIds.length === 0)
                    }
                    className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    ➕ Add habit
                  </button>
                </form>

                <div className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-sm font-medium">Defaults</p>
                    <span className="text-xs text-zinc-500">
                      Re-adding defaults will not override current study/workout links.
                    </span>
                  </div>
                  <div className="space-y-2">
                    {DEFAULT_HABITS.map((defaultHabit) => {
                      const alreadyAdded = habitNameSet.has(
                        normalizeHabitName(defaultHabit.name)
                      );
                      return (
                        <div
                          key={`default-habit-${defaultHabit.key}`}
                          className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2"
                        >
                          <div>
                            <p className="text-sm font-medium">{defaultHabit.name}</p>
                            <p className="text-xs text-zinc-500">{defaultHabit.description}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void addDefaultHabit(defaultHabit.key);
                            }}
                            disabled={
                              alreadyAdded ||
                              actionLoading
                            }
                            className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 disabled:opacity-50 transition-colors"
                          >
                            {alreadyAdded ? "Added" : "Add default"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {sourceCalendars.length === 0 && (
                    <p className="mt-2 text-xs text-zinc-500">
                      No readable calendars available for re-adding default studying habit.
                    </p>
                  )}
                  {!selectedTrackerCalendarId && (
                    <p className="mt-2 text-xs text-red-500">
                      Select a writable tracking calendar first.
                    </p>
                  )}
                </div>

                {actionError && <p className="text-sm text-red-500 mb-3">{actionError}</p>}
                {actionSuccess && <p className="text-sm text-emerald-600 mb-3">{actionSuccess}</p>}
                {habitColorSyncMessage && (
                  <p className="text-sm text-emerald-600 mb-3">{habitColorSyncMessage}</p>
                )}

                {newHabitMode === "duration" && (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-3">
                    <p className="text-xs text-zinc-500">Select calendars to scan for this time-tracking habit.</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {sourceCalendars.map((calendarOption) => (
                        <label key={calendarOption.id} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={newHabitSourceCalendarIds.includes(calendarOption.id)}
                            onChange={(event) => {
                              setNewHabitSourceCalendarIds((previous) =>
                                event.target.checked
                                  ? [...previous, calendarOption.id]
                                  : previous.filter((id) => id !== calendarOption.id)
                              );
                            }}
                          />
                          <span>
                            {calendarOption.summary}
                            {calendarOption.primary ? " (Primary)" : ""}
                          </span>
                        </label>
                      ))}
                      {!hasSourceCalendars && (
                        <p className="text-xs text-zinc-500">No readable calendars available.</p>
                      )}
                    </div>
                    <label className="block">
                      <span className="text-xs text-zinc-500">
                        Subject dictionary match terms (optional)
                      </span>
                      <div className="mt-2 space-y-2">
                        {newHabitMatchEntries.map((entry) => (
                          <div key={`new-habit-terms-${entry.id}`} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                            <input
                              type="text"
                              value={entry.subject}
                              onChange={(event) =>
                                setNewHabitMatchEntries((previous) =>
                                  previous.map((row) =>
                                    row.id === entry.id ? { ...row, subject: event.target.value } : row
                                  )
                                )
                              }
                              placeholder="Subject (e.g. Maths)"
                              className="border rounded-lg px-2 py-1.5 text-sm bg-white"
                            />
                            <input
                              type="text"
                              value={entry.terms}
                              onChange={(event) =>
                                setNewHabitMatchEntries((previous) =>
                                  previous.map((row) =>
                                    row.id === entry.id ? { ...row, terms: event.target.value } : row
                                  )
                                )
                              }
                              placeholder="Terms (e.g. math, maths, mathematics)"
                              className="border rounded-lg px-2 py-1.5 text-sm bg-white"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setNewHabitMatchEntries((previous) =>
                                  previous.length <= 1
                                    ? previous
                                    : previous.filter((row) => row.id !== entry.id)
                                )
                              }
                              disabled={newHabitMatchEntries.length <= 1}
                              className="px-2 py-1.5 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setNewHabitMatchEntries((previous) => [
                              ...previous,
                              createMatchTermDraftEntry(),
                            ])
                          }
                          className="px-3 py-1.5 rounded-md text-xs bg-zinc-200 hover:bg-zinc-300 transition-colors"
                        >
                          Add new subject to match
                        </button>
                      </div>
                    </label>
                  </div>
                )}

                {newHabitMode === "binary" && (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2">
                    <label className="block">
                      <span className="text-xs text-zinc-500">Tracking calendar for this habit</span>
                      <select
                        value={newHabitTrackingCalendarId || ""}
                        onChange={(event) => setNewHabitTrackingCalendarId(event.target.value || null)}
                        disabled={!hasWritableCalendars || actionLoading}
                        className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      >
                        {!hasWritableCalendars && <option value="">No writable calendars found</option>}
                        {hasWritableCalendars &&
                          calendars.map((entry) => (
                            <option key={`new-habit-binary-${entry.id}`} value={entry.id}>
                              {entry.summary}
                              {entry.primary ? " (Primary)" : ""}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
              </div>,
              document.body
            )}
        </div>
      )}
    </div>
  );
}

function StudyStatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-50 rounded-xl px-3 py-3 text-center">
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="text-[11px] text-zinc-500 mt-0.5">{label}</div>
    </div>
  );
}
