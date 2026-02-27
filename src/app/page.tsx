"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
    <div className="app-shell">
      {/* Header */}
      <header className="top-nav sticky top-0 z-50">
        <div className={`${containerClass} py-2 flex flex-col gap-2 sm:h-16 sm:flex-row sm:items-center sm:justify-between`}>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-zinc-900">
            Study Stats
          </h1>
          <div className="w-full sm:w-auto flex items-center gap-2 sm:gap-3 sm:justify-end overflow-x-auto pb-1 sm:pb-0">
            <Link href="/workouts" className="pill-btn">
              <span className="sm:hidden">Workout</span>
              <span className="hidden sm:inline">Workout Section</span>
            </Link>
            <button
              type="button"
              aria-pressed={wideScreen}
              onClick={() => setWideScreen((previous) => !previous)}
              className="pill-btn hidden md:inline-flex"
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
      <main className={`${containerClass} py-5 sm:py-9`}>
        <Dashboard />
      </main>
    </div>
  );
}
