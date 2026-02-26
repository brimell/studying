"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import TodayProgress from "./TodayProgress";
import DailyStudyChart from "./DailyStudyChart";
import SubjectDistribution from "./SubjectDistribution";
import StudyProjection from "./StudyProjection";
import HabitTracker from "./HabitTracker";

const DASHBOARD_LAYOUT_STORAGE_KEY = "study-stats.dashboard.layout.v1";
const DEFAULT_ORDER = [
  "today-progress",
  "study-projection",
  "habit-tracker",
  "daily-study-chart",
  "subject-distribution",
] as const;

type CardId = (typeof DEFAULT_ORDER)[number];

function isValidOrder(value: unknown): value is CardId[] {
  if (!Array.isArray(value) || value.length !== DEFAULT_ORDER.length) return false;
  const unique = new Set(value);
  if (unique.size !== DEFAULT_ORDER.length) return false;
  return DEFAULT_ORDER.every((id) => unique.has(id));
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const [order, setOrder] = useState<CardId[]>([...DEFAULT_ORDER]);
  const [draggingId, setDraggingId] = useState<CardId | null>(null);

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
    window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify(order));
  }, [order]);

  const cards = useMemo(
    () =>
      ({
        "today-progress": {
          title: "Today Progress",
          span: "xl:col-span-5",
          content: <TodayProgress />,
        },
        "study-projection": {
          title: "Study Projection",
          span: "xl:col-span-7",
          content: <StudyProjection />,
        },
        "habit-tracker": {
          title: "Habit Tracker",
          span: "xl:col-span-12",
          content: <HabitTracker />,
        },
        "daily-study-chart": {
          title: "Daily Study Chart",
          span: "xl:col-span-7",
          content: <DailyStudyChart />,
        },
        "subject-distribution": {
          title: "Subject Distribution",
          span: "xl:col-span-5",
          content: <SubjectDistribution />,
        },
      }) as Record<CardId, { title: string; span: string; content: ReactNode }>,
    []
  );

  const moveCard = (sourceId: CardId, targetId: CardId) => {
    if (sourceId === targetId) return;
    setOrder((previous) => {
      const next = [...previous];
      const sourceIndex = next.indexOf(sourceId);
      const targetIndex = next.indexOf(targetId);
      if (sourceIndex === -1 || targetIndex === -1) return previous;
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, sourceId);
      return next;
    });
  };

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
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      {order.map((id) => (
        <div
          key={id}
          className={cards[id].span}
          draggable
          onDragStart={() => setDraggingId(id)}
          onDragEnd={() => setDraggingId(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!draggingId) return;
            moveCard(draggingId, id);
            setDraggingId(null);
          }}
        >
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
            <span>{cards[id].title}</span>
            <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 cursor-grab">
              Drag
            </span>
          </div>
          {cards[id].content}
        </div>
      ))}
    </div>
  );
}
