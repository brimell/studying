"use client";

import { useEffect, useMemo, useState } from "react";
import type { MuscleGroup } from "@/lib/types";
import { MUSCLE_LABELS, UI_MUSCLE_GROUPS } from "@/lib/workouts";

interface MuscleDiagramFiles {
  anterior: string;
  posterior: string;
}

const BASE_DIAGRAM: MuscleDiagramFiles = {
  anterior: "Muscle Group=Back, View=Anterior, Dissection=Outer Muscles.svg",
  posterior: "Muscle Group=Back, View=Posterior, Dissection=Outer Muscles.svg",
};

const CORE_DIAGRAM_FILES: Record<
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "core"
  | "glutes"
  | "quads"
  | "hamstrings"
  | "calves",
  MuscleDiagramFiles
> = {
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

const DIAGRAM_ALIAS: Partial<Record<MuscleGroup, keyof typeof CORE_DIAGRAM_FILES>> = {
  "biceps-brachii": "biceps",
  brachialis: "biceps",
  brachioradialis: "forearms",
  "triceps-brachii": "triceps",
  "upper-arms": "shoulders",
  "wrist-extensors": "forearms",
  "wrist-flexors": "forearms",
  pronators: "forearms",
  supinators: "forearms",
  obliques: "core",
  "rectus-abdominis": "core",
  waist: "core",
  "gluteus-maximus": "glutes",
  hips: "glutes",
  "hip-flexors": "quads",
  "hip-adductors": "quads",
  "deep-external-rotators": "glutes",
  quadriceps: "quads",
  thighs: "quads",
  sartorius: "quads",
  gastrocnemius: "calves",
  soleus: "calves",
  "tibialis-anterior": "calves",
  feet: "calves",
  hands: "forearms",
  neck: "shoulders",
  "deltoid-anterior": "shoulders",
  "deltoid-medial-lateral": "shoulders",
  "deltoid-posterior": "shoulders",
  "erector-spinae": "back",
  "infraspinatus-teres-minor": "back",
  "latissimus-dorsi-teres-major": "back",
  "levator-scapulae": "back",
  "pectoralis-major": "chest",
  "pectoralis-minor": "chest",
  "quadratus-lumborum": "back",
  rhomboids: "back",
  "serratus-anterior": "chest",
  splenius: "back",
  sternocleidomastoid: "shoulders",
  subscapularis: "back",
  supraspinatus: "back",
  "trapezius-lower": "back",
  "trapezius-middle": "back",
  "trapezius-upper": "back",
  abductors: "glutes",
};

const COMMON_LABELS: Record<keyof typeof CORE_DIAGRAM_FILES, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  core: "Core",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
};

const SPECIFIC_FILE_BASE_BY_MUSCLE: Partial<Record<MuscleGroup, string>> = {
  abductors: "Muscle Group=- Abductors",
  "biceps-brachii": "Muscle Group=- Biceps Brachii",
  brachialis: "Muscle Group=- Brachialis",
  brachioradialis: "Muscle Group=- Brachioradialis",
  "triceps-brachii": "Muscle Group=- Triceps Brachii",
  "wrist-extensors": "Muscle Group=- Wrist Extensors",
  "wrist-flexors": "Muscle Group=- Wrist Flexors",
  pronators: "Muscle Group=- Pronators",
  supinators: "Muscle Group=- Supinators",
  obliques: "Muscle Group=- Obliques",
  "rectus-abdominis": "Muscle Group=- Rectus Abdominis",
  "gluteus-maximus": "Muscle Group=- Gluteus Maximus",
  "hip-flexors": "Muscle Group=- Hip Flexors",
  "hip-adductors": "Muscle Group=- Hip Adductors",
  "deep-external-rotators": "Muscle Group=- Deep External Rotators",
  quadriceps: "Muscle Group=- Quadriceps",
  sartorius: "Muscle Group=- Sartorius",
  hamstrings: "Muscle Group=- Hamstrings",
  gastrocnemius: "Muscle Group=- Gastrocnemius",
  soleus: "Muscle Group=- Soleus",
  "tibialis-anterior": "Muscle Group=- Tibialis Anterior",
  "deltoid-anterior": "Muscle Group=- Deltoid Anterior",
  "deltoid-posterior": "Muscle Group=- Deltoid Posterior",
  "erector-spinae": "Muscle Group=- Erector Spinae",
  "infraspinatus-teres-minor": "Muscle Group=- Infraspinatus & Teres Minor",
  "latissimus-dorsi-teres-major": "Muscle Group=- Latissimus Dorsi & Teres Major",
  "levator-scapulae": "Muscle Group=- Levator Scapulae",
  "pectoralis-major": "Muscle Group=- Pectoralis Major",
  "pectoralis-minor": "Muscle Group=- Pectoralis Minor",
  "quadratus-lumborum": "Muscle Group=- Quadratus Lumborum",
  rhomboids: "Muscle Group=-Rhomboids",
  "serratus-anterior": "Muscle Group=- Serratus Anterior",
  splenius: "Muscle Group=- Splenius",
  sternocleidomastoid: "Muscle Group=- Sternocleidomastoid",
  subscapularis: "Muscle Group=- Subscapularis",
  supraspinatus: "Muscle Group=- Supraspinatus",
  "trapezius-lower": "Muscle Group=- Trapezius Lower",
  "trapezius-middle": "Muscle Group=- Trapezius Middle",
  "trapezius-upper": "Muscle Group=- Trapezius Upper",
};

const SPECIFIC_DIAGRAM_FILES: Partial<Record<MuscleGroup, MuscleDiagramFiles>> = Object.fromEntries(
  Object.entries(SPECIFIC_FILE_BASE_BY_MUSCLE).map(([muscle, base]) => [
    muscle,
    {
      anterior: `${base}, View=Anterior, Dissection=Outer Muscles.svg`,
      posterior: `${base}, View=Posterior, Dissection=Outer Muscles.svg`,
    },
  ])
) as Partial<Record<MuscleGroup, MuscleDiagramFiles>>;

function getCommonGroupKey(muscle: MuscleGroup): keyof typeof CORE_DIAGRAM_FILES {
  return DIAGRAM_ALIAS[muscle] || (muscle as keyof typeof CORE_DIAGRAM_FILES) || "back";
}

function getMuscleLabel(muscle: MuscleGroup, simplified: boolean): string {
  if (!simplified) return MUSCLE_LABELS[muscle];
  const alias = getCommonGroupKey(muscle);
  return COMMON_LABELS[alias] || MUSCLE_LABELS[muscle];
}

function resolveDiagramFiles(muscle: MuscleGroup, simplified: boolean): MuscleDiagramFiles {
  if (!simplified) {
    const specific = SPECIFIC_DIAGRAM_FILES[muscle];
    if (specific) return specific;
  }
  const alias = getCommonGroupKey(muscle);
  return CORE_DIAGRAM_FILES[alias] || CORE_DIAGRAM_FILES.back;
}

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
  delayMs = 0,
  highlighted = false,
  dimmed = false,
}: {
  src: string;
  opacity: number;
  delayMs?: number;
  highlighted?: boolean;
  dimmed?: boolean;
}) {
  const [processedSrc, setProcessedSrc] = useState<string>(src);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setVisible(false);
    setProcessedSrc(src);

    toRedOnlyDataUrl(src).then((nextSrc) => {
      if (cancelled) return;
      setProcessedSrc(nextSrc);
      requestAnimationFrame(() => {
        if (!cancelled) setVisible(true);
      });
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
      style={{
        opacity: visible ? opacity : 0,
        transform: visible ? (highlighted ? "scale(1.01)" : "scale(1)") : "scale(0.98)",
        filter: highlighted
          ? "saturate(1.3) brightness(1.15) drop-shadow(0 0 8px rgba(239, 68, 68, 0.45))"
          : dimmed
            ? "brightness(0.7) saturate(0.85)"
            : "none",
        transitionProperty: "opacity, transform, filter",
        transitionDuration: "380ms, 380ms",
        transitionTimingFunction: "ease-out, ease-out",
        transitionDelay: `${delayMs}ms, ${delayMs}ms`,
      }}
    />
  );
}

interface MuscleModelProps {
  scores: Record<MuscleGroup, number>;
  title?: string;
  compact?: boolean;
}

interface DisplayMuscleEntry {
  key: string;
  label: string;
  score: number;
  muscles: MuscleGroup[];
}

export default function MuscleModel({ scores, title = "Muscle Load Map", compact = false }: MuscleModelProps) {
  const [simplifyLabels, setSimplifyLabels] = useState(false);
  const [hoveredEntryKey, setHoveredEntryKey] = useState<string | null>(null);
  const sorted = useMemo(
    () =>
      [...UI_MUSCLE_GROUPS]
        .map((muscle) => ({ muscle, score: scores[muscle] || 0 }))
        .sort((a, b) => b.score - a.score),
    [scores]
  );
  const nonZero = useMemo(() => sorted.filter((entry) => entry.score > 0), [sorted]);
  const displayEntries = useMemo<DisplayMuscleEntry[]>(() => {
    if (!simplifyLabels) {
      return nonZero.map(({ muscle, score }) => ({
        key: muscle,
        label: MUSCLE_LABELS[muscle],
        score,
        muscles: [muscle],
      }));
    }

    const grouped = new Map<keyof typeof CORE_DIAGRAM_FILES, DisplayMuscleEntry>();
    for (const { muscle, score } of nonZero) {
      const groupKey = getCommonGroupKey(muscle);
      const existing = grouped.get(groupKey);
      if (existing) {
        existing.score = Math.max(existing.score, score);
        existing.muscles.push(muscle);
      } else {
        grouped.set(groupKey, {
          key: groupKey,
          label: COMMON_LABELS[groupKey] || MUSCLE_LABELS[muscle],
          score,
          muscles: [muscle],
        });
      }
    }

    return [...grouped.values()].sort((a, b) => b.score - a.score);
  }, [nonZero, simplifyLabels]);
  const hasHover = hoveredEntryKey !== null;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-medium">{title}</p>
        <button
          type="button"
          onClick={() => setSimplifyLabels((current) => !current)}
          className="rounded-md border border-zinc-300 dark:border-zinc-600 px-2 py-1 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
        >
          {simplifyLabels ? "Show Scientific Names" : "Simplify Names"}
        </button>
      </div>
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
                {sorted.map(({ muscle, score }, index) => {
                  if (score <= 0) return null;
                  const highlighted = simplifyLabels
                    ? hoveredEntryKey === getCommonGroupKey(muscle)
                    : hoveredEntryKey === muscle;
                  const dimmed = hasHover && !highlighted;
                  return (
                    <RedOnlyOverlay
                      key={`anterior-${muscle}`}
                      src={toDiagramPath(resolveDiagramFiles(muscle, simplifyLabels).anterior)}
                      opacity={hasHover ? (highlighted ? 0.98 : fatigueToOpacity(score) * 0.2) : fatigueToOpacity(score)}
                      delayMs={index * 28}
                      highlighted={highlighted}
                      dimmed={dimmed}
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
                {sorted.map(({ muscle, score }, index) => {
                  if (score <= 0) return null;
                  const highlighted = simplifyLabels
                    ? hoveredEntryKey === getCommonGroupKey(muscle)
                    : hoveredEntryKey === muscle;
                  const dimmed = hasHover && !highlighted;
                  return (
                    <RedOnlyOverlay
                      key={`posterior-${muscle}`}
                      src={toDiagramPath(resolveDiagramFiles(muscle, simplifyLabels).posterior)}
                      opacity={hasHover ? (highlighted ? 0.98 : fatigueToOpacity(score) * 0.2) : fatigueToOpacity(score)}
                      delayMs={index * 28}
                      highlighted={highlighted}
                      dimmed={dimmed}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-2 content-start">
          {displayEntries.length === 0 && (
            <p className="text-xs text-zinc-500">No current muscle fatigue recorded.</p>
          )}
          {displayEntries.map((entry) => (
            <div
              key={entry.key}
              className={`rounded-md border bg-white dark:bg-zinc-900 px-2 py-1.5 transition-colors ${
                hoveredEntryKey === entry.key
                  ? "border-red-400/70 dark:border-red-400/60 bg-red-50/60 dark:bg-red-900/20"
                  : "border-zinc-200 dark:border-zinc-700"
              }`}
              onMouseEnter={() => setHoveredEntryKey(entry.key)}
              onMouseLeave={() => setHoveredEntryKey((current) => (current === entry.key ? null : current))}
              onFocus={() => setHoveredEntryKey(entry.key)}
              onBlur={() => setHoveredEntryKey((current) => (current === entry.key ? null : current))}
              tabIndex={0}
            >
              <div className="flex items-center justify-between text-xs">
                <span>{entry.label}</span>
                <span className="font-medium">{entry.score}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 mt-1">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(0, Math.min(100, entry.score))}%`,
                    background: entry.score > 70 ? "#ef4444" : entry.score > 40 ? "#f59e0b" : "#0ea5e9",
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
