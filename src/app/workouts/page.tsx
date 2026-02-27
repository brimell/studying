"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AuthButton from "@/components/AuthButton";
import SupabaseAccountSync from "@/components/SupabaseAccountSync";
import { WorkoutDataProvider } from "@/components/WorkoutDataProvider";
import WorkoutPlanner from "@/components/WorkoutPlanner";

const WIDE_SCREEN_STORAGE_KEY = "study-stats.layout.wide-screen";

function readWideScreenPreference(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(WIDE_SCREEN_STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

export default function WorkoutsPage() {
  const [wideScreen, setWideScreen] = useState<boolean>(readWideScreenPreference);

  useEffect(() => {
    const syncFromSettings = () => {
      setWideScreen(readWideScreenPreference());
    };
    window.addEventListener("study-stats:settings-updated", syncFromSettings);
    window.addEventListener("storage", syncFromSettings);
    return () => {
      window.removeEventListener("study-stats:settings-updated", syncFromSettings);
      window.removeEventListener("storage", syncFromSettings);
    };
  }, []);

  const containerClass = wideScreen
    ? "w-full px-4 sm:px-6 lg:px-8"
    : "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8";

  return (
    <div className="app-shell">
      <header className="top-nav sticky top-0 z-50">
        <div className={`${containerClass} py-2 flex flex-col gap-2 sm:h-16 sm:flex-row sm:items-center sm:justify-between`}>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/"
              className="pill-btn"
            >
              ← Dashboard
            </Link>
            <h1 className="text-xl font-bold tracking-tight">Workout Planner</h1>
          </div>
          <div className="w-full sm:w-auto flex items-center gap-2 sm:gap-3 overflow-x-auto pb-1 sm:pb-0">
            <Link href="/settings" className="pill-btn">
              Settings
            </Link>
            <SupabaseAccountSync />
            <AuthButton />
          </div>
        </div>
      </header>

      <main className={`${containerClass} py-8`}>
        <WorkoutDataProvider>
          <WorkoutPlanner />
        </WorkoutDataProvider>
      </main>
    </div>
  );
}
