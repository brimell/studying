"use client";

import Link from "next/link";
import AuthButton from "@/components/AuthButton";
import SupabaseAccountSync from "@/components/SupabaseAccountSync";
import WorkoutPlanner from "@/components/WorkoutPlanner";

export default function WorkoutsPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-zinc-900/80 backdrop-blur border-b border-zinc-200 dark:border-zinc-800">
        <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="px-2.5 py-1 rounded-md text-xs bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors"
            >
              ← Dashboard
            </Link>
            <h1 className="text-xl font-bold tracking-tight">Workout Planner</h1>
          </div>
          <div className="flex items-center gap-3">
            <SupabaseAccountSync />
            <AuthButton />
          </div>
        </div>
      </header>

      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <WorkoutPlanner />
      </main>
    </div>
  );
}
