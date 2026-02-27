"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import AuthButton from "@/components/AuthButton";
import Dashboard from "@/components/Dashboard";
import GlobalSettingsPanel from "@/components/GlobalSettingsPanel";
import TopBarDataControls from "@/components/TopBarDataControls";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/scroll-lock";

const WIDE_SCREEN_STORAGE_KEY = "study-stats.layout.wide-screen";

function readWideScreenPreference(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(WIDE_SCREEN_STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [wideScreen, setWideScreen] = useState<boolean>(readWideScreenPreference);
  const [useLeftSidebar, setUseLeftSidebar] = useState(false);
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
    const updateSidebarMode = () => {
      setUseLeftSidebar(window.innerWidth > window.innerHeight);
    };
    updateSidebarMode();
    window.addEventListener("resize", updateSidebarMode);
    return () => window.removeEventListener("resize", updateSidebarMode);
  }, []);

  const settingsOpen = searchParams.get("settings") === "1";

  useEffect(() => {
    if (!settingsOpen) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeFromKeyboard = () => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("settings");
      const query = params.toString();
      router.replace(query ? `/?${query}` : "/");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeFromKeyboard();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, searchParams, settingsOpen]);

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

  function closeSettings() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("settings");
    const query = params.toString();
    router.replace(query ? `/?${query}` : "/");
  }

  return (
    <div className={`app-shell ${useLeftSidebar ? "pl-72" : ""}`}>
      {/* Header */}
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
              : `${containerClass} py-2 flex flex-col gap-2 sm:h-16 sm:flex-row sm:items-center`
          }
        >
          <button
            type="button"
            onClick={() => {
              router.push("/");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className={`text-left text-lg sm:text-xl font-bold tracking-tight text-zinc-900 ${
              useLeftSidebar ? "[writing-mode:vertical-rl] rotate-180 self-start" : ""
            }`}
          >
            Dashboard
          </button>
          <Link
            href="/workouts"
            className={`text-sm font-medium text-zinc-700 hover:text-zinc-900 underline underline-offset-4 decoration-zinc-300 hover:decoration-zinc-600 ${
              useLeftSidebar ? "[writing-mode:vertical-rl] rotate-180 self-start" : ""
            }`}
          >
            Gym
          </Link>

          <div className={`relative ${useLeftSidebar ? "mt-auto self-start" : "ml-auto"}`} ref={menuRef}>
            <div className={`flex items-center gap-2 ${useLeftSidebar ? "flex-col items-start" : ""}`}>
              {useLeftSidebar ? (
                <>
                  <TopBarDataControls mode="streakIconOnly" />
                  <button
                    type="button"
                    onClick={() => setMenuOpen((current) => !current)}
                    className="pill-btn px-3 py-2 text-lg"
                    aria-expanded={menuOpen}
                    aria-haspopup="menu"
                    aria-label={`Open profile menu for ${userLabel}`}
                  >
                    👤
                  </button>
                </>
              ) : (
                <>
                  <TopBarDataControls mode="streakOnly" />
                  <button
                    type="button"
                    onClick={() => setMenuOpen((current) => !current)}
                    className="pill-btn px-3 py-2"
                    aria-expanded={menuOpen}
                    aria-haspopup="menu"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span>{userLabel}</span>
                      <TopBarDataControls mode="inlineLevel" />
                    </span>
                  </button>
                </>
              )}
            </div>

            {menuOpen && (
              <div
                className={`surface-card-strong absolute mt-2 w-[min(24rem,calc(100vw-2rem))] p-3 z-[80] ${
                  useLeftSidebar ? "left-0" : "right-0"
                }`}
              >
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="pill-btn w-full text-left"
                    onClick={() => {
                      setMenuOpen(false);
                      router.replace("/?settings=1");
                    }}
                  >
                    Settings
                  </button>
                  <TopBarDataControls mode="refreshOnly" stacked showLastFetched={false} />
                  <AuthButton compact className="w-full text-left" />
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className={`${containerClass} pt-2 pb-5 sm:pt-3 sm:pb-9`}>
        <Dashboard />
      </main>

      {settingsOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[180] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeSettings();
            }}
          >
            <div
              className="surface-card-strong w-full max-w-5xl max-h-[90vh] overflow-y-auto p-4 sm:p-5"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Global Settings</h2>
                <button type="button" onClick={closeSettings} className="pill-btn">
                  Close
                </button>
              </div>
              <GlobalSettingsPanel />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
