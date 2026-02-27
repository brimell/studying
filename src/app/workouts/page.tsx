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
  const [useLeftSidebar, setUseLeftSidebar] = useState(false);

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

  useEffect(() => {
    const updateSidebarMode = () => {
      setUseLeftSidebar(window.innerWidth > window.innerHeight);
    };
    updateSidebarMode();
    window.addEventListener("resize", updateSidebarMode);
    return () => window.removeEventListener("resize", updateSidebarMode);
  }, []);

  const containerClass = wideScreen
    ? "w-full px-4 sm:px-6 lg:px-8"
    : "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8";

  return (
    <div className={`app-shell ${useLeftSidebar ? "pl-72" : ""}`}>
      <header
        className={
          useLeftSidebar
            ? "top-nav fixed left-0 top-0 z-50 h-[100dvh] w-72 border-r border-zinc-200"
            : "top-nav sticky top-0 z-50"
        }
      >
        <div
          className={
            useLeftSidebar
              ? "h-full px-4 py-4 flex flex-col gap-3"
              : `${containerClass} py-2 flex flex-col gap-2 sm:h-16 sm:flex-row sm:items-center sm:justify-between`
          }
        >
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/"
              className={`pill-btn ${useLeftSidebar ? "[writing-mode:vertical-rl] rotate-180" : ""}`}
            >
              ← Dashboard
            </Link>
            <h1 className={`text-xl font-bold tracking-tight ${useLeftSidebar ? "[writing-mode:vertical-rl] rotate-180" : ""}`}>Gym</h1>
          </div>
          <div className={`flex items-center gap-2 sm:gap-3 ${useLeftSidebar ? "flex-col items-stretch mt-1" : "w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0"}`}>
            <Link href="/?settings=1" className="pill-btn">
              Settings
            </Link>
            <SupabaseAccountSync />
            <AuthButton />
          </div>
        </div>
      </header>

      <main className={`${containerClass} pt-2 pb-8`}>
        <WorkoutDataProvider>
          <WorkoutPlanner />
        </WorkoutDataProvider>
      </main>
    </div>
  );
}
