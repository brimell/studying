"use client";

import { useEffect, useState } from "react";
import AuthButton from "@/components/AuthButton";
import Dashboard from "@/components/Dashboard";
import TopBarDataControls from "@/components/TopBarDataControls";
import SupabaseAccountSync from "@/components/SupabaseAccountSync";

const WIDE_SCREEN_STORAGE_KEY = "study-stats.layout.wide-screen";

export default function Home() {
  const [wideScreen, setWideScreen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(WIDE_SCREEN_STORAGE_KEY) === "true";
  });

  useEffect(() => {
    window.localStorage.setItem(WIDE_SCREEN_STORAGE_KEY, String(wideScreen));
  }, [wideScreen]);

  const containerClass = wideScreen
    ? "w-full px-4 sm:px-6 lg:px-8"
    : "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-zinc-900/80 backdrop-blur border-b border-zinc-200 dark:border-zinc-800">
        <div className={`${containerClass} h-16 flex items-center justify-between`}>
          <h1 className="text-xl font-bold tracking-tight">
            Study Stats
          </h1>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-pressed={wideScreen}
              onClick={() => setWideScreen((previous) => !previous)}
              className="px-2.5 py-1 rounded-md text-xs bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors"
            >
              {wideScreen ? "Standard Width" : "Wide Screen"}
            </button>
            <SupabaseAccountSync />
            <TopBarDataControls />
            <AuthButton />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className={`${containerClass} py-8`}>
        <Dashboard />
      </main>
    </div>
  );
}
