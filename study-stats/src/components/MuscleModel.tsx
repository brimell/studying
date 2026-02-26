"use client";

import type { MuscleGroup } from "@/lib/types";
import { MUSCLE_GROUPS } from "@/lib/types";
import { MUSCLE_LABELS } from "@/lib/workouts";

const POSITIONS: Record<MuscleGroup, { x: number; y: number }> = {
  shoulders: { x: 110, y: 42 },
  chest: { x: 110, y: 72 },
  back: { x: 110, y: 92 },
  biceps: { x: 74, y: 80 },
  triceps: { x: 146, y: 80 },
  forearms: { x: 74, y: 108 },
  core: { x: 110, y: 113 },
  glutes: { x: 110, y: 145 },
  quads: { x: 94, y: 178 },
  hamstrings: { x: 126, y: 178 },
  calves: { x: 110, y: 222 },
};

function fatigueToColor(score: number): string {
  if (score <= 0) return "rgba(113,113,122,0.18)";
  if (score < 25) return "rgba(59,130,246,0.35)";
  if (score < 50) return "rgba(56,189,248,0.55)";
  if (score < 75) return "rgba(251,191,36,0.7)";
  return "rgba(239,68,68,0.8)";
}

interface MuscleModelProps {
  scores: Record<MuscleGroup, number>;
  title?: string;
  compact?: boolean;
}

export default function MuscleModel({ scores, title = "Muscle Load Map", compact = false }: MuscleModelProps) {
  const sorted = [...MUSCLE_GROUPS]
    .map((muscle) => ({ muscle, score: scores[muscle] || 0 }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3">
      <p className="text-sm font-medium mb-2">{title}</p>
      <div className={`grid ${compact ? "grid-cols-1" : "md:grid-cols-[240px,1fr]"} gap-3`}>
        <div className="mx-auto">
          <svg viewBox="0 0 220 270" width="220" height="270" aria-label="Muscle load model">
            <rect x="85" y="10" width="50" height="30" rx="15" fill="#e4e4e7" />
            <rect x="70" y="40" width="80" height="90" rx="30" fill="#f4f4f5" />
            <rect x="58" y="50" width="14" height="90" rx="7" fill="#f4f4f5" />
            <rect x="148" y="50" width="14" height="90" rx="7" fill="#f4f4f5" />
            <rect x="85" y="130" width="22" height="108" rx="11" fill="#f4f4f5" />
            <rect x="113" y="130" width="22" height="108" rx="11" fill="#f4f4f5" />
            {MUSCLE_GROUPS.map((muscle) => {
              const point = POSITIONS[muscle];
              const score = scores[muscle] || 0;
              return (
                <g key={muscle}>
                  <circle cx={point.x} cy={point.y} r={compact ? 8 : 10} fill={fatigueToColor(score)} />
                  <title>{`${MUSCLE_LABELS[muscle]}: ${score}%`}</title>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="grid sm:grid-cols-2 gap-2 content-start">
          {sorted.map(({ muscle, score }) => (
            <div
              key={muscle}
              className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
            >
              <div className="flex items-center justify-between text-xs">
                <span>{MUSCLE_LABELS[muscle]}</span>
                <span className="font-medium">{score}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 mt-1">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(0, Math.min(100, score))}%`,
                    background: score > 70 ? "#ef4444" : score > 40 ? "#f59e0b" : "#0ea5e9",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
