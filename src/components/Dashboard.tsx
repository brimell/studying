"use client";

import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import TodayProgress from "./TodayProgress";
import DailyStudyChart from "./DailyStudyChart";
import SubjectDistribution from "./SubjectDistribution";
import FirstExamCountdown from "./FirstExamCountdown";
import HabitTracker from "./HabitTracker";
import AlertsPanel from "./AlertsPanel";
import AdvancedAnalytics from "./AdvancedAnalytics";
import DailyTrackerCorrelations from "./DailyTrackerCorrelations";
import LoadingIcon from "./LoadingIcon";
import FancyDropdown from "./FancyDropdown";

const DASHBOARD_LAYOUT_STORAGE_KEY = "study-stats.dashboard.layout.v1";
const DASHBOARD_SETTINGS_STORAGE_KEY = "study-stats.dashboard.settings.v1";
const DASHBOARD_LAYOUT_CONTROLS_STORAGE_KEY = "study-stats.dashboard.show-layout-controls";
const PROJECTION_EXAM_DATE_STORAGE_KEY = "study-stats.projection.exam-date";
const PROJECTION_COUNTDOWN_START_STORAGE_KEY = "study-stats.projection.countdown-start";
const EXAM_DATE_UPDATED_EVENT = "study-stats:exam-date-updated";
const DEFAULT_ORDER = [
  "today-progress",
  "first-exam-countdown",
  "habit-tracker",
  "daily-study-chart",
  "subject-distribution",
  "advanced-analytics",
  "daily-tracker-correlations",
] as const;
const GRID_COLUMN_OPTIONS = [6, 8, 10, 12] as const;
const GRID_ROW_OPTIONS = [3, 4, 5, 6, 7] as const;

type CardId = (typeof DEFAULT_ORDER)[number];
type CardSizePreset = "compact" | "standard" | "large" | "full";
type DashboardSettingsState = {
  columns?: number;
  rows?: number;
  cardSizes?: Partial<Record<CardId, unknown>>;
  hiddenCards?: unknown;
};

const DEFAULT_CARD_SIZES: Record<CardId, CardSizePreset> = {
  "today-progress": "standard",
  "first-exam-countdown": "standard",
  "habit-tracker": "full",
  "daily-study-chart": "large",
  "subject-distribution": "standard",
  "advanced-analytics": "large",
  "daily-tracker-correlations": "large",
};

const CARD_SIZE_PRESETS: Record<CardSizePreset, { label: string; colRatio: number; rowSpan: number }> = {
  compact: { label: "Compact", colRatio: 0.25, rowSpan: 1 },
  standard: { label: "Standard", colRatio: 0.42, rowSpan: 1 },
  large: { label: "Large", colRatio: 0.58, rowSpan: 2 },
  full: { label: "Full Width", colRatio: 1, rowSpan: 2 },
};

function normalizeOrder(value: unknown): CardId[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<CardId>();
  const normalized: CardId[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    if (!DEFAULT_ORDER.includes(item as CardId)) continue;
    const id = item as CardId;
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  if (normalized.length === 0) return null;
  for (const id of DEFAULT_ORDER) {
    if (seen.has(id)) continue;
    normalized.push(id);
  }
  return normalized;
}

function isValidCardSize(value: unknown): value is CardSizePreset {
  return value === "compact" || value === "standard" || value === "large" || value === "full";
}

function isValidColumns(value: number): value is (typeof GRID_COLUMN_OPTIONS)[number] {
  return GRID_COLUMN_OPTIONS.includes(value as (typeof GRID_COLUMN_OPTIONS)[number]);
}

function isValidRows(value: number): value is (typeof GRID_ROW_OPTIONS)[number] {
  return GRID_ROW_OPTIONS.includes(value as (typeof GRID_ROW_OPTIONS)[number]);
}

function reorderCards(current: CardId[], sourceId: CardId, targetId: CardId): CardId[] {
  if (sourceId === targetId) return current;
  const next = [...current];
  const sourceIndex = next.indexOf(sourceId);
  const targetIndex = next.indexOf(targetId);
  if (sourceIndex === -1 || targetIndex === -1) return current;
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, sourceId);
  return next;
}

function resolveCardLayout(size: CardSizePreset, gridColumns: number): { colSpan: number; rowSpan: number } {
  const preset = CARD_SIZE_PRESETS[size];
  const colSpan = Math.max(1, Math.min(gridColumns, Math.round(gridColumns * preset.colRatio)));
  return {
    colSpan,
    rowSpan: preset.rowSpan,
  };
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultExamDate(): string {
  const date = new Date();
  date.setMonth(date.getMonth() + 3);
  return toDateInputValue(date);
}

function defaultCountdownStartDate(): string {
  const now = new Date();
  return toDateInputValue(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
}

function moveVisibleCardByOffset(
  current: CardId[],
  cardId: CardId,
  offset: -1 | 1,
  hiddenCardIds: CardId[]
): CardId[] {
  const visible = current.filter((id) => !hiddenCardIds.includes(id));
  const index = visible.indexOf(cardId);
  if (index === -1) return current;
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= visible.length) return current;
  return reorderCards(current, cardId, visible[targetIndex]);
}

function loadInitialDashboardState(): {
  order: CardId[];
  gridColumns: (typeof GRID_COLUMN_OPTIONS)[number];
  gridRows: (typeof GRID_ROW_OPTIONS)[number];
  cardSizes: Record<CardId, CardSizePreset>;
  hiddenCards: CardId[];
} {
  const fallback = {
    order: [...DEFAULT_ORDER],
    gridColumns: 12 as (typeof GRID_COLUMN_OPTIONS)[number],
    gridRows: 4 as (typeof GRID_ROW_OPTIONS)[number],
    cardSizes: { ...DEFAULT_CARD_SIZES },
    hiddenCards: [] as CardId[],
  };

  if (typeof window === "undefined") return fallback;

  let order = fallback.order;
  let gridColumns = fallback.gridColumns;
  let gridRows = fallback.gridRows;
  let cardSizes = fallback.cardSizes;
  let hiddenCards = fallback.hiddenCards;

  const rawLayout = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
  if (rawLayout) {
    try {
      const parsed = JSON.parse(rawLayout) as unknown;
      const normalized = normalizeOrder(parsed);
      if (normalized) order = normalized;
    } catch {
      // Ignore malformed localStorage value.
    }
  }

  const rawSettings = window.localStorage.getItem(DASHBOARD_SETTINGS_STORAGE_KEY);
  if (rawSettings) {
    try {
      const parsed = JSON.parse(rawSettings) as DashboardSettingsState;

      if (typeof parsed.columns === "number" && isValidColumns(parsed.columns)) {
        gridColumns = parsed.columns;
      }
      if (typeof parsed.rows === "number" && isValidRows(parsed.rows)) {
        gridRows = parsed.rows;
      }
      if (parsed.cardSizes && typeof parsed.cardSizes === "object") {
        const merged = { ...DEFAULT_CARD_SIZES };
        for (const id of DEFAULT_ORDER) {
          const rawSize = parsed.cardSizes[id];
          if (isValidCardSize(rawSize)) merged[id] = rawSize;
        }
        cardSizes = merged;
      }
      if (Array.isArray(parsed.hiddenCards)) {
        hiddenCards = parsed.hiddenCards.filter(
          (id): id is CardId => typeof id === "string" && DEFAULT_ORDER.includes(id as CardId)
        );
      }
    } catch {
      // Ignore malformed localStorage value.
    }
  }

  return { order, gridColumns, gridRows, cardSizes, hiddenCards };
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const initialDashboardState = useMemo(() => loadInitialDashboardState(), []);
  const [order, setOrder] = useState<CardId[]>(initialDashboardState.order);
  const [draggingId, setDraggingId] = useState<CardId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<CardId | null>(null);
  const [gridColumns] = useState<(typeof GRID_COLUMN_OPTIONS)[number]>(
    initialDashboardState.gridColumns
  );
  const [gridRows] = useState<(typeof GRID_ROW_OPTIONS)[number]>(
    initialDashboardState.gridRows
  );
  const [cardSizes, setCardSizes] = useState<Record<CardId, CardSizePreset>>(
    initialDashboardState.cardSizes
  );
  const [hiddenCards, setHiddenCards] = useState<CardId[]>(initialDashboardState.hiddenCards);
  const [openSettingsCardId, setOpenSettingsCardId] = useState<CardId | null>(null);
  const [showLayoutControls, setShowLayoutControls] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const value = window.localStorage.getItem(DASHBOARD_LAYOUT_CONTROLS_STORAGE_KEY);
    return value === null ? true : value === "true";
  });
  const [firstExamDateSetting, setFirstExamDateSetting] = useState<string>(() => {
    if (typeof window === "undefined") return defaultExamDate();
    return window.localStorage.getItem(PROJECTION_EXAM_DATE_STORAGE_KEY) || defaultExamDate();
  });
  const [countdownStartDateSetting, setCountdownStartDateSetting] = useState<string>(() => {
    if (typeof window === "undefined") return defaultCountdownStartDate();
    return (
      window.localStorage.getItem(PROJECTION_COUNTDOWN_START_STORAGE_KEY) ||
      defaultCountdownStartDate()
    );
  });
  const [isDesktop, setIsDesktop] = useState(false);

  const cardRefs = useRef(new Map<CardId, HTMLDivElement>());
  const previousRects = useRef(new Map<CardId, DOMRect>());

  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify(order));
  }, [order]);

  useEffect(() => {
    window.localStorage.setItem(
      DASHBOARD_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        columns: gridColumns,
        rows: gridRows,
        cardSizes,
        hiddenCards,
      })
    );
  }, [gridColumns, gridRows, cardSizes, hiddenCards]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const onChange = () => setIsDesktop(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const syncLayoutControls = () => {
      const value = window.localStorage.getItem(DASHBOARD_LAYOUT_CONTROLS_STORAGE_KEY);
      setShowLayoutControls(value === null ? true : value === "true");
    };
    syncLayoutControls();
    window.addEventListener("study-stats:settings-updated", syncLayoutControls);
    window.addEventListener("storage", syncLayoutControls);
    return () => {
      window.removeEventListener("study-stats:settings-updated", syncLayoutControls);
      window.removeEventListener("storage", syncLayoutControls);
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenSettingsCardId(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-card-settings-root='true']")) return;
      setOpenSettingsCardId(null);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    const syncExamDates = () => {
      setFirstExamDateSetting(
        window.localStorage.getItem(PROJECTION_EXAM_DATE_STORAGE_KEY) || defaultExamDate()
      );
      setCountdownStartDateSetting(
        window.localStorage.getItem(PROJECTION_COUNTDOWN_START_STORAGE_KEY) ||
          defaultCountdownStartDate()
      );
    };
    window.addEventListener(EXAM_DATE_UPDATED_EVENT, syncExamDates);
    return () => window.removeEventListener(EXAM_DATE_UPDATED_EVENT, syncExamDates);
  }, []);

  const cards = useMemo(
    () =>
      ({
        "today-progress": {
          title: "Today Progress",
          content: <TodayProgress />,
        },
        "first-exam-countdown": {
          title: "Exam Countdown",
          content: <FirstExamCountdown />,
        },
        "habit-tracker": {
          title: "Habit Tracker",
          content: <HabitTracker />,
        },
        "daily-study-chart": {
          title: "Daily Study Chart",
          content: <DailyStudyChart />,
        },
        "subject-distribution": {
          title: "Subject Distribution",
          content: <SubjectDistribution />,
        },
        "advanced-analytics": {
          title: "Advanced Analytics",
          content: <AdvancedAnalytics />,
        },
        "daily-tracker-correlations": {
          title: "Daily Tracker Correlations",
          content: <DailyTrackerCorrelations />,
        },
      }) as Record<CardId, { title: string; content: ReactNode }>,
    []
  );

  const renderedOrder = useMemo(() => {
    const visibleOrder = order.filter((id) => !hiddenCards.includes(id));
    if (!draggingId || !dropTargetId) return visibleOrder;
    return reorderCards(visibleOrder, draggingId, dropTargetId);
  }, [order, hiddenCards, draggingId, dropTargetId]);

  const gridStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isDesktop) return undefined;
    return {
      gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
      gridAutoRows: "minmax(150px, auto)",
    };
  }, [isDesktop, gridColumns]);

  const getCardStyle = (id: CardId): CSSProperties | undefined => {
    if (!isDesktop) return undefined;
    const { colSpan } = resolveCardLayout(cardSizes[id], gridColumns);
    return {
      gridColumn: `span ${colSpan} / span ${colSpan}`,
      gridRow: "span 1 / span 1",
    };
  };

  useLayoutEffect(() => {
    const nextRects = new Map<CardId, DOMRect>();

    for (const id of renderedOrder) {
      const element = cardRefs.current.get(id);
      if (!element) continue;
      nextRects.set(id, element.getBoundingClientRect());
    }

    if (!isDesktop) {
      previousRects.current = nextRects;
      return;
    }

    for (const id of renderedOrder) {
      const element = cardRefs.current.get(id);
      const previous = previousRects.current.get(id);
      const next = nextRects.get(id);
      if (!element || !previous || !next) continue;

      const dx = previous.left - next.left;
      const dy = previous.top - next.top;
      if (dx === 0 && dy === 0) continue;

      element.style.transition = "transform 0ms";
      element.style.transform = `translate(${dx}px, ${dy}px)`;

      requestAnimationFrame(() => {
        element.style.transition = "transform 220ms ease";
        element.style.transform = "";
      });
    }

    previousRects.current = nextRects;
  }, [renderedOrder, isDesktop, gridColumns, gridRows, cardSizes]);

  const updateFirstExamSetting = (key: "exam" | "start", value: string) => {
    if (!value) return;
    if (key === "exam") {
      setFirstExamDateSetting(value);
      window.localStorage.setItem(PROJECTION_EXAM_DATE_STORAGE_KEY, value);
    } else {
      setCountdownStartDateSetting(value);
      window.localStorage.setItem(PROJECTION_COUNTDOWN_START_STORAGE_KEY, value);
    }
    window.dispatchEvent(new CustomEvent(EXAM_DATE_UPDATED_EVENT));
  };

  const hideCard = (cardId: CardId) => {
    setHiddenCards((previous) => {
      if (previous.includes(cardId)) return previous;
      return [...previous, cardId];
    });
    setOpenSettingsCardId((current) => (current === cardId ? null : current));
  };

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingIcon />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="surface-card-strong text-center py-20 px-6">
        <h2 className="text-2xl font-semibold mb-3">Welcome to Dashboard</h2>
        <p className="soft-text mb-6 max-w-md mx-auto">
          Sign in with your Google account to view your study statistics from
          Google Calendar.
        </p>
      </div>
    );
  }

  return (
    <div>
      <AlertsPanel />
      <div className="grid grid-cols-1 items-start gap-3" style={gridStyle}>
        {renderedOrder.length === 0 && (
          <div className="surface-card p-6 text-sm text-zinc-600">
            All cards are hidden. Use the restore buttons in `Dashboard Grid` to show cards again.
          </div>
        )}
        {renderedOrder.map((id) => (
          <div
            key={id}
            className="h-full"
            style={getCardStyle(id)}
            ref={(node) => {
              if (!node) {
                cardRefs.current.delete(id);
                return;
              }
              cardRefs.current.set(id, node);
            }}
            onDragOver={(event) => {
              if (!draggingId) return;
              event.preventDefault();
            }}
            onDragEnter={() => {
              if (!draggingId || draggingId === id) return;
              setDropTargetId(id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (!draggingId) return;
              setOrder((previous) => reorderCards(previous, draggingId, id));
              setDraggingId(null);
              setDropTargetId(null);
            }}
          >
            {showLayoutControls && (
              <div className="relative mb-2 flex flex-wrap items-center justify-between gap-2 text-xs soft-text">
                <span className="font-medium text-zinc-700">{cards[id].title}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setOrder((previous) => moveVisibleCardByOffset(previous, id, -1, hiddenCards))
                    }
                    disabled={renderedOrder.indexOf(id) <= 0}
                    className="pill-btn px-2 py-0.5 disabled:opacity-40"
                    aria-label={`Move ${cards[id].title} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setOrder((previous) => moveVisibleCardByOffset(previous, id, 1, hiddenCards))
                    }
                    disabled={renderedOrder.indexOf(id) >= renderedOrder.length - 1}
                    className="pill-btn px-2 py-0.5 disabled:opacity-40"
                    aria-label={`Move ${cards[id].title} down`}
                  >
                    ↓
                  </button>
                  <span
                    draggable
                    onDragStart={(event) => {
                      setDraggingId(id);
                      setDropTargetId(id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropTargetId(null);
                    }}
                    className="pill-btn hidden sm:inline-flex px-2 py-0.5 cursor-grab active:cursor-grabbing"
                  >
                    Drag
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenSettingsCardId((current) => (current === id ? null : id))}
                    className="pill-btn px-2 py-0.5"
                    aria-expanded={openSettingsCardId === id}
                    aria-label={`Card settings for ${cards[id].title}`}
                    data-card-settings-root="true"
                  >
                    ⚙
                  </button>
                </div>
                {openSettingsCardId === id && (
                  <div
                    className="surface-card-strong absolute right-0 top-7 z-20 w-72 p-3 space-y-3"
                    data-card-settings-root="true"
                  >
                  <label className="block space-y-1">
                    <span className="text-xs text-zinc-600">Card size</span>
                    <FancyDropdown
                      value={cardSizes[id]}
                      onChange={(value) => {
                        if (!isValidCardSize(value)) return;
                        setCardSizes((previous) => ({ ...previous, [id]: value }));
                      }}
                      options={Object.entries(CARD_SIZE_PRESETS).map(([key, preset]) => ({
                        value: key,
                        label: preset.label,
                      }))}
                    />
                  </label>
                  {id === "first-exam-countdown" && (
                    <div className="space-y-2">
                      <label className="block space-y-1">
                        <span className="text-xs text-zinc-600">First exam date</span>
                        <input
                          type="date"
                          value={firstExamDateSetting}
                          onChange={(event) => updateFirstExamSetting("exam", event.target.value)}
                          className="field-select w-full"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs text-zinc-600">Countdown start date</span>
                        <input
                          type="date"
                          value={countdownStartDateSetting}
                          onChange={(event) => updateFirstExamSetting("start", event.target.value)}
                          className="field-select w-full"
                        />
                      </label>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => hideCard(id)}
                    className="pill-btn w-full text-left text-red-700"
                  >
                    🗑 Hide card
                  </button>
                  </div>
                )}
              </div>
            )}
            <div
              className={`h-full transition-all duration-200 ${
                draggingId === id ? "opacity-65 scale-[0.99]" : "opacity-100 scale-100"
              } ${
                draggingId && dropTargetId === id && draggingId !== id
                  ? "rounded-2xl outline outline-2 outline-dashed outline-teal-500/60 outline-offset-4"
                  : ""
              }`}
            >
              {cards[id].content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
