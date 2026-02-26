"use client";

import { useEffect, useMemo, useState } from "react";
import type { MuscleGroup } from "@/lib/types";
import { MUSCLE_LABELS, UI_MUSCLE_GROUPS } from "@/lib/workouts";

interface MuscleDiagramFiles {
  anterior: string;
  posterior: string;
}

type DissectionLayer = "Outer Muscles" | "Inner Muscles";
type DiagramView = keyof MuscleDiagramFiles;

const BASE_DIAGRAM: Record<DissectionLayer, MuscleDiagramFiles> = {
  "Outer Muscles": {
    anterior: "View=Anterior, Dissection=Outer Muscles, Color=No.svg",
    posterior: "View=Posterior, Dissection=Outer Muscles, Color=No.svg",
  },
  "Inner Muscles": {
    anterior: "View=Anterior, Dissection=Inner Muscles, Color=No.svg",
    posterior: "View=Posterior, Dissection=Inner Muscles, Color=No.svg",
  },
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

function applyDissection(fileName: string, dissection: DissectionLayer): string {
  return fileName.replace("Dissection=Outer Muscles", `Dissection=${dissection}`);
}

function resolveDiagramFiles(
  muscle: MuscleGroup,
  simplified: boolean,
  dissection: DissectionLayer
): MuscleDiagramFiles {
  if (!simplified) {
    const specific = SPECIFIC_DIAGRAM_FILES[muscle];
    if (specific) {
      return {
        anterior: applyDissection(specific.anterior, dissection),
        posterior: applyDissection(specific.posterior, dissection),
      };
    }
  }
  const alias = getCommonGroupKey(muscle);
  const base = CORE_DIAGRAM_FILES[alias] || CORE_DIAGRAM_FILES.back;
  return {
    anterior: applyDissection(base.anterior, dissection),
    posterior: applyDissection(base.posterior, dissection),
  };
}

const DIAGRAM_ASSET_VERSION = "mask-v2";

function toDiagramPath(fileName: string): string {
  return `/diagrams/muscular_system/${encodeURIComponent(fileName)}?v=${DIAGRAM_ASSET_VERSION}`;
}

function fatigueToOpacity(score: number, minimumOpacity = 0.16): number {
  if (score <= 0) return 0;
  return Math.max(minimumOpacity, Math.min(0.95, score / 100));
}

const overlayImageCache = new Map<string, string>();
const overlayImagePromiseCache = new Map<string, Promise<string>>();
const TRANSPARENT_PIXEL_DATA_URL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const DEFAULT_NEUTRAL_FILL_COLORS = new Set([
  "#bdbdbd",
  "#e0e0e0",
  "#f5f5f5",
  "#d9d9d9",
  "#616161",
]);

function getOverlayCacheKey(src: string, baseSrc: string): string {
  return `${src}::${baseSrc}`;
}

function normalizeSvgColor(color: string | null): string | null {
  if (!color) return null;
  const normalized = color.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "transparent") return null;
  return normalized;
}

function loadSvgText(src: string): Promise<string> {
  return fetch(src)
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load SVG: ${src}`);
      return response.text();
    })
    .then((text) => text || "");
}

function collectFillColors(svgText: string): Set<string> {
  const parser = new DOMParser();
  const svgDocument = parser.parseFromString(svgText, "image/svg+xml");
  const colors = new Set<string>();

  svgDocument.querySelectorAll("[fill]").forEach((node) => {
    const color = normalizeSvgColor(node.getAttribute("fill"));
    if (!color) return;
    colors.add(color);
  });

  return colors;
}

function createRedMaskSvgDataUrl(overlaySvgText: string, neutralFillColors: Set<string>): string {
  const parser = new DOMParser();
  const overlayDocument = parser.parseFromString(overlaySvgText, "image/svg+xml");
  const overlaySvg = overlayDocument.documentElement;
  if (!overlaySvg || overlaySvg.tagName.toLowerCase() !== "svg") return TRANSPARENT_PIXEL_DATA_URL;

  const outputDocument = document.implementation.createDocument("http://www.w3.org/2000/svg", "svg", null);
  const outputSvg = outputDocument.documentElement;

  for (const attribute of Array.from(overlaySvg.attributes)) {
    outputSvg.setAttribute(attribute.name, attribute.value);
  }

  let keptElements = 0;
  overlayDocument.querySelectorAll("[fill]").forEach((node) => {
    const fillColor = normalizeSvgColor(node.getAttribute("fill"));
    if (!fillColor || neutralFillColors.has(fillColor)) return;

    const cloned = outputDocument.importNode(node, true) as Element;
    cloned.setAttribute("fill", "#ff0000");
    cloned.removeAttribute("stroke");
    cloned.removeAttribute("style");
    outputSvg.appendChild(cloned);
    keptElements += 1;
  });

  if (keptElements === 0) return TRANSPARENT_PIXEL_DATA_URL;

  const serialized = new XMLSerializer().serializeToString(outputSvg);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
}

function toRedOnlyDataUrl(src: string, baseSrc: string): Promise<string> {
  const cacheKey = getOverlayCacheKey(src, baseSrc);
  const cached = overlayImageCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const pending = overlayImagePromiseCache.get(cacheKey);
  if (pending) return pending;

  const promise = new Promise<string>((resolve) => {
    Promise.all([loadSvgText(src), loadSvgText(baseSrc)])
      .then(([overlaySvgText, baseSvgText]) => {
        try {
          const baseColors = collectFillColors(baseSvgText);
          const neutralColors = baseColors.size > 0 ? baseColors : DEFAULT_NEUTRAL_FILL_COLORS;
          const dataUrl = createRedMaskSvgDataUrl(overlaySvgText, neutralColors);
          overlayImageCache.set(cacheKey, dataUrl);
          overlayImagePromiseCache.delete(cacheKey);
          resolve(dataUrl);
        } catch {
          overlayImageCache.set(cacheKey, TRANSPARENT_PIXEL_DATA_URL);
          overlayImagePromiseCache.delete(cacheKey);
          resolve(TRANSPARENT_PIXEL_DATA_URL);
        }
      })
      .catch(() => {
        overlayImageCache.set(cacheKey, TRANSPARENT_PIXEL_DATA_URL);
        overlayImagePromiseCache.delete(cacheKey);
        resolve(TRANSPARENT_PIXEL_DATA_URL);
      });
  });

  overlayImagePromiseCache.set(cacheKey, promise);
  return promise;
}

function RedOnlyOverlay({
  src,
  baseSrc,
  opacity,
  delayMs = 0,
  highlighted = false,
  dimmed = false,
}: {
  src: string;
  baseSrc: string;
  opacity: number;
  delayMs?: number;
  highlighted?: boolean;
  dimmed?: boolean;
}) {
  const cacheKey = getOverlayCacheKey(src, baseSrc);
  const [processedSrc, setProcessedSrc] = useState<string>(
    () => overlayImageCache.get(cacheKey) || TRANSPARENT_PIXEL_DATA_URL
  );

  useEffect(() => {
    let cancelled = false;
    const cached = overlayImageCache.get(cacheKey);
    if (cached) {
      setProcessedSrc((previous) => (previous === cached ? previous : cached));
      return () => {
        cancelled = true;
      };
    }

    toRedOnlyDataUrl(src, baseSrc).then((nextSrc) => {
      if (cancelled) return;
      setProcessedSrc((previous) => (previous === nextSrc ? previous : nextSrc));
    });

    return () => {
      cancelled = true;
    };
  }, [baseSrc, cacheKey, src]);

  return (
    <img
      src={processedSrc}
      alt=""
      aria-hidden="true"
      className="absolute inset-0 w-full h-full object-contain"
      loading="lazy"
      style={{
        opacity,
        transform: highlighted ? "scale(1.01)" : "scale(1)",
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
  loadPoints?: Partial<Record<MuscleGroup, number>>;
  title?: string;
  compact?: boolean;
}

interface DisplayMuscleEntry {
  key: string;
  label: string;
  score: number;
  muscles: MuscleGroup[];
}

export default function MuscleModel({
  scores,
  loadPoints,
  title = "Muscle Load Map",
  compact = false,
}: MuscleModelProps) {
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
  const simplifiedGroupScoreByKey = useMemo(() => {
    const map = new Map<keyof typeof CORE_DIAGRAM_FILES, number>();
    for (const { muscle, score } of nonZero) {
      const groupKey = getCommonGroupKey(muscle);
      const existing = map.get(groupKey) || 0;
      map.set(groupKey, Math.max(existing, score));
    }
    return map;
  }, [nonZero]);
  const normalizedLoadByMuscle = useMemo(() => {
    const map = new Map<MuscleGroup, number>();
    if (!loadPoints) return map;

    let maxLoad = 0;
    for (const muscle of UI_MUSCLE_GROUPS) {
      const load = Math.max(0, loadPoints[muscle] || 0);
      if (load > maxLoad) maxLoad = load;
    }
    if (maxLoad <= 0) return map;

    for (const muscle of UI_MUSCLE_GROUPS) {
      const load = Math.max(0, loadPoints[muscle] || 0);
      map.set(muscle, (load / maxLoad) * 100);
    }
    return map;
  }, [loadPoints]);
  const simplifiedGroupLoadByKey = useMemo(() => {
    const map = new Map<keyof typeof CORE_DIAGRAM_FILES, number>();
    if (normalizedLoadByMuscle.size === 0) return map;

    for (const muscle of UI_MUSCLE_GROUPS) {
      const value = normalizedLoadByMuscle.get(muscle) || 0;
      if (value <= 0) continue;
      const groupKey = getCommonGroupKey(muscle);
      const existing = map.get(groupKey) || 0;
      map.set(groupKey, Math.max(existing, value));
    }
    return map;
  }, [normalizedLoadByMuscle]);
  const hasHover = hoveredEntryKey !== null;
  const renderOverlayPanel = (view: DiagramView, dissection: DissectionLayer) => (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white relative aspect-[3/4] isolate">
      {(() => {
        const baseSrc = toDiagramPath(BASE_DIAGRAM[dissection][view]);
        return (
          <>
      <img
        src={baseSrc}
        alt={`${view === "anterior" ? "Anterior" : "Posterior"} ${dissection.toLowerCase()} muscle model`}
        className="absolute inset-0 w-full h-full object-contain"
        loading="lazy"
        style={{ opacity: 1 }}
      />
      {sorted.map(({ muscle, score }, index) => {
        if (score <= 0) return null;
        const groupKey = getCommonGroupKey(muscle);
        const effectiveScore = simplifiedGroupScoreByKey.get(groupKey) ?? score;
        const normalizedLoad = normalizedLoadByMuscle.get(muscle) ?? 0;
        const effectiveNormalizedLoad = simplifyLabels
          ? (simplifiedGroupLoadByKey.get(groupKey) ?? normalizedLoad)
          : normalizedLoad;
        // Load points drive relative intensity, but soreness score caps maximum opacity.
        const opacitySource =
          effectiveNormalizedLoad > 0
            ? (effectiveNormalizedLoad * effectiveScore) / 100
            : effectiveScore;
        const usesLoadDrivenOpacity = effectiveNormalizedLoad > 0;
        const highlighted = simplifyLabels ? hoveredEntryKey === groupKey : hoveredEntryKey === muscle;
        const dimmed = hasHover && !highlighted;
        return (
          <RedOnlyOverlay
            key={`${dissection}-${view}-${muscle}`}
            src={toDiagramPath(resolveDiagramFiles(muscle, simplifyLabels, dissection)[view])}
            baseSrc={baseSrc}
            opacity={
              hasHover
                ? (highlighted ? 0.98 : 0.02)
                : fatigueToOpacity(opacitySource, usesLoadDrivenOpacity ? 0 : 0.16)
            }
            delayMs={index * 28}
            highlighted={highlighted}
            dimmed={dimmed}
          />
        );
      })}
          </>
        );
      })()}
    </div>
  );

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
            <p className="text-xs font-medium mb-2">Overlay view (outer + inner muscle groups)</p>
            <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-500 dark:text-zinc-400 mb-1 px-1">
              <span>Anterior</span>
              <span>Posterior</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {renderOverlayPanel("anterior", "Outer Muscles")}
              {renderOverlayPanel("posterior", "Outer Muscles")}
              {renderOverlayPanel("anterior", "Inner Muscles")}
              {renderOverlayPanel("posterior", "Inner Muscles")}
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
