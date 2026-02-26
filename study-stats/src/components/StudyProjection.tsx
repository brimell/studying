"use client";

import { useState } from "react";
import type { ProjectionData } from "@/lib/types";

export default function StudyProjection() {
  const [endDate, setEndDate] = useState("2025-05-20");
  const [hoursPerDay, setHoursPerDay] = useState(5);

  const now = new Date();
  const target = new Date(endDate);
  const daysRemaining = Math.max(
    0,
    Math.ceil((target.getTime() - now.getTime()) / (1000 * 86400))
  );
  const totalHours = daysRemaining * hoursPerDay;
  const hoursPerSubject = Math.round(totalHours / 3);

  return (
    <div className="rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <h2 className="text-lg font-semibold mb-4">Study Projection</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <label className="flex flex-col gap-1 text-sm">
          Target date
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Hours per day
          <input
            type="number"
            min={1}
            max={16}
            value={hoursPerDay}
            onChange={(e) => setHoursPerDay(Number(e.target.value))}
            className="border rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700"
          />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-4 text-center">
        <StatCard label="Days remaining" value={daysRemaining} />
        <StatCard label="Total hours" value={totalHours} />
        <StatCard label="Hours / subject" value={hoursPerSubject} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-zinc-500 mt-1">{label}</p>
    </div>
  );
}
