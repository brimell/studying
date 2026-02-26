"use client";

import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import TodayProgress from "./TodayProgress";
import DailyStudyChart from "./DailyStudyChart";
import SubjectDistribution from "./SubjectDistribution";
import StudyProjection from "./StudyProjection";
import HabitTracker from "./HabitTracker";
import WorkoutFatigueCard from "./WorkoutFatigueCard";

const DASHBOARD_LAYOUT_STORAGE_KEY = "study-stats.dashboard.layout.v1";
const DASHBOARD_SETTINGS_STORAGE_KEY = "study-stats.dashboard.settings.v1";
const DEFAULT_ORDER = [
  "today-progress",
  "study-projection",
  "habit-tracker",
  "workout-fatigue",
  "daily-study-chart",
  "subject-distribution",
] as const;
const GRID_COLUMN_OPTIONS = [6, 8, 10, 12] as const;
const GRID_ROW_OPTIONS = [3, 4, 5, 6, 7] as const;

type CardId = (typeof DEFAULT_ORDER)[number];
type CardSizePreset = "compact" | "standard" | "large" | "full";

const DEFAULT_CARD_SIZES: Record<CardId, CardSizePreset> = {
  "today-progress": "standard",
  "study-projection": "large",
  "habit-tracker": "full",
  "workout-fatigue": "large",
  "daily-study-chart": "large",
  "subject-distribution": "standard",
};

const CARD_SIZE_PRESETS: Record<CardSizePreset, { label: string; colRatio: number; rowSpan: number }> = {
  compact: { label: "Compact", colRatio: 0.25, rowSpan: 1 },
  standard: { label: "Standard", colRatio: 0.42, rowSpan: 1 },
  large: { label: "Large", colRatio: 0.58, rowSpan: 2 },
  full: { label: "Full Width", colRatio: 1, rowSpan: 2 },
};

function isValidOrder(value: unknown): value is CardId[] {
  if (!Array.isArray(value) || value.length !== DEFAULT_ORDER.length) return false;
  const unique = new Set(value);
  if (unique.size !== DEFAULT_ORDER.length) return false;
  return DEFAULT_ORDER.every((id) => unique.has(id));
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

export default function Dashboard() {
  const { data: session, status } = useSession();
  const [order, setOrder] = useState<CardId[]>([...DEFAULT_ORDER]);
  const [draggingId, setDraggingId] = useState<CardId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<CardId | null>(null);
  const [gridColumns, setGridColumns] = useState<(typeof GRID_COLUMN_OPTIONS)[number]>(12);
  const [gridRows, setGridRows] = useState<(typeof GRID_ROW_OPTIONS)[number]>(4);
  const [cardSizes, setCardSizes] = useState<Record<CardId, CardSizePreset>>({ ...DEFAULT_CARD_SIZES });
  const [isDesktop, setIsDesktop] = useState(false);

  const cardRefs = useRef(new Map<CardId, HTMLDivElement>());
  const previousRects = useRef(new Map<CardId, DOMRect>());

  useEffect(() => {
    const raw = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isValidOrder(parsed)) setOrder(parsed);
    } catch {
      // Ignore malformed localStorage value.
    }
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(DASHBOARD_SETTINGS_STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as {
        columns?: unknown;
        rows?: unknown;
        cardSizes?: Partial<Record<CardId, unknown>>;
      };

      if (typeof parsed.columns === "number" && isValidColumns(parsed.columns)) {
        setGridColumns(parsed.columns);
      }
      if (typeof parsed.rows === "number" && isValidRows(parsed.rows)) {
        setGridRows(parsed.rows);
      }
      if (parsed.cardSizes && typeof parsed.cardSizes === "object") {
        const merged = { ...DEFAULT_CARD_SIZES };
        for (const id of DEFAULT_ORDER) {
          const rawSize = parsed.cardSizes[id];
          if (isValidCardSize(rawSize)) merged[id] = rawSize;
        }
        setCardSizes(merged);
      }
    } catch {
      // Ignore malformed localStorage value.
    }
  }, []);

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
      })
    );
  }, [gridColumns, gridRows, cardSizes]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const onChange = () => setIsDesktop(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const cards = useMemo(
    () =>
      ({
        "today-progress": {
          title: "Today Progress",
          content: <TodayProgress />,
        },
        "study-projection": {
          title: "Study Projection",
          content: <StudyProjection />,
        },
        "habit-tracker": {
          title: "Habit Tracker",
          content: <HabitTracker />,
        },
        "workout-fatigue": {
          title: "Workout Fatigue",
          content: <WorkoutFatigueCard />,
        },
        "daily-study-chart": {
          title: "Daily Study Chart",
          content: <DailyStudyChart />,
        },
        "subject-distribution": {
          title: "Subject Distribution",
          content: <SubjectDistribution />,
        },
      }) as Record<CardId, { title: string; content: ReactNode }>,
    []
  );

  const renderedOrder = useMemo(() => {
    if (!draggingId || !dropTargetId) return order;
    return reorderCards(order, draggingId, dropTargetId);
  }, [order, draggingId, dropTargetId]);

  const gridStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isDesktop) return undefined;
    return {
      gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${gridRows}, minmax(150px, auto))`,
      gridAutoRows: "minmax(150px, auto)",
    };
  }, [isDesktop, gridColumns, gridRows]);

  const getCardStyle = (id: CardId): CSSProperties | undefined => {
    if (!isDesktop) return undefined;
    const { colSpan, rowSpan } = resolveCardLayout(cardSizes[id], gridColumns);
    return {
      gridColumn: `span ${colSpan} / span ${colSpan}`,
      gridRow: `span ${rowSpan} / span ${rowSpan}`,
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

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-sky-500" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-semibold mb-3">Welcome to Study Stats</h2>
        <p className="text-zinc-500 mb-6 max-w-md mx-auto">
          Sign in with your Google account to view your study statistics from
          Google Calendar.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <span className="font-medium text-zinc-600 dark:text-zinc-300">Dashboard Grid</span>
        <label className="inline-flex items-center gap-1.5">
          <span>Columns</span>
          <select
            value={gridColumns}
            onChange={(event) => setGridColumns(Number(event.target.value) as (typeof GRID_COLUMN_OPTIONS)[number])}
            className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-xs"
          >
            {GRID_COLUMN_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5">
          <span>Rows</span>
          <select
            value={gridRows}
            onChange={(event) => setGridRows(Number(event.target.value) as (typeof GRID_ROW_OPTIONS)[number])}
            className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-xs"
          >
            {GRID_ROW_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6" style={gridStyle}>
        {renderedOrder.map((id) => (
          <div
            key={id}
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
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
              <span>{cards[id].title}</span>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1">
                  <span>Size</span>
                  <select
                    value={cardSizes[id]}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!isValidCardSize(value)) return;
                      setCardSizes((previous) => ({ ...previous, [id]: value }));
                    }}
                    className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-xs"
                  >
                    {Object.entries(CARD_SIZE_PRESETS).map(([key, preset]) => (
                      <option key={key} value={key}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
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
                  className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 cursor-grab active:cursor-grabbing"
                >
                  Drag
                </span>
              </div>
            </div>
            <div
              className={`transition-all duration-200 ${
                draggingId === id ? "opacity-65 scale-[0.99]" : "opacity-100 scale-100"
              } ${
                draggingId && dropTargetId === id && draggingId !== id
                  ? "rounded-2xl outline outline-2 outline-dashed outline-zinc-400 dark:outline-zinc-500 outline-offset-4"
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
