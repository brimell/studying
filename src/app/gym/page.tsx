"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { WorkoutDataProvider } from "@/components/WorkoutDataProvider";

const WIDE_SCREEN_STORAGE_KEY = "study-stats.layout.wide-screen";
const SupabaseAccountSync = dynamic(() => import("@/components/SupabaseAccountSync"));
const WorkoutPlanner = dynamic(() => import("@/components/WorkoutPlanner"), {
  loading: () => <div className="surface-card p-6 animate-pulse h-44" />,
});

function readWideScreenPreference(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(WIDE_SCREEN_STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

export default function GymPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [wideScreen, setWideScreen] = useState<boolean>(readWideScreenPreference);
  const [useLeftSidebar, setUseLeftSidebar] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
    <div className={`app-shell ${useLeftSidebar ? "pl-[4.5rem]" : ""}`}>
      <header
        className={
          useLeftSidebar
            ? "top-nav fixed left-0 top-0 z-50 h-[100dvh] w-[4.5rem] border-r border-zinc-200"
            : "top-nav sticky top-0 z-50"
        }
      >
        <div
          className={
            useLeftSidebar
              ? "h-full px-1.5 py-3 flex flex-col items-center gap-2"
              : `${containerClass} py-2 flex flex-col gap-2 sm:h-16 sm:flex-row sm:items-center sm:justify-between`
          }
        >
          <button
            type="button"
            onClick={() => {
              router.push("/gym");
            }}
            className={`text-left text-lg sm:text-xl font-bold tracking-tight text-zinc-900 ${
              useLeftSidebar ? "[writing-mode:vertical-rl] rotate-180" : ""
            }`}
          >
            Gym
          </button>
          <Link
            href="/"
            className={`text-sm font-medium text-zinc-700 hover:text-zinc-900 underline underline-offset-4 decoration-zinc-300 hover:decoration-zinc-600 ${
              useLeftSidebar ? "[writing-mode:vertical-rl] rotate-180" : ""
            }`}
          >
            Dashboard
          </Link>

          <div className={`relative ${useLeftSidebar ? "mt-auto" : "ml-auto"}`} ref={menuRef}>
            <div className={`flex items-center gap-2 ${useLeftSidebar ? "flex-col items-center" : ""}`}>
              <button
                type="button"
                onClick={() => setMenuOpen((current) => !current)}
                className={useLeftSidebar ? "pill-btn px-3 py-2 text-lg" : "pill-btn px-3 py-2"}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label={`Open profile menu for ${userLabel}`}
              >
                {useLeftSidebar ? "👤" : userLabel}
              </button>
            </div>

            {menuOpen && (
              <div
                className={`surface-card-strong w-[min(24rem,calc(100vw-2rem))] p-3 z-[80] ${
                  useLeftSidebar
                    ? "fixed left-20 bottom-0 max-h-[100dvh] overflow-y-auto"
                    : "absolute right-0 mt-2"
                }`}
              >
                <div className="flex flex-col gap-2">
                  <Link
                    href="/?settings=1"
                    className="pill-btn w-full text-left"
                    onClick={() => setMenuOpen(false)}
                  >
                    Settings
                  </Link>
                  <SupabaseAccountSync />
                </div>
              </div>
            )}
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
