export const CACHE_STALE_MS = 4 * 60 * 60 * 1000;

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
