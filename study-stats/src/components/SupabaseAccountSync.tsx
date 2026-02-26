"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const STORAGE_KEY_PREFIX = "study-stats";

type SyncPayload = Record<string, string>;

function collectLocalSettings(): SyncPayload {
  const payload: SyncPayload = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_KEY_PREFIX)) continue;
    const value = window.localStorage.getItem(key);
    if (value === null) continue;
    payload[key] = value;
  }
  return payload;
}

function applyCloudSettings(payload: SyncPayload): void {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_KEY_PREFIX)) continue;
    window.localStorage.removeItem(key);
  }

  for (const [key, value] of Object.entries(payload)) {
    window.localStorage.setItem(key, value);
  }
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
      const result = await callSyncApi("PUT", payload);
      setCloudUpdatedAt(result.updatedAt || null);
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

      applyCloudSettings(payload);
      setCloudUpdatedAt(result.updatedAt || null);
      window.location.reload();
    } catch (restoreError: unknown) {
      setError(restoreError instanceof Error ? restoreError.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  };

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
