"use client";

import { signIn, signOut, useSession } from "next-auth/react";

interface AuthButtonProps {
  compact?: boolean;
  className?: string;
}

export default function AuthButton({ compact = false, className = "" }: AuthButtonProps) {
  const { data: session, status } = useSession();

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
      Link Google Account
    </button>
  );
}
