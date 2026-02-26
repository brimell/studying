"use client";

import { useEffect, useState } from "react";
import { formatTimeSince, readGlobalLastFetched } from "@/lib/client-cache";

export default function TopBarDataControls() {
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setLastFetchedAt(readGlobalLastFetched());

    const onUpdate = () => setLastFetchedAt(readGlobalLastFetched());
    window.addEventListener("study-stats:last-fetched-updated", onUpdate);

    return () => {
      window.removeEventListener("study-stats:last-fetched-updated", onUpdate);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshAll = () => {
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent("study-stats:refresh-all"));
    window.setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <div className="flex items-center gap-2">
      <p className="text-[11px] text-zinc-500 hidden md:block">
        Last fetched {formatTimeSince(lastFetchedAt, now)}
      </p>
      <button
        onClick={refreshAll}
        disabled={refreshing}
        className="px-2 py-1 rounded-md text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors"
      >
        {refreshing ? "Refreshing..." : "Refresh Data"}
      </button>
    </div>
  );
}
