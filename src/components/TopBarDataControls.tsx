"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { formatTimeSince, readGlobalLastFetched } from "@/lib/client-cache";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/scroll-lock";
import StudyProjection from "@/components/StudyProjection";

export default function TopBarDataControls() {
  const lastFetchedAt = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("study-stats:last-fetched-updated", onStoreChange);
      return () => window.removeEventListener("study-stats:last-fetched-updated", onStoreChange);
    },
    () => readGlobalLastFetched(),
    () => null
  );
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [showStudyProjection, setShowStudyProjection] = useState(false);
  const mounted = typeof window !== "undefined";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showStudyProjection) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [showStudyProjection]);

  const refreshAll = () => {
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent("study-stats:refresh-all"));
    window.setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setShowStudyProjection(true)}
        className="pill-btn"
      >
        <span className="sm:hidden">Project</span>
        <span className="hidden sm:inline">Project Studying</span>
      </button>
      <p className="soft-text text-[11px] hidden lg:block">
        Last fetched {formatTimeSince(lastFetchedAt, now)}
      </p>
      <button
        onClick={refreshAll}
        disabled={refreshing}
        className="pill-btn"
      >
        {refreshing ? "Refreshing..." : "Refresh"}
      </button>

      {mounted &&
        showStudyProjection &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-900/55 p-4 overflow-y-auto"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShowStudyProjection(false);
            }}
          >
            <div
              className="surface-card-strong w-full max-w-4xl max-h-[90vh] overflow-y-auto p-4 my-auto"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold">Project Studying</h4>
                <button
                  type="button"
                  onClick={() => setShowStudyProjection(false)}
                  className="pill-btn"
                >
                  Close
                </button>
              </div>
              <StudyProjection />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
