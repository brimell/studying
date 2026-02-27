"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

interface AuthButtonProps {
  compact?: boolean;
  className?: string;
}

const GOOGLE_LINKED_STORAGE_KEY = "study-stats.google-linked-account";
const GOOGLE_LINKED_METADATA_KEY = "google_linked_once";

export default function AuthButton({ compact = false, className = "" }: AuthButtonProps) {
  const { data: session, status } = useSession();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [, setLinkedBeforeSnapshot] = useState(() => {
    if (typeof window === "undefined") return false;
    return Boolean(window.localStorage.getItem(GOOGLE_LINKED_STORAGE_KEY));
  });

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    const loadLinkedFromSupabaseMetadata = async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      const linkedFromMetadata = Boolean(
        data.user?.user_metadata?.[GOOGLE_LINKED_METADATA_KEY]
      );
      if (!linkedFromMetadata) return;
      setLinkedBeforeSnapshot(true);
      if (typeof window !== "undefined" && !window.localStorage.getItem(GOOGLE_LINKED_STORAGE_KEY)) {
        window.localStorage.setItem(
          GOOGLE_LINKED_STORAGE_KEY,
          JSON.stringify({
            linkedAt: new Date().toISOString(),
            source: "supabase-metadata",
          })
        );
      }
    };

    void loadLinkedFromSupabaseMetadata();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (status === "loading" || !session?.user?.email) return;

    let cancelled = false;
    const persistLocalLinkedSnapshot = async () => {
      const snapshot = JSON.stringify({
        email: session.user?.email,
        linkedAt: new Date().toISOString(),
      });
      window.localStorage.setItem(GOOGLE_LINKED_STORAGE_KEY, snapshot);
      if (!cancelled) setLinkedBeforeSnapshot(true);
    };

    void persistLocalLinkedSnapshot();
    return () => {
      cancelled = true;
    };
  }, [session, status]);

  useEffect(() => {
    if (!supabase) return;
    if (status === "loading" || !session?.user?.email) return;

    let cancelled = false;
    const persistLinkedToSupabaseMetadata = async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      const existingLinked = Boolean(
        data.user?.user_metadata?.[GOOGLE_LINKED_METADATA_KEY]
      );
      if (existingLinked) return;

      await supabase.auth.updateUser({
        data: {
          ...(data.user?.user_metadata || {}),
          [GOOGLE_LINKED_METADATA_KEY]: true,
          google_linked_email: session.user?.email || null,
          google_linked_at: new Date().toISOString(),
        },
      });
    };

    void persistLinkedToSupabaseMetadata();
    return () => {
      cancelled = true;
    }
  }, [session, status, supabase]);

  if (status === "loading") {
    return (
      <button
        disabled
        className={`pill-btn animate-pulse ${className}`.trim()}
      >
        Loading...
      </button>
    );
  }

  if (session) {
    if (compact) {
      return (
        <button
          onClick={() => signOut()}
          className={`pill-btn ${className}`.trim()}
        >
          Unlink Google Account
        </button>
      );
    }

    return (
      <div className="flex items-center gap-3">
        {session.user?.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.user.image}
            alt=""
            className="w-8 h-8 rounded-full"
          />
        )}
        <span className="text-sm hidden sm:inline">
          {session.user?.name || session.user?.email}
        </span>
        <button
          onClick={() => signOut()}
          className="pill-btn"
        >
          Unlink Google Account
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn("google")}
      className={`pill-btn pill-btn-primary ${className}`.trim()}
    >
      Update Google authorisation for this session
    </button>
  );
}
