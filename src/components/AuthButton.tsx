"use client";

import { useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

interface AuthButtonProps {
  compact?: boolean;
  className?: string;
}

const GOOGLE_LINKED_STORAGE_KEY = "study-stats.google-linked-account";

export default function AuthButton({ compact = false, className = "" }: AuthButtonProps) {
  const { data: session, status } = useSession();
  const [linkedBeforeSnapshot] = useState(() => {
    if (typeof window === "undefined") return false;
    return Boolean(window.localStorage.getItem(GOOGLE_LINKED_STORAGE_KEY));
  });
  const hasLinkedBefore = Boolean(session?.user?.email) || linkedBeforeSnapshot;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (status === "loading" || !session?.user?.email) return;
    if (session?.user?.email) {
      const snapshot = JSON.stringify({
        email: session.user.email,
        linkedAt: new Date().toISOString(),
      });
      window.localStorage.setItem(GOOGLE_LINKED_STORAGE_KEY, snapshot);
    }
  }, [session, status]);

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
          Disconnect Google Calendar
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
          Disconnect Google Calendar
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn("google")}
      className={`pill-btn pill-btn-primary ${className}`.trim()}
    >
      {hasLinkedBefore ? "Reconnect Google Calendar" : "Connect Google Calendar"}
    </button>
  );
}
