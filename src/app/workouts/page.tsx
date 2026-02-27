"use client";

import Link from "next/link";
import AuthButton from "@/components/AuthButton";
import SupabaseAccountSync from "@/components/SupabaseAccountSync";
import { WorkoutDataProvider } from "@/components/WorkoutDataProvider";
import WorkoutPlanner from "@/components/WorkoutPlanner";

export default function WorkoutsPage() {
  return (
    <div className="app-shell">
      <header className="top-nav sticky top-0 z-50">
        <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="pill-btn"
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
        <WorkoutDataProvider>
          <WorkoutPlanner />
        </WorkoutDataProvider>
      </main>
    </div>
  );
}
