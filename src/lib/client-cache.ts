export const CACHE_STALE_MS = 4 * 60 * 60 * 1000;
export const GLOBAL_LAST_FETCHED_KEY = "study-stats:global-last-fetched";

declare global {
  interface Window {
    __studyStatsInFlightRequests?: Map<string, Promise<unknown>>;
  }
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

export function readCache<T>(key: string): CacheEntry<T> | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.fetchedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T): number {
  const fetchedAt = Date.now();

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(key, JSON.stringify({ data, fetchedAt }));
    } catch {
      // Ignore localStorage write failures (quota/private mode/etc.)
    }
  }

  return fetchedAt;
}

export function isStale(fetchedAt: number, staleMs: number = CACHE_STALE_MS): boolean {
  return Date.now() - fetchedAt > staleMs;
}

export function formatTimeSince(fetchedAt: number | null, now: number): string {
  if (!fetchedAt) return "Never";

  const diffMs = Math.max(0, now - fetchedAt);
  const minutes = Math.floor(diffMs / (60 * 1000));

  if (minutes <= 0) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes === 0 ? `${hours}h ago` : `${hours}h ${remMinutes}m ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function writeGlobalLastFetched(fetchedAt: number = Date.now()): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GLOBAL_LAST_FETCHED_KEY, String(fetchedAt));
  window.dispatchEvent(new CustomEvent("study-stats:last-fetched-updated"));
}

function getInFlightMap(): Map<string, Promise<unknown>> {
  if (typeof window === "undefined") return new Map<string, Promise<unknown>>();
  if (!window.__studyStatsInFlightRequests) {
    window.__studyStatsInFlightRequests = new Map<string, Promise<unknown>>();
  }
  return window.__studyStatsInFlightRequests;
}

export async function fetchJsonWithDedupe<T>(
  requestKey: string,
  fetcher: () => Promise<T>
): Promise<T> {
  if (typeof window === "undefined") {
    return fetcher();
  }

  const inFlight = getInFlightMap();
  const existing = inFlight.get(requestKey);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fetcher()
    .catch((error) => {
      throw error;
    })
    .finally(() => {
      inFlight.delete(requestKey);
    });
  inFlight.set(requestKey, promise);
  return promise;
}

export function readGlobalLastFetched(): number | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(GLOBAL_LAST_FETCHED_KEY);
  if (raw) {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }

  let latest: number | null = null;
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith("study-stats:")) continue;
    const value = window.localStorage.getItem(key);
    if (!value) continue;
    try {
      const parsed = JSON.parse(value) as { fetchedAt?: unknown };
      if (typeof parsed.fetchedAt === "number") {
        latest = latest === null ? parsed.fetchedAt : Math.max(latest, parsed.fetchedAt);
      }
    } catch {
      // Ignore non-JSON settings values.
    }
  }

  return latest;
}
