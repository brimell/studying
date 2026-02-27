"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const DEFAULT_DISPLAY_NAME = "John Doe";

function normalizeDisplayName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_DISPLAY_NAME;
  return trimmed.slice(0, 60);
}

function normalizeNextTarget(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/auth")) return "/";
  return raw;
}

export default function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextTarget = normalizeNextTarget(searchParams.get("next"));
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(() => Boolean(supabase));
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoadingSession(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoadingSession(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (loadingSession) return;
    if (!session) return;
    router.replace(nextTarget);
  }, [loadingSession, nextTarget, router, session]);

  const handleSignIn = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setError(signInError.message);
    } else {
      setMessage("Signed in.");
    }
    setBusy(false);
  };

  const handleSignUp = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          display_name: normalizeDisplayName(displayName),
        },
      },
    });
    if (signUpError) {
      setError(signUpError.message);
    } else if (!data.session) {
      setMessage("Account created. Check your email to confirm sign-in.");
    } else {
      setMessage("Account created and signed in.");
    }
    setBusy(false);
  };

  if (!supabase) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center px-6">
        <div className="surface-card w-full max-w-md p-6 space-y-2">
          <h1 className="text-xl font-semibold">Supabase Required</h1>
          <p className="text-sm text-zinc-600">
            Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to enable account
            sign in.
          </p>
        </div>
      </div>
    );
  }

  if (loadingSession) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center px-6">
        <div className="surface-card w-full max-w-md p-6">
          <p className="text-sm text-zinc-600">Loading account...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-6 py-10">
      <div className="surface-card w-full max-w-md p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Welcome</h1>
          <p className="text-sm text-zinc-600 mt-1">
            Create a site account or sign in to continue to your dashboard.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`px-2 py-1 rounded ${
              mode === "signup" ? "pill-btn pill-btn-primary" : "pill-btn text-zinc-600"
            }`}
          >
            Sign Up
          </button>
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`px-2 py-1 rounded ${
              mode === "signin" ? "pill-btn pill-btn-primary" : "pill-btn text-zinc-600"
            }`}
          >
            Sign In
          </button>
        </div>

        <div className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            className="field-select w-full border rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            className="field-select w-full border rounded-lg px-3 py-2 text-sm"
          />
          {mode === "signup" && (
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Display name"
              className="field-select w-full border rounded-lg px-3 py-2 text-sm"
            />
          )}
        </div>

        <button
          type="button"
          disabled={busy || !email.trim() || !password || (mode === "signup" && !displayName.trim())}
          onClick={mode === "signin" ? handleSignIn : handleSignUp}
          className="pill-btn pill-btn-primary w-full px-3 py-2"
        >
          {busy ? "Working..." : mode === "signin" ? "Sign In" : "Create Account"}
        </button>

        <p className="text-[11px] text-zinc-500">
          After signing in, you can optionally link Google Calendar separately inside the app.
        </p>
        {error ? <p className="text-xs text-red-500">{error}</p> : null}
        {message ? <p className="text-xs text-emerald-600">{message}</p> : null}
      </div>
    </div>
  );
}
