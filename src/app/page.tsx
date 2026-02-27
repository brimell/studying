"use client";

import { createPortal } from "react-dom";
import { Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import AuthButton from "@/components/AuthButton";
import TopBarDataControls from "@/components/TopBarDataControls";
import StudyTimerPopup from "@/components/StudyTimerPopup";
import {
  getDisplayNameFromMetadata,
} from "@/lib/display-name";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/scroll-lock";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  FETCH_ACTIVITY_EVENT,
  readPendingFetchCount,
} from "@/lib/client-cache";
import {
  advanceStudyTimerState,
  applyStudyTimerSettings,
  pauseStudyTimer,
  readStudyTimerState,
  resetStudyTimer,
  startStudyTimer,
  studyTimerSidebarLabel,
  type StudyTimerState,
  writeStudyTimerState,
} from "@/lib/study-timer";

const WIDE_SCREEN_STORAGE_KEY = "study-stats.layout.wide-screen";
const Dashboard = dynamic(() => import("@/components/Dashboard"), {
  loading: () => <div className="surface-card p-6 animate-pulse h-40" />,
});
const DailyTrackerPopup = dynamic(() => import("@/components/DailyTrackerPopup"));
const GamificationPanel = dynamic(() => import("@/components/GamificationPanel"));
const GlobalSettingsPanel = dynamic(() => import("@/components/GlobalSettingsPanel"));

function readWideScreenPreference(): boolean {
  if (typeof window === "undefined") return true;
  const stored = window.localStorage.getItem(WIDE_SCREEN_STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

export default function Home() {
  return (
    <Suspense fallback={<div className="app-shell" />}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status: googleAuthStatus } = useSession();
  const supabase = useState(() => getSupabaseBrowserClient())[0];
  const [wideScreen, setWideScreen] = useState<boolean>(readWideScreenPreference);
  const [useLeftSidebar, setUseLeftSidebar] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [gamificationOpen, setGamificationOpen] = useState(false);
  const [dailyTrackerOpen, setDailyTrackerOpen] = useState(false);
  const [studyTimerOpen, setStudyTimerOpen] = useState(false);
  const [studyTimerState, setStudyTimerState] = useState<StudyTimerState>(() =>
    readStudyTimerState()
  );
  const [pendingFetchCount, setPendingFetchCount] = useState(() =>
    typeof window === "undefined" ? 0 : readPendingFetchCount()
  );
  const [accountDisplayName, setAccountDisplayName] = useState("John Doe");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const userLabel = accountDisplayName;

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
    writeStudyTimerState(studyTimerState);
  }, [studyTimerState]);

  useEffect(() => {
    const sync = () => setPendingFetchCount(readPendingFetchCount());
    window.addEventListener(FETCH_ACTIVITY_EVENT, sync);
    return () => window.removeEventListener(FETCH_ACTIVITY_EVENT, sync);
  }, []);

  useEffect(() => {
    if (studyTimerState.status !== "running") return;
    const tick = () => {
      setStudyTimerState((previous) => advanceStudyTimerState(previous, Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [studyTimerState.status]);

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    const syncDisplayNameFromUser = async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setAccountDisplayName(getDisplayNameFromMetadata(data.user?.user_metadata));
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const nextSession = data.session;
      const nextDisplayName = getDisplayNameFromMetadata(nextSession?.user.user_metadata);
      setAccountDisplayName(nextDisplayName);
      void syncDisplayNameFromUser();
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextDisplayName = getDisplayNameFromMetadata(nextSession?.user.user_metadata);
      setAccountDisplayName(nextDisplayName);
      void syncDisplayNameFromUser();
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    const updateSidebarMode = () => {
      setUseLeftSidebar(window.innerWidth > window.innerHeight);
    };
    updateSidebarMode();
    window.addEventListener("resize", updateSidebarMode);
    return () => window.removeEventListener("resize", updateSidebarMode);
  }, []);

  const settingsOpen = searchParams.get("settings") === "1";
  const trackerOpenFromQuery = searchParams.get("tracker") === "1";
  const dailyTrackerVisible = dailyTrackerOpen || trackerOpenFromQuery;
  const studyTimerLabel = studyTimerSidebarLabel(studyTimerState);

  useEffect(() => {
    if (!settingsOpen && !gamificationOpen && !dailyTrackerVisible && !studyTimerOpen) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [dailyTrackerVisible, gamificationOpen, settingsOpen, studyTimerOpen]);

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
    if (!gamificationOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setGamificationOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [gamificationOpen]);

  useEffect(() => {
    if (!dailyTrackerVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDailyTrackerOpen(false);
      if (!trackerOpenFromQuery) return;
      const params = new URLSearchParams(searchParams.toString());
      params.delete("tracker");
      const query = params.toString();
      router.replace(query ? `/?${query}` : "/");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dailyTrackerVisible, router, searchParams, trackerOpenFromQuery]);

  useEffect(() => {
    if (!studyTimerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setStudyTimerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [studyTimerOpen]);

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

  function closeSettings() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("settings");
    const query = params.toString();
    router.replace(query ? `/?${query}` : "/");
  }

  function openDailyTracker() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tracker", "1");
    const query = params.toString();
    router.replace(query ? `/?${query}` : "/");
    setDailyTrackerOpen(true);
  }

  function closeDailyTracker() {
    setDailyTrackerOpen(false);
    if (!trackerOpenFromQuery) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tracker");
    const query = params.toString();
    router.replace(query ? `/?${query}` : "/");
  }

  async function signOutAccount() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setMenuOpen(false);
    router.replace("/auth");
  }

  function applyTimerSettings(settings: {
    studyMinutes: number;
    breakEnabled: boolean;
    breakMinutes: number;
  }) {
    setStudyTimerState((previous) => applyStudyTimerSettings(previous, settings));
  }

  function toggleTimerExamMode() {
    setStudyTimerState((previous) => ({
      ...previous,
      examMode: !previous.examMode,
    }));
  }

  return (
    <div className={`app-shell ${useLeftSidebar ? "pl-[4.5rem]" : ""}`}>
      {/* Header */}
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
              useLeftSidebar ? "[writing-mode:vertical-rl] rotate-180" : ""
            }`}
          >
            Dashboard
          </button>
          <Link
            href="/gym"
            className={`text-sm font-medium text-zinc-700 hover:text-zinc-900 underline underline-offset-4 decoration-zinc-300 hover:decoration-zinc-600 ${
              useLeftSidebar ? "[writing-mode:vertical-rl] rotate-180" : ""
            }`}
          >
            Gym
          </Link>

          <div className={`relative ${useLeftSidebar ? "mt-auto" : "ml-auto"}`} ref={menuRef}>
            <div className={`flex items-center gap-2 ${useLeftSidebar ? "flex-col items-center" : ""}`}>
              {useLeftSidebar ? (
                <>
                  <TopBarDataControls
                    mode="streakIconOnly"
                    onStreakClick={() => setGamificationOpen(true)}
                  />
                  {pendingFetchCount > 0 && (
                    <span
                      className="stat-mono text-[10px] text-zinc-600 animate-pulse [writing-mode:vertical-rl] rotate-180"
                      aria-live="polite"
                    >
                      Syncing {pendingFetchCount}
                    </span>
                  )}
                  {studyTimerLabel && !studyTimerOpen && (
                    <p className="text-[11px] text-zinc-600 stat-mono [writing-mode:vertical-rl] rotate-180">
                      {studyTimerLabel}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setStudyTimerOpen(true)}
                    className="pill-btn px-2 py-1 text-sm"
                    aria-label="Open study timer"
                  >
                    🕒
                  </button>
                  <button
                    type="button"
                    onClick={openDailyTracker}
                    className="pill-btn px-2 py-1 text-sm"
                    aria-label="Open daily tracker"
                  >
                    📝
                  </button>
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
                  {pendingFetchCount > 0 && (
                    <span className="text-[11px] text-zinc-600 stat-mono animate-pulse">
                      Syncing {pendingFetchCount}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setStudyTimerOpen(true)}
                    className="pill-btn px-2.5 py-2 flex items-center gap-2"
                    aria-label="Open study timer"
                  >
                    <span>🕒</span>
                    {studyTimerLabel && <span className="stat-mono text-xs">{studyTimerLabel}</span>}
                  </button>
                  <button
                    type="button"
                    onClick={openDailyTracker}
                    className="pill-btn px-2.5 py-2"
                    aria-label="Open daily tracker"
                  >
                    📝
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuOpen((current) => !current)}
                    className="pill-btn px-3 py-2"
                    aria-expanded={menuOpen}
                    aria-haspopup="menu"
                  >
                    <span className="inline-flex items-center gap-1.5">{userLabel}</span>
                  </button>
                </>
              )}
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
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <span className="text-sm font-semibold text-zinc-900">{userLabel}</span>
                  </div>
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
                  <button
                    type="button"
                    className="pill-btn w-full text-left"
                    onClick={() => {
                      setMenuOpen(false);
                      window.dispatchEvent(new CustomEvent("study-stats:open-add-habit"));
                    }}
                  >
                    Add habit
                  </button>
                  <button
                    type="button"
                    className="pill-btn w-full text-left"
                    onClick={() => {
                      setMenuOpen(false);
                      window.dispatchEvent(new CustomEvent("study-stats:open-add-milestone"));
                    }}
                  >
                    Manage exam/coursework dates
                  </button>
                  <TopBarDataControls mode="refreshOnly" stacked showLastFetched={false} />
                  <button
                    type="button"
                    className="pill-btn w-full text-left"
                    onClick={signOutAccount}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className={`${containerClass} pt-2 pb-5 sm:pt-3 sm:pb-9`}>
        {googleAuthStatus === "unauthenticated" && (
          <div className="surface-card p-3 mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-700">
              Google is not authorised for this browser session.
            </p>
            <AuthButton />
          </div>
        )}
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

      {gamificationOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[180] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setGamificationOpen(false);
            }}
          >
            <div
              className="surface-card-strong w-full max-w-5xl max-h-[90vh] overflow-y-auto p-4 sm:p-5"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Streaks</h2>
                <button
                  type="button"
                  onClick={() => setGamificationOpen(false)}
                  className="pill-btn"
                >
                  Close
                </button>
              </div>
              <GamificationPanel />
            </div>
          </div>,
          document.body
        )}

      {dailyTrackerVisible &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[180] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDailyTracker();
            }}
          >
            <div
              className="surface-card-strong w-full max-w-3xl h-[90vh] max-h-[90vh] overflow-hidden p-4 sm:p-5"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <DailyTrackerPopup onClose={closeDailyTracker} />
            </div>
          </div>,
          document.body
        )}

      {studyTimerOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[180] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setStudyTimerOpen(false);
            }}
          >
            <div
              className="w-full max-w-5xl h-[90vh] max-h-[90vh]"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <StudyTimerPopup
                state={studyTimerState}
                onClose={() => setStudyTimerOpen(false)}
                onStart={() =>
                  setStudyTimerState((previous) => startStudyTimer(previous, Date.now()))
                }
                onPause={() =>
                  setStudyTimerState((previous) => pauseStudyTimer(previous, Date.now()))
                }
                onReset={() => setStudyTimerState((previous) => resetStudyTimer(previous))}
                onApplySettings={applyTimerSettings}
                onToggleExamMode={toggleTimerExamMode}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
