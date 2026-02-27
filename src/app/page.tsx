"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import AuthButton from "@/components/AuthButton";
import Dashboard from "@/components/Dashboard";
import TopBarDataControls from "@/components/TopBarDataControls";
import SupabaseAccountSync from "@/components/SupabaseAccountSync";

const WIDE_SCREEN_STORAGE_KEY = "study-stats.layout.wide-screen";

export default function Home() {
  const { data: session } = useSession();
  const [wideScreen, setWideScreen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(WIDE_SCREEN_STORAGE_KEY) === "true";
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem(WIDE_SCREEN_STORAGE_KEY, String(wideScreen));
  }, [wideScreen]);

  useEffect(() => {
    const syncFromSettings = () => {
      setWideScreen(window.localStorage.getItem(WIDE_SCREEN_STORAGE_KEY) === "true");
    };
    window.addEventListener("study-stats:settings-updated", syncFromSettings);
    window.addEventListener("storage", syncFromSettings);
    return () => {
      window.removeEventListener("study-stats:settings-updated", syncFromSettings);
      window.removeEventListener("storage", syncFromSettings);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const containerClass = wideScreen
    ? "w-full px-4 sm:px-6 lg:px-8"
    : "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8";
  const userLabel = session?.user?.name?.trim() || "John Doe";

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="top-nav sticky top-0 z-50">
        <div className={`${containerClass} py-2 flex flex-col gap-2 sm:h-16 sm:flex-row sm:items-center sm:justify-between`}>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-zinc-900">Dashboard</h1>

          <div className="relative" ref={menuRef}>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMenuOpen((current) => !current)}
                className="pill-btn px-3 py-2"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                {userLabel}
              </button>
              <TopBarDataControls mode="levelOnly" />
            </div>

            {menuOpen && (
              <div className="surface-card-strong absolute left-0 mt-2 w-[min(24rem,calc(100vw-2rem))] p-3 z-[80] space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Link href="/settings" className="pill-btn" onClick={() => setMenuOpen(false)}>
                    Settings
                  </Link>
                  <Link href="/workouts" className="pill-btn" onClick={() => setMenuOpen(false)}>
                    Workout Section
                  </Link>
                  <button
                    type="button"
                    aria-pressed={wideScreen}
                    onClick={() => setWideScreen((previous) => !previous)}
                    className="pill-btn"
                  >
                    {wideScreen ? "Standard Width" : "Wide Screen"}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SupabaseAccountSync />
                  <AuthButton />
                </div>
              </div>
            )}
          </div>

          <div className="w-full sm:w-auto flex items-center gap-2 sm:justify-end overflow-x-auto pb-1 sm:pb-0">
            <TopBarDataControls mode="refreshOnly" />
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
