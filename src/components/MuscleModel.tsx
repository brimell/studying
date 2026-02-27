"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MuscleGroup } from "@/lib/types";
import { MUSCLE_LABELS, UI_MUSCLE_GROUPS } from "@/lib/workouts";

interface MuscleDiagramFiles {
  anterior: string;
  posterior: string;
}

type DissectionLayer = "Outer Muscles" | "Inner Muscles";
type DiagramView = keyof MuscleDiagramFiles;
type CommonGroupKey = keyof typeof CORE_DIAGRAM_FILES;
type SkeletalRegionKey =
  | "spine"
  | "ribs-sternum"
  | "pelvis"
  | "scapulae"
  | "humerus"
  | "radius-ulna"
  | "femur-patella"
  | "tibia-fibula";
type OrganRegionKey =
  | "heart"
  | "lungs"
  | "brain"
  | "nervous-system"
  | "digestive-system"
  | "liver-gallbladder"
  | "kidneys-bladder"
  | "endocrine-system"
  | "immune-system";

const ORGAN_REGION_KEYS = [
  "heart",
  "lungs",
  "brain",
  "nervous-system",
  "digestive-system",
  "liver-gallbladder",
  "kidneys-bladder",
  "endocrine-system",
  "immune-system",
] as const satisfies readonly OrganRegionKey[];

function isOrganRegionKey(value: string): value is OrganRegionKey {
  return (ORGAN_REGION_KEYS as readonly string[]).includes(value);
}

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

const SKELETAL_REGION_LABELS: Record<SkeletalRegionKey, string> = {
  spine: "Spine",
  "ribs-sternum": "Ribs & Sternum",
  pelvis: "Pelvis",
  scapulae: "Scapulae",
  humerus: "Humerus",
  "radius-ulna": "Radius & Ulna",
  "femur-patella": "Femur & Patella",
  "tibia-fibula": "Tibia & Fibula",
};

const ORGAN_REGION_LABELS: Record<OrganRegionKey, string> = {
  heart: "Heart",
  lungs: "Lungs",
  brain: "Brain",
  "nervous-system": "Nervous System",
  "digestive-system": "Digestive System",
  "liver-gallbladder": "Liver & Gallbladder",
  "kidneys-bladder": "Kidneys & Bladder",
  "endocrine-system": "Endocrine System",
  "immune-system": "Immune System",
};

const SKELETAL_REGION_FILES: Record<SkeletalRegionKey, MuscleDiagramFiles> = {
  spine: {
    anterior: "View=Anterior, Callout=Spine with Sacrus & Coccyx.svg",
    posterior: "View=Posterior, Callout=Spine with Sacrus & Coccyx.svg",
  },
  "ribs-sternum": {
    anterior: "View=Anterior, Callout=Ribs & Sternum.svg",
    posterior: "View=Posterior, Callout=Ribs & Sternum.svg",
  },
  pelvis: {
    anterior: "View=Anterior, Callout=Pelvis.svg",
    posterior: "View=Posterior, Callout=Pelvis.svg",
  },
  scapulae: {
    anterior: "View=Anterior, Callout=Scapulae.svg",
    posterior: "View=Posterior, Callout=Scapulae.svg",
  },
  humerus: {
    anterior: "View=Anterior, Callout=Humerus.svg",
    posterior: "View=Posterior, Callout=Humerus.svg",
  },
  "radius-ulna": {
    anterior: "View=Anterior, Callout=Radius & Ulna.svg",
    posterior: "View=Posterior, Callout=Radius & Ulna.svg",
  },
  "femur-patella": {
    anterior: "View=Anterior, Callout=Femur & Patella.svg",
    posterior: "View=Posterior, Callout=Femur & Patella.svg",
  },
  "tibia-fibula": {
    anterior: "View=Anterior, Callout=Tibia & Fibula.svg",
    posterior: "View=Posterior, Callout=Tibia & Fibula.svg",
  },
};

const ORGAN_REGION_FILES: Record<OrganRegionKey, string> = {
  heart: "Callout=Heart.svg",
  lungs: "Callout=Lungs.svg",
  brain: "Callout=Brain.svg",
  "nervous-system": "Callout=Nervous System.svg",
  "digestive-system": "Callout=Digestive System.svg",
  "liver-gallbladder": "Callout=Liver & Gallbladder.svg",
  "kidneys-bladder": "Callout=Kidneys & Bladder.svg",
  "endocrine-system": "Callout=Male Endocrine System.svg",
  "immune-system": "Callout=Imune System.svg",
};

const BONE_EFFECTS_BY_GROUP: Record<CommonGroupKey, Partial<Record<SkeletalRegionKey, number>>> = {
  chest: { "ribs-sternum": 1, humerus: 0.5, scapulae: 0.45 },
  back: { spine: 1, scapulae: 0.75, pelvis: 0.5, "ribs-sternum": 0.35 },
  shoulders: { scapulae: 1, humerus: 0.8, "ribs-sternum": 0.35, spine: 0.25 },
  biceps: { humerus: 0.8, "radius-ulna": 1, scapulae: 0.25 },
  triceps: { humerus: 1, "radius-ulna": 0.75, scapulae: 0.25 },
  forearms: { "radius-ulna": 1, humerus: 0.35 },
  core: { spine: 0.9, pelvis: 0.8, "ribs-sternum": 0.45 },
  glutes: { pelvis: 1, spine: 0.65, "femur-patella": 0.35 },
  quads: { "femur-patella": 1, pelvis: 0.45, "tibia-fibula": 0.5 },
  hamstrings: { pelvis: 0.75, "femur-patella": 0.9, "tibia-fibula": 0.45 },
  calves: { "tibia-fibula": 1, "femur-patella": 0.35, pelvis: 0.25 },
};

const ORGAN_EFFECTS_BY_GROUP: Record<CommonGroupKey, Partial<Record<OrganRegionKey, number>>> = {
  chest: { heart: 1, lungs: 1, "immune-system": 0.25 },
  back: { lungs: 0.65, "digestive-system": 0.4, "kidneys-bladder": 0.45, "nervous-system": 0.45 },
  shoulders: { heart: 0.35, lungs: 0.5, "nervous-system": 0.4 },
  biceps: { heart: 0.35, "nervous-system": 0.5, "endocrine-system": 0.2 },
  triceps: { heart: 0.35, "nervous-system": 0.5, "endocrine-system": 0.2 },
  forearms: { heart: 0.25, "nervous-system": 0.45 },
  core: {
    "digestive-system": 1,
    "liver-gallbladder": 0.7,
    "kidneys-bladder": 0.7,
    "endocrine-system": 0.45,
  },
  glutes: { heart: 0.55, "digestive-system": 0.35, "kidneys-bladder": 0.5, "endocrine-system": 0.4 },
  quads: { heart: 0.65, lungs: 0.45, "digestive-system": 0.25, "immune-system": 0.2 },
  hamstrings: { heart: 0.65, lungs: 0.45, "digestive-system": 0.25, "immune-system": 0.2 },
  calves: { heart: 0.6, lungs: 0.4, "immune-system": 0.2 },
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
  rhomboids: "Muscle Group=- Rhomboids",
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

function toSkeletalPath(fileName: string): string {
  return `/diagrams/skeletal_system/${encodeURIComponent(fileName)}?v=${DIAGRAM_ASSET_VERSION}`;
}

function toOrganPath(fileName: string): string {
  return `/diagrams/organs/${encodeURIComponent(fileName)}?v=${DIAGRAM_ASSET_VERSION}`;
}

function normalizedGradeToOpacity(grade: number): number {
  if (grade <= 0) return 0;
  const clamped = Math.max(0, Math.min(100, grade)) / 100;
  const lifted = Math.pow(clamped, 0.68);
  return Math.max(0.2, Math.min(0.98, 0.2 + lifted * 0.78));
}

function normalizeRegionScores<TRegion extends string>(raw: Map<TRegion, number>): Map<TRegion, number> {
  let maxRaw = 0;
  for (const value of raw.values()) {
    if (value > maxRaw) maxRaw = value;
  }
  if (maxRaw <= 0) return new Map<TRegion, number>();

  const normalized = new Map<TRegion, number>();
  for (const [region, value] of raw.entries()) {
    normalized.set(region, (value / maxRaw) * 100);
  }
  return normalized;
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
  fallbackSrc,
  opacity,
  delayMs = 0,
  highlighted = false,
  dimmed = false,
}: {
  src: string;
  baseSrc: string;
  fallbackSrc?: string;
  opacity: number;
  delayMs?: number;
  highlighted?: boolean;
  dimmed?: boolean;
}) {
  const cacheKey = getOverlayCacheKey(src, baseSrc);
  const [processedOverlay, setProcessedOverlay] = useState<{ key: string; src: string }>({
    key: cacheKey,
    src: overlayImageCache.get(cacheKey) || TRANSPARENT_PIXEL_DATA_URL,
  });
  const processedSrc =
    processedOverlay.key === cacheKey
      ? processedOverlay.src
      : overlayImageCache.get(cacheKey) || TRANSPARENT_PIXEL_DATA_URL;

  useEffect(() => {
    let cancelled = false;
    toRedOnlyDataUrl(src, baseSrc).then((nextSrc) => {
      if (cancelled) return;
      const applySource = (resolvedSrc: string) => {
        if (cancelled) return;
        setProcessedOverlay((previous) =>
          previous.key === cacheKey && previous.src === resolvedSrc
            ? previous
            : { key: cacheKey, src: resolvedSrc }
        );
      };

      if (
        nextSrc === TRANSPARENT_PIXEL_DATA_URL &&
        fallbackSrc &&
        fallbackSrc !== src
      ) {
        toRedOnlyDataUrl(fallbackSrc, baseSrc).then((fallbackResolvedSrc) => {
          applySource(fallbackResolvedSrc);
        });
        return;
      }

      applySource(nextSrc);
    });

    return () => {
      cancelled = true;
    };
  }, [baseSrc, cacheKey, fallbackSrc, src]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={processedSrc}
      alt=""
      aria-hidden="true"
      className="absolute inset-0 w-full h-full object-contain"
      loading="lazy"
      onError={(event) => {
        const target = event.currentTarget;
        if (target.dataset.fallbackApplied === "1") {
          target.style.display = "none";
          return;
        }
        target.dataset.fallbackApplied = "1";
        target.src = TRANSPARENT_PIXEL_DATA_URL;
      }}
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

interface OverlayRenderEntry {
  key: string;
  src: string;
  fallbackSrc?: string;
  opacity: number;
  delayMs: number;
  hoverKeys: string[];
}

function OverlayPanel({
  baseSrc,
  alt,
  overlays,
  hoveredEntryKeys,
  hasHover,
  lazyRender = true,
}: {
  baseSrc: string;
  alt: string;
  overlays: OverlayRenderEntry[];
  hoveredEntryKeys: Set<string>;
  hasHover: boolean;
  lazyRender?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const showOverlays = !lazyRender || isVisible;

  useEffect(() => {
    if (!lazyRender) return;
    if (isVisible) return;
    const node = panelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setIsVisible(true);
        observer.disconnect();
      },
      { rootMargin: "120px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible, lazyRender]);

  return (
    <div
      ref={panelRef}
      className="rounded-md border border-zinc-200 overflow-hidden bg-white relative aspect-[3/4] isolate"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={baseSrc}
        alt={alt}
        className="absolute inset-0 w-full h-full object-contain"
        loading="lazy"
        onError={(event) => {
          const target = event.currentTarget;
          if (target.dataset.fallbackApplied === "1") {
            target.style.display = "none";
            return;
          }
          target.dataset.fallbackApplied = "1";
          target.src = TRANSPARENT_PIXEL_DATA_URL;
        }}
        style={{ opacity: 1 }}
      />
      {showOverlays &&
        overlays.map((overlay) => {
          const highlighted =
            hoveredEntryKeys.size > 0 &&
            overlay.hoverKeys.some((hoverKey) => hoveredEntryKeys.has(hoverKey));
          const dimmed = hasHover && !highlighted;
          return (
            <RedOnlyOverlay
              key={overlay.key}
              src={overlay.src}
              baseSrc={baseSrc}
              fallbackSrc={overlay.fallbackSrc}
              opacity={hasHover ? (highlighted ? 0.98 : 0.02) : overlay.opacity}
              delayMs={overlay.delayMs}
              highlighted={highlighted}
              dimmed={dimmed}
            />
          );
        })}
    </div>
  );
}

interface MuscleModelProps {
  scores: Record<MuscleGroup, number>;
  loadPoints?: Partial<Record<MuscleGroup, number>>;
  title?: string;
  compact?: boolean;
  lazyOverlayRender?: boolean;
  forceSimplifiedOverlays?: boolean;
  showOrganPanel?: boolean;
  organOnly?: boolean;
  onHighlightedMusclesChange?: (muscles: MuscleGroup[]) => void;
  highlightedMuscles?: MuscleGroup[];
  extraOrganScores?: Partial<Record<string, number>>;
  extraOrganNotes?: string[];
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
  lazyOverlayRender = true,
  forceSimplifiedOverlays = false,
  showOrganPanel = true,
  organOnly = false,
  onHighlightedMusclesChange,
  highlightedMuscles = [],
  extraOrganScores,
  extraOrganNotes = [],
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
  const normalizedGradeByMuscle = useMemo(() => {
    const hasLoadData = normalizedLoadByMuscle.size > 0;
    const rawGrade = new Map<MuscleGroup, number>();
    let maxRawGrade = 0;

    for (const { muscle, score } of nonZero) {
      const normalizedLoad = normalizedLoadByMuscle.get(muscle) ?? 0;
      const grade = hasLoadData ? normalizedLoad : score;
      if (grade <= 0) continue;
      rawGrade.set(muscle, grade);
      if (grade > maxRawGrade) maxRawGrade = grade;
    }

    if (maxRawGrade <= 0) return new Map<MuscleGroup, number>();

    const normalized = new Map<MuscleGroup, number>();
    for (const [muscle, grade] of rawGrade.entries()) {
      normalized.set(muscle, (grade / maxRawGrade) * 100);
    }
    return normalized;
  }, [nonZero, normalizedLoadByMuscle]);
  const commonGroupGrade = useMemo(() => {
    const grouped = new Map<CommonGroupKey, number>();
    for (const { muscle } of nonZero) {
      const group = getCommonGroupKey(muscle);
      const grade = normalizedGradeByMuscle.get(muscle) || 0;
      if (grade <= 0) continue;
      grouped.set(group, Math.max(grouped.get(group) || 0, grade));
    }
    return grouped;
  }, [nonZero, normalizedGradeByMuscle]);
  const normalizedBoneScores = useMemo(() => {
    const raw = new Map<SkeletalRegionKey, number>();
    for (const [group, grade] of commonGroupGrade.entries()) {
      const effects = BONE_EFFECTS_BY_GROUP[group];
      for (const [region, weight] of Object.entries(effects) as Array<[SkeletalRegionKey, number]>) {
        if (weight <= 0) continue;
        raw.set(region, (raw.get(region) || 0) + grade * weight);
      }
    }
    return normalizeRegionScores(raw);
  }, [commonGroupGrade]);
  const workoutNormalizedOrganScores = useMemo(() => {
    const raw = new Map<OrganRegionKey, number>();
    for (const [group, grade] of commonGroupGrade.entries()) {
      const effects = ORGAN_EFFECTS_BY_GROUP[group];
      for (const [region, weight] of Object.entries(effects) as Array<[OrganRegionKey, number]>) {
        if (weight <= 0) continue;
        raw.set(region, (raw.get(region) || 0) + grade * weight);
      }
    }
    return normalizeRegionScores(raw);
  }, [commonGroupGrade]);
  const trackerOrganScores = useMemo(() => {
    const normalized = new Map<OrganRegionKey, number>();
    if (!extraOrganScores) return normalized;
    for (const [region, rawScore] of Object.entries(extraOrganScores)) {
      if (!isOrganRegionKey(region)) continue;
      if (!Number.isFinite(rawScore)) continue;
      const clamped = Math.max(0, Math.min(100, Number(rawScore)));
      if (clamped <= 0) continue;
      normalized.set(region, clamped);
    }
    return normalized;
  }, [extraOrganScores]);
  const normalizedOrganScores = useMemo(() => {
    if (trackerOrganScores.size === 0) return workoutNormalizedOrganScores;
    const merged = new Map<OrganRegionKey, number>(workoutNormalizedOrganScores);
    for (const [region, score] of trackerOrganScores.entries()) {
      merged.set(region, Math.max(merged.get(region) || 0, score));
    }
    return merged;
  }, [trackerOrganScores, workoutNormalizedOrganScores]);
  const externalHoveredKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const muscle of highlightedMuscles) {
      keys.add(muscle);
      keys.add(String(getCommonGroupKey(muscle)));
    }
    return keys;
  }, [highlightedMuscles]);
  const activeHoveredKeys = useMemo(() => {
    const keys = new Set<string>();
    if (hoveredEntryKey) keys.add(hoveredEntryKey);
    for (const key of externalHoveredKeys) {
      keys.add(key);
    }
    return keys;
  }, [externalHoveredKeys, hoveredEntryKey]);
  const hasHover = activeHoveredKeys.size > 0;
  const overlayPanels = useMemo(
    () =>
      (
        [
          { view: "anterior" as const, dissection: "Outer Muscles" as const },
          { view: "posterior" as const, dissection: "Outer Muscles" as const },
          { view: "anterior" as const, dissection: "Inner Muscles" as const },
          { view: "posterior" as const, dissection: "Inner Muscles" as const },
        ] satisfies Array<{ view: DiagramView; dissection: DissectionLayer }>
      ).map(({ view, dissection }) => {
        const baseSrc = toDiagramPath(BASE_DIAGRAM[dissection][view]);
        const groupedOverlays = new Map<
          string,
          {
            opacity: number;
            hoverKeys: Set<string>;
            ordinal: number;
            fallbackSrc?: string;
          }
        >();

        for (const { muscle } of sorted) {
          const normalizedGrade = normalizedGradeByMuscle.get(muscle) || 0;
          if (normalizedGrade <= 0) continue;

          const useSimplifiedOverlay = forceSimplifiedOverlays || simplifyLabels;
          const src = toDiagramPath(resolveDiagramFiles(muscle, useSimplifiedOverlay, dissection)[view]);
          const fallbackSrc = simplifyLabels
            ? undefined
            : toDiagramPath(resolveDiagramFiles(muscle, true, dissection)[view]);
          const hoverKey = String(useSimplifiedOverlay ? getCommonGroupKey(muscle) : muscle);
          const opacity = normalizedGradeToOpacity(normalizedGrade);
          const existing = groupedOverlays.get(src);
          if (existing) {
            existing.opacity = Math.max(existing.opacity, opacity);
            existing.hoverKeys.add(hoverKey);
            if (fallbackSrc && !existing.fallbackSrc) {
              existing.fallbackSrc = fallbackSrc;
            }
            continue;
          }
          groupedOverlays.set(src, {
            opacity,
            hoverKeys: new Set([hoverKey]),
            ordinal: groupedOverlays.size,
            fallbackSrc,
          });
        }

        const overlays: OverlayRenderEntry[] = [...groupedOverlays.entries()]
          .sort((left, right) => left[1].ordinal - right[1].ordinal)
          .map(([src, overlay], index) => ({
            key: `${dissection}-${view}-${src}`,
            src,
            fallbackSrc: overlay.fallbackSrc,
            opacity: overlay.opacity,
            delayMs: index * 22,
            hoverKeys: [...overlay.hoverKeys],
          }));

        return {
          key: `${dissection}-${view}`,
          view,
          dissection,
          baseSrc,
          overlays,
        };
      }),
    [forceSimplifiedOverlays, normalizedGradeByMuscle, simplifyLabels, sorted]
  );
  const skeletalPanels = useMemo(
    () => {
      const hoverKeysByRegion = new Map<SkeletalRegionKey, Set<string>>();
      for (const { muscle, score } of nonZero) {
        if (score <= 0) continue;
        const group = getCommonGroupKey(muscle);
        const effects = BONE_EFFECTS_BY_GROUP[group];
        for (const [region, weight] of Object.entries(effects) as Array<[SkeletalRegionKey, number]>) {
          if (weight <= 0) continue;
          const existing = hoverKeysByRegion.get(region) || new Set<string>();
          existing.add(muscle);
          existing.add(String(group));
          hoverKeysByRegion.set(region, existing);
        }
      }

      return (["anterior", "posterior"] as const).map((view) => {
        const baseSrc = toSkeletalPath(
          view === "anterior" ? "View=Anterior.svg" : "View=Posterior.svg"
        );
        const overlays: OverlayRenderEntry[] = [...normalizedBoneScores.entries()]
          .filter(([, score]) => score > 0)
          .map(([region, score], index) => ({
            key: `skeleton-${view}-${region}`,
            src: toSkeletalPath(SKELETAL_REGION_FILES[region][view]),
            opacity: normalizedGradeToOpacity(score),
            delayMs: index * 20,
            hoverKeys: [...(hoverKeysByRegion.get(region) || new Set<string>())],
          }));
        return { key: `skeleton-${view}`, view, baseSrc, overlays };
      });
    },
    [nonZero, normalizedBoneScores]
  );
  const organPanel = useMemo(() => {
    const baseSrc = toOrganPath("Reproductive Organ=None.svg");
    const overlays: OverlayRenderEntry[] = [...normalizedOrganScores.entries()]
      .filter(([, score]) => score > 0)
      .map(([region, score], index) => ({
        key: `organ-${region}`,
        src: toOrganPath(ORGAN_REGION_FILES[region]),
        opacity: normalizedGradeToOpacity(score),
        delayMs: index * 20,
        hoverKeys: [region],
      }));
    return { key: "organs", baseSrc, overlays };
  }, [normalizedOrganScores]);
  const topBoneEntries = useMemo(
    () =>
      [...normalizedBoneScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [normalizedBoneScores]
  );
  const topOrganEntries = useMemo(
    () =>
      [...normalizedOrganScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [normalizedOrganScores]
  );

  useEffect(() => {
    if (!onHighlightedMusclesChange) return;
    if (!hoveredEntryKey) {
      onHighlightedMusclesChange([]);
      return;
    }
    const activeEntry = displayEntries.find((entry) => entry.key === hoveredEntryKey);
    onHighlightedMusclesChange(activeEntry?.muscles || []);
  }, [displayEntries, hoveredEntryKey, onHighlightedMusclesChange]);

  useEffect(() => {
    const warmedPairs = new Set<string>();
    for (const panel of overlayPanels) {
      for (const overlay of panel.overlays) {
        const pairKey = getOverlayCacheKey(overlay.src, panel.baseSrc);
        if (warmedPairs.has(pairKey)) continue;
        warmedPairs.add(pairKey);
        void toRedOnlyDataUrl(overlay.src, panel.baseSrc);
      }
    }
  }, [overlayPanels]);

  useEffect(() => {
    if (!showOrganPanel) return;
    const warmedPairs = new Set<string>();
    for (const panel of skeletalPanels) {
      for (const overlay of panel.overlays) {
        const pairKey = getOverlayCacheKey(overlay.src, panel.baseSrc);
        if (warmedPairs.has(pairKey)) continue;
        warmedPairs.add(pairKey);
        void toRedOnlyDataUrl(overlay.src, panel.baseSrc);
      }
    }
    for (const overlay of organPanel.overlays) {
      const pairKey = getOverlayCacheKey(overlay.src, organPanel.baseSrc);
      if (warmedPairs.has(pairKey)) continue;
      warmedPairs.add(pairKey);
      void toRedOnlyDataUrl(overlay.src, organPanel.baseSrc);
    }
  }, [organPanel, skeletalPanels, showOrganPanel]);

  if (organOnly) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
        <p className="text-sm font-medium mb-2">{title}</p>
        <div className="w-full max-w-[420px] mx-auto rounded-lg border border-zinc-200 bg-white p-2">
              <OverlayPanel
                key={organPanel.key}
                baseSrc={organPanel.baseSrc}
                alt="Organ system support model"
                overlays={organPanel.overlays}
                hoveredEntryKeys={new Set<string>()}
                hasHover={false}
                lazyRender={lazyOverlayRender}
              />
        </div>
        {extraOrganNotes.length > 0 && (
          <div className="mt-2 space-y-1">
            {extraOrganNotes.slice(0, 4).map((note) => (
              <p key={note} className="text-[11px] text-zinc-600">
                {note}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-medium">{title}</p>
        <button
          type="button"
          onClick={() => setSimplifyLabels((current) => !current)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] hover:bg-zinc-100 transition-colors"
        >
          {simplifyLabels ? "Show Scientific Names" : "Simplify Names"}
        </button>
      </div>
      <div className={`grid ${compact ? "grid-cols-1" : "md:grid-cols-[240px,1fr]"} gap-3`}>
        <div className="w-full overflow-x-auto pb-1">
          <div className="flex items-start gap-3 min-w-max">
            <div className="w-full min-w-[320px] max-w-[360px] rounded-lg border border-zinc-200 bg-white p-2">
              <p className="text-xs font-medium mb-2">Overlay view (outer + inner muscle groups)</p>
              <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-500 mb-1 px-1">
                <span>Anterior</span>
                <span>Posterior</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {overlayPanels.map((panel) => (
                  <OverlayPanel
                    key={panel.key}
                    baseSrc={panel.baseSrc}
                    alt={`${panel.view === "anterior" ? "Anterior" : "Posterior"} ${panel.dissection.toLowerCase()} muscle model`}
                    overlays={panel.overlays}
                    hoveredEntryKeys={activeHoveredKeys}
                    hasHover={hasHover}
                    lazyRender={lazyOverlayRender}
                  />
                ))}
              </div>
            </div>
            <div className="w-full min-w-[320px] max-w-[360px] rounded-lg border border-zinc-200 bg-white p-2">
              <p className="text-xs font-medium mb-2">Skeletal support impact</p>
              <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-500 mb-1 px-1">
                <span>Anterior</span>
                <span>Posterior</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {skeletalPanels.map((panel) => (
                  <OverlayPanel
                    key={panel.key}
                    baseSrc={panel.baseSrc}
                    alt={`${panel.view === "anterior" ? "Anterior" : "Posterior"} skeletal model`}
                    overlays={panel.overlays}
                    hoveredEntryKeys={activeHoveredKeys}
                    hasHover={hasHover}
                    lazyRender={lazyOverlayRender}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
                {topBoneEntries.map(([region, score]) => (
                  <div key={`bone-impact-${region}`} className="text-[10px] text-zinc-500">
                    {SKELETAL_REGION_LABELS[region]} {Math.round(score)}%
                  </div>
                ))}
              </div>
            </div>
            {showOrganPanel && (
              <div className="w-full min-w-[320px] max-w-[360px] rounded-lg border border-zinc-200 bg-white p-2">
                <p className="text-xs font-medium mb-2">Internal system support impact</p>
                <OverlayPanel
                  key={organPanel.key}
                  baseSrc={organPanel.baseSrc}
                  alt="Organ system support model"
                  overlays={organPanel.overlays}
                  hoveredEntryKeys={new Set<string>()}
                  hasHover={false}
                  lazyRender={lazyOverlayRender}
                />
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
                  {topOrganEntries.map(([region, score]) => (
                    <div key={`organ-impact-${region}`} className="text-[10px] text-zinc-500">
                      {ORGAN_REGION_LABELS[region]} {Math.round(score)}%
                    </div>
                  ))}
                </div>
                {extraOrganNotes.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {extraOrganNotes.slice(0, 4).map((note) => (
                      <p key={note} className="text-[10px] text-zinc-500">
                        {note}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-2 content-start">
          {displayEntries.length === 0 && (
            <p className="text-xs text-zinc-500">No current muscle fatigue recorded.</p>
          )}
          {displayEntries.map((entry) => (
            <div
              key={entry.key}
              className={`rounded-md border bg-white px-2 py-1.5 transition-colors ${
                activeHoveredKeys.has(entry.key)
                  ? "border-red-400/70 bg-red-50/60"
                  : "border-zinc-200"
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
              <div className="h-1.5 rounded-full bg-zinc-200 mt-1">
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
