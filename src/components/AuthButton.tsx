"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export default function AuthButton() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <button
        disabled
        className="px-4 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-sm animate-pulse"
      >
        Loading...
      </button>
    );
  }

  if (session) {
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
          className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-sm transition-colors"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn("google")}
      className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium transition-colors"
    >
      Sign in with Google
    </button>
  );
}
