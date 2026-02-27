"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import LoadingIcon from "@/components/LoadingIcon";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

function normalizeNextTarget(pathname: string, query: string): string {
  const candidate = `${pathname}${query ? `?${query}` : ""}`;
  if (!candidate.startsWith("/")) return "/";
  if (candidate.startsWith("/auth")) return "/";
  return candidate;
}

export default function AppAccountGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(() => Boolean(supabase));

  const isAuthRoute = pathname === "/auth";

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setSession(null);
        setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (loading) return;
    if (isAuthRoute) return;
    if (session) return;

    const query = typeof window === "undefined" ? "" : window.location.search.replace(/^\?/, "");
    const nextPath = normalizeNextTarget(pathname, query);
    router.replace(`/auth?next=${encodeURIComponent(nextPath)}`);
  }, [isAuthRoute, loading, pathname, router, session]);

  if (!supabase) {
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center px-6">
        <div className="surface-card max-w-xl p-6 space-y-2">
          <h1 className="text-xl font-semibold">Supabase Required</h1>
          <p className="text-sm text-zinc-600">
            This app now requires a site account. Configure `NEXT_PUBLIC_SUPABASE_URL` and
            `NEXT_PUBLIC_SUPABASE_ANON_KEY` to enable sign in.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <LoadingIcon />
      </div>
    );
  }

  if (!isAuthRoute && !session) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <LoadingIcon />
      </div>
    );
  }

  return <>{children}</>;
}
