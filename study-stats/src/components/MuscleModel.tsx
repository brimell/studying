"use client";

import { useEffect, useMemo, useState } from "react";
import type { MuscleGroup } from "@/lib/types";
import { MUSCLE_GROUPS } from "@/lib/types";
import { MUSCLE_LABELS } from "@/lib/workouts";

interface MuscleDiagramFiles {
  anterior: string;
  posterior: string;
}

const BASE_DIAGRAM: MuscleDiagramFiles = {
  anterior: "Muscle Group=Back, View=Anterior, Dissection=Outer Muscles.svg",
  posterior: "Muscle Group=Back, View=Posterior, Dissection=Outer Muscles.svg",
};

const DIAGRAM_FILES: Record<MuscleGroup, MuscleDiagramFiles> = {
  chest: {
    anterior: "Muscle Group=Chest, View=Anterior, Dissection=Outer Muscles.svg",
    posterior: "Muscle Group=Chest, View=Posterior, Dissection=Outer Muscles.svg",
  },
  back: {
    anterior: "Muscle Group=Back, View=Anterior, Dissection=Outer Muscles.svg",
    posterior: "Muscle Group=Back, View=Posterior, Dissection=Outer Muscles.svg",
  },
  shoulders: {
    anterior: "Muscle Group=Shoulders, View=Anterior, Dissection=Outer Muscles.svg",
    posterior: "Muscle Group=Shoulders, View=Posterior, Dissection=Outer Muscles.svg",
  },
  biceps: {
    anterior: "Muscle Group=- Biceps Brachii, View=Anterior, Dissection=Outer Muscles.svg",
    posterior: "Muscle Group=- Biceps Brachii, View=Posterior, Dissection=Outer Muscles.svg",
  },
  triceps: {
    anterior: "Muscle Group=- Triceps Brachii, View=Anterior, Dissection=Outer Muscles.svg",
    posterior: "Muscle Group=- Triceps Brachii, View=Posterior, Dissection=Outer Muscles.svg",
  },
  forearms: {
    anterior: "Muscle Group=Forearms, View=Anterior, Dissection=Outer Muscles.svg",
    posterior: "Muscle Group=Forearms, View=Posterior, Dissection=Outer Muscles.svg",
  },
  core: {
    anterior: "Muscle Group=Waist, View=Anterior, Dissection=Outer Muscles.svg",
    posterior: "Muscle Group=Waist, View=Posterior, Dissection=Outer Muscles.svg",
  },
  glutes: {
    anterior: "Muscle Group=Hips, View=Anterior, Dissection=Outer Muscles.svg",
    posterior: "Muscle Group=Hips, View=Posterior, Dissection=Outer Muscles.svg",
  },
  quads: {
    anterior: "Muscle Group=- Quadriceps, View=Anterior, Dissection=Outer Muscles.svg",
    posterior: "Muscle Group=- Quadriceps, View=Posterior, Dissection=Outer Muscles.svg",
  },
  hamstrings: {
    anterior: "Muscle Group=- Hamstrings, View=Anterior, Dissection=Outer Muscles.svg",
    posterior: "Muscle Group=- Hamstrings, View=Posterior, Dissection=Outer Muscles.svg",
  },
  calves: {
    anterior: "Muscle Group=Calves, View=Anterior, Dissection=Outer Muscles.svg",
    posterior: "Muscle Group=Calves, View=Posterior, Dissection=Outer Muscles.svg",
  },
};

function toDiagramPath(fileName: string): string {
  return `/diagrams/muscular_system/${encodeURIComponent(fileName)}`;
}

function fatigueToOpacity(score: number): number {
  if (score <= 0) return 0;
  return Math.max(0.16, Math.min(0.95, score / 100));
}

function toRedOnlyDataUrl(src: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";

    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;

        const context = canvas.getContext("2d");
        if (!context) {
          resolve(src);
          return;
        }

        context.drawImage(image, 0, 0);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;

        for (let i = 0; i < pixels.length; i += 4) {
          const red = pixels[i];
          const green = pixels[i + 1];
          const blue = pixels[i + 2];
          const alpha = pixels[i + 3];

          if (alpha === 0) continue;

          const maxOther = Math.max(green, blue);
          const isRed = red > 90 && red > maxOther * 1.2 && red - maxOther > 24;

          if (!isRed) {
            pixels[i + 3] = 0;
            continue;
          }

          pixels[i + 1] = 0;
          pixels[i + 2] = 0;
        }

        context.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(src);
      }
    };

    image.onerror = () => resolve(src);
    image.src = src;
  });
}

function RedOnlyOverlay({
  src,
  opacity,
}: {
  src: string;
  opacity: number;
}) {
  const [processedSrc, setProcessedSrc] = useState<string>(src);

  useEffect(() => {
    let cancelled = false;
    setProcessedSrc(src);

    toRedOnlyDataUrl(src).then((nextSrc) => {
      if (!cancelled) setProcessedSrc(nextSrc);
    });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <img
      src={processedSrc}
      alt=""
      aria-hidden="true"
      className="absolute inset-0 w-full h-full object-contain"
      loading="lazy"
      style={{ opacity }}
    />
  );
}

interface MuscleModelProps {
  scores: Record<MuscleGroup, number>;
  title?: string;
  compact?: boolean;
}

export default function MuscleModel({ scores, title = "Muscle Load Map", compact = false }: MuscleModelProps) {
  const sorted = useMemo(
    () =>
      [...MUSCLE_GROUPS]
        .map((muscle) => ({ muscle, score: scores[muscle] || 0 }))
        .sort((a, b) => b.score - a.score),
    [scores]
  );
  const nonZero = useMemo(() => sorted.filter((entry) => entry.score > 0), [sorted]);

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3">
      <p className="text-sm font-medium mb-2">{title}</p>
      <div className={`grid ${compact ? "grid-cols-1" : "md:grid-cols-[240px,1fr]"} gap-3`}>
        <div className="mx-auto w-full max-w-[360px]">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2">
            <p className="text-xs font-medium mb-2">Overlay view (all muscle groups)</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white relative aspect-[3/4] isolate">
                <img
                  src={toDiagramPath(BASE_DIAGRAM.anterior)}
                  alt="Anterior muscle model"
                  className="absolute inset-0 w-full h-full object-contain"
                  loading="lazy"
                  style={{ opacity: 1 }}
                />
                {sorted.map(({ muscle, score }) => {
                  if (score <= 0) return null;
                  return (
                    <RedOnlyOverlay
                      key={`anterior-${muscle}`}
                      src={toDiagramPath(DIAGRAM_FILES[muscle].anterior)}
                      opacity={fatigueToOpacity(score)}
                    />
                  );
                })}
              </div>
              <div className="rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white relative aspect-[3/4] isolate">
                <img
                  src={toDiagramPath(BASE_DIAGRAM.posterior)}
                  alt="Posterior muscle model"
                  className="absolute inset-0 w-full h-full object-contain"
                  loading="lazy"
                  style={{ opacity: 1 }}
                />
                {sorted.map(({ muscle, score }) => {
                  if (score <= 0) return null;
                  return (
                    <RedOnlyOverlay
                      key={`posterior-${muscle}`}
                      src={toDiagramPath(DIAGRAM_FILES[muscle].posterior)}
                      opacity={fatigueToOpacity(score)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-2 content-start">
          {nonZero.length === 0 && (
            <p className="text-xs text-zinc-500">No current muscle fatigue recorded.</p>
          )}
          {nonZero.map(({ muscle, score }) => (
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
