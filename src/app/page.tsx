"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import AuthButton from "@/components/AuthButton";
import Dashboard from "@/components/Dashboard";
import TopBarDataControls from "@/components/TopBarDataControls";
import SupabaseAccountSync from "@/components/SupabaseAccountSync";

const WIDE_SCREEN_STORAGE_KEY = "study-stats.layout.wide-screen";

function readWideScreenPreference(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(WIDE_SCREEN_STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

export default function Home() {
  const { data: session } = useSession();
  const [wideScreen, setWideScreen] = useState<boolean>(readWideScreenPreference);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem(WIDE_SCREEN_STORAGE_KEY, String(wideScreen));
  }, [wideScreen]);

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
        <div className={`${containerClass} py-2 flex flex-col gap-2 sm:h-16 sm:flex-row sm:items-center`}>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-zinc-900">Dashboard</h1>

          <div className="relative ml-auto" ref={menuRef}>
            <div className="flex items-center gap-2">
              <TopBarDataControls mode="levelOnly" />
              <button
                type="button"
                onClick={() => setMenuOpen((current) => !current)}
                className="pill-btn px-3 py-2"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                {userLabel}
              </button>
            </div>

            {menuOpen && (
              <div className="surface-card-strong absolute right-0 mt-2 w-[min(24rem,calc(100vw-2rem))] p-3 z-[80]">
                <div className="flex flex-col gap-2">
                  <Link
                    href="/settings"
                    className="pill-btn w-full text-left"
                    onClick={() => setMenuOpen(false)}
                  >
                    Settings
                  </Link>
                  <Link
                    href="/workouts"
                    className="pill-btn w-full text-left"
                    onClick={() => setMenuOpen(false)}
                  >
                    Workout Section
                  </Link>
                  <TopBarDataControls mode="refreshOnly" stacked />
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">
                    Site account
                  </div>
                  <SupabaseAccountSync buttonClassName="w-full text-left" />
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">
                    Google integration
                  </div>
                  <AuthButton compact className="w-full text-left" />
                </div>
              </div>
            )}
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
