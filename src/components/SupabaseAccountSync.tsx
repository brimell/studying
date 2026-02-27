"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const STORAGE_KEY_PREFIX = "study-stats";
const EXCLUDED_CACHE_KEY_PREFIXES = [
  "study-stats:today-progress",
  "study-stats:daily-study-time:",
  "study-stats:distribution:",
  "study-stats:habit-tracker:",
  "study-stats:global-last-fetched",
];

type SyncPayload = Record<string, string>;

function shouldSyncKey(key: string): boolean {
  if (!key.startsWith(STORAGE_KEY_PREFIX)) return false;
  // Keep all app settings, exclude only transient cache blobs.
  return !EXCLUDED_CACHE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function collectLocalSettings(): SyncPayload {
  const payload: SyncPayload = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !shouldSyncKey(key)) continue;
    const value = window.localStorage.getItem(key);
    if (value === null) continue;
    payload[key] = value;
  }
  return payload;
}

function applyCloudSettings(payload: SyncPayload): void {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (!key || !shouldSyncKey(key)) continue;
    window.localStorage.removeItem(key);
  }

  for (const [key, value] of Object.entries(payload)) {
    window.localStorage.setItem(key, value);
  }
}

function snapshotPayload(payload: SyncPayload): string {
  return JSON.stringify(
    Object.entries(payload).sort(([left], [right]) => left.localeCompare(right))
  );
}

function notifySettingsApplied(): void {
  window.dispatchEvent(new CustomEvent("study-stats:refresh-all"));
  window.dispatchEvent(new CustomEvent("study-stats:study-calendars-updated"));
  window.dispatchEvent(new CustomEvent("study-stats:exam-date-updated"));
  window.dispatchEvent(new CustomEvent("study-stats:milestones-updated"));
}

function formatDate(dateIso: string | null): string {
  if (!dateIso) return "Never";
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export default function SupabaseAccountSync() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState<string | null>(null);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const lastSyncedSnapshotRef = useRef<string>("");
  const trackedPayloadRef = useRef<SyncPayload>({});
  const dirtyKeysRef = useRef<Set<string>>(new Set());
  const autoSyncDebounceRef = useRef<number | null>(null);
  const autoSyncInFlightRef = useRef(false);
  const suspendTrackingRef = useRef(false);
  const autoSyncInitializedRef = useRef(false);

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setError(null);
      setMessage(null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const callSyncApi = async (method: "GET" | "PUT", payload?: SyncPayload) => {
    if (!supabase) throw new Error("Supabase is not configured.");

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("No active Supabase session.");

    const response = await fetch("/api/account-sync", {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === "PUT" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "PUT" ? JSON.stringify({ payload }) : undefined,
    });

    const json = (await response.json()) as {
      error?: string;
      payload?: SyncPayload;
      updatedAt?: string | null;
    };

    if (!response.ok) {
      throw new Error(json.error || "Sync request failed.");
    }

    return json;
  };

  const autoBackupToCloud = async (payload: SyncPayload) => {
    const result = await callSyncApi("PUT", payload);
    setCloudUpdatedAt(result.updatedAt || null);
  };

  const handleSignIn = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
    } else {
      setMessage("Signed in.");
      setPassword("");
    }
    setBusy(false);
  };

  const handleSignUp = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });
    if (signUpError) {
      setError(signUpError.message);
    } else {
      setMessage("Sign-up complete. Check your email if confirmation is enabled.");
      setPassword("");
    }
    setBusy(false);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
    } else {
      setMessage("Signed out.");
      setCloudUpdatedAt(null);
    }
    setBusy(false);
  };

  const handleBackup = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = collectLocalSettings();
      await autoBackupToCloud(payload);
      trackedPayloadRef.current = payload;
      lastSyncedSnapshotRef.current = snapshotPayload(payload);
      setMessage(`Backed up ${Object.keys(payload).length} settings to cloud.`);
    } catch (backupError: unknown) {
      setError(backupError instanceof Error ? backupError.message : "Backup failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await callSyncApi("GET");
      const payload = result.payload || {};
      const keyCount = Object.keys(payload).length;
      if (keyCount === 0) {
        setMessage("No cloud settings found.");
        setCloudUpdatedAt(result.updatedAt || null);
        return;
      }

      const confirmed = window.confirm(
        "Replace your current local settings with cloud settings? This will reload the page."
      );
      if (!confirmed) return;

      suspendTrackingRef.current = true;
      try {
        applyCloudSettings(payload);
      } finally {
        suspendTrackingRef.current = false;
      }
      setCloudUpdatedAt(result.updatedAt || null);
      trackedPayloadRef.current = payload;
      lastSyncedSnapshotRef.current = snapshotPayload(payload);
      window.location.reload();
    } catch (restoreError: unknown) {
      setError(restoreError instanceof Error ? restoreError.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!session) {
      autoSyncInitializedRef.current = false;
      lastSyncedSnapshotRef.current = "";
      trackedPayloadRef.current = {};
      dirtyKeysRef.current.clear();
      if (autoSyncDebounceRef.current) {
        window.clearTimeout(autoSyncDebounceRef.current);
        autoSyncDebounceRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const storage = window.localStorage;
    const writableStorage = storage as Storage & {
      setItem: (key: string, value: string) => void;
      removeItem: (key: string) => void;
      clear: () => void;
    };

    const originalSetItem = storage.setItem.bind(storage);
    const originalRemoveItem = storage.removeItem.bind(storage);
    const originalClear = storage.clear.bind(storage);
    let storagePatched = false;

    const clearDebounceTimer = () => {
      if (!autoSyncDebounceRef.current) return;
      window.clearTimeout(autoSyncDebounceRef.current);
      autoSyncDebounceRef.current = null;
    };

    const flushDirtyKeys = async () => {
      if (cancelled) return;
      if (!autoSyncInitializedRef.current) return;
      if (autoSyncInFlightRef.current) return;

      const dirtyKeys = [...dirtyKeysRef.current];
      if (dirtyKeys.length === 0) return;

      autoSyncInFlightRef.current = true;
      try {
        const nextPayload: SyncPayload = { ...trackedPayloadRef.current };
        for (const key of dirtyKeys) {
          if (!shouldSyncKey(key)) continue;
          const value = storage.getItem(key);
          if (value === null) {
            delete nextPayload[key];
          } else {
            nextPayload[key] = value;
          }
        }

        const snapshot = snapshotPayload(nextPayload);
        if (snapshot === lastSyncedSnapshotRef.current) {
          trackedPayloadRef.current = nextPayload;
          dirtyKeys.forEach((key) => dirtyKeysRef.current.delete(key));
          return;
        }

        setAutoSyncing(true);
        await autoBackupToCloud(nextPayload);
        if (cancelled) return;
        trackedPayloadRef.current = nextPayload;
        dirtyKeys.forEach((key) => dirtyKeysRef.current.delete(key));
        lastSyncedSnapshotRef.current = snapshot;
      } catch (syncError: unknown) {
        if (!cancelled) {
          setError(syncError instanceof Error ? syncError.message : "Auto-sync failed.");
        }
      } finally {
        autoSyncInFlightRef.current = false;
        if (!cancelled) setAutoSyncing(false);
      }
    };

    const scheduleDirtySync = () => {
      clearDebounceTimer();
      autoSyncDebounceRef.current = window.setTimeout(() => {
        void flushDirtyKeys();
      }, 1200);
    };

    const markDirtyKey = (key: string) => {
      if (!shouldSyncKey(key)) return;
      dirtyKeysRef.current.add(key);
      scheduleDirtySync();
    };

    const markAllTrackedKeysDirty = () => {
      const keys = new Set<string>(Object.keys(trackedPayloadRef.current));
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!key || !shouldSyncKey(key)) continue;
        keys.add(key);
      }
      if (keys.size === 0) return;
      keys.forEach((key) => dirtyKeysRef.current.add(key));
      scheduleDirtySync();
    };

    const onStorageUpdated = (event: StorageEvent) => {
      if (event.storageArea !== storage) return;
      if (event.key) {
        markDirtyKey(event.key);
      } else {
        markAllTrackedKeysDirty();
      }
    };

    const initializeAndSync = async () => {
      try {
        setAutoSyncing(true);
        const cloud = await callSyncApi("GET");
        if (cancelled) return;

        const cloudPayload = cloud.payload || {};
        const localPayload = collectLocalSettings();
        const hasLocalData = Object.keys(localPayload).length > 0;
        const hasCloudData = Object.keys(cloudPayload).length > 0;

        const mergedPayload: SyncPayload = {
          ...cloudPayload,
          ...localPayload,
        };

        const localSnapshot = snapshotPayload(localPayload);
        const mergedSnapshot = snapshotPayload(mergedPayload);
        const cloudSnapshot = snapshotPayload(cloudPayload);

        if (hasCloudData && localSnapshot !== mergedSnapshot) {
          suspendTrackingRef.current = true;
          try {
            applyCloudSettings(mergedPayload);
          } finally {
            suspendTrackingRef.current = false;
          }
          await autoBackupToCloud(mergedPayload);
          if (cancelled) return;
          trackedPayloadRef.current = mergedPayload;
          dirtyKeysRef.current.clear();
          lastSyncedSnapshotRef.current = mergedSnapshot;
          setMessage("Auto-sync applied cloud settings to this device.");
          autoSyncInitializedRef.current = true;
          notifySettingsApplied();
          return;
        }

        if (!hasLocalData && hasCloudData) {
          suspendTrackingRef.current = true;
          try {
            applyCloudSettings(cloudPayload);
          } finally {
            suspendTrackingRef.current = false;
          }
          trackedPayloadRef.current = cloudPayload;
          dirtyKeysRef.current.clear();
          lastSyncedSnapshotRef.current = cloudSnapshot;
          setMessage("Auto-sync restored cloud data to this device.");
          setCloudUpdatedAt(cloud.updatedAt || null);
          autoSyncInitializedRef.current = true;
          notifySettingsApplied();
          return;
        }

        await autoBackupToCloud(localPayload);
        if (cancelled) return;
        trackedPayloadRef.current = localPayload;
        dirtyKeysRef.current.clear();
        lastSyncedSnapshotRef.current = localSnapshot;
        autoSyncInitializedRef.current = true;
      } catch (syncError: unknown) {
        if (!cancelled) {
          setError(syncError instanceof Error ? syncError.message : "Auto-sync failed.");
        }
      } finally {
        if (!cancelled) setAutoSyncing(false);
      }
    };

    void initializeAndSync();

    try {
      writableStorage.setItem = (key: string, value: string) => {
        originalSetItem(key, value);
        if (suspendTrackingRef.current) return;
        markDirtyKey(key);
      };
      writableStorage.removeItem = (key: string) => {
        originalRemoveItem(key);
        if (suspendTrackingRef.current) return;
        markDirtyKey(key);
      };
      writableStorage.clear = () => {
        if (!suspendTrackingRef.current) {
          markAllTrackedKeysDirty();
        }
        originalClear();
      };
      storagePatched = true;
    } catch {
      storagePatched = false;
    }
    window.addEventListener("storage", onStorageUpdated);

    return () => {
      cancelled = true;
      clearDebounceTimer();
      window.removeEventListener("storage", onStorageUpdated);
      if (storagePatched) {
        writableStorage.setItem = originalSetItem;
        writableStorage.removeItem = originalRemoveItem;
        writableStorage.clear = originalClear;
      }
    };
  }, [session]);

  if (!supabase) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="px-2.5 py-1 rounded-md text-xs bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors"
      >
        ☁️ Account Sync
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[320px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-3 z-50">
          {!session && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className={`px-2 py-1 rounded ${
                    mode === "signin"
                      ? "bg-sky-500 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className={`px-2 py-1 rounded ${
                    mode === "signup"
                      ? "bg-sky-500 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                  }`}
                >
                  Sign Up
                </button>
              </div>

              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
                className="w-full border rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
              />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                className="w-full border rounded-lg px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
              />

              <button
                type="button"
                disabled={busy || !email || !password}
                onClick={mode === "signin" ? handleSignIn : handleSignUp}
                className="w-full px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {mode === "signin" ? "Sign In" : "Create Account"}
              </button>
              <p className="text-[11px] text-zinc-500">
                Optional. You can still use Google + localStorage without creating an account.
              </p>
            </div>
          )}

          {session && (
            <div className="space-y-3">
              <div className="text-xs text-zinc-500">
                Signed in as <span className="font-medium">{session.user.email}</span>
              </div>
              <div className="text-[11px] text-zinc-500">
                Cloud updated: {formatDate(cloudUpdatedAt)}
              </div>
              <div className="text-[11px] text-zinc-500">
                Auto-sync: {autoSyncing ? "syncing..." : "on"}
              </div>
              <button
                type="button"
                onClick={handleBackup}
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                Backup Local Data To Cloud
              </button>
              <button
                type="button"
                onClick={handleRestore}
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-800 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                Restore Data From Cloud
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={busy}
                className="w-full px-3 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 disabled:opacity-50 text-sm transition-colors"
              >
                Sign Out Account
              </button>
            </div>
          )}

          {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
          {message && <p className="text-xs text-emerald-600 mt-3">{message}</p>}
        </div>
      )}
    </div>
  );
}
