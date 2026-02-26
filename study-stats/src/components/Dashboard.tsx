"use client";

import { useSession } from "next-auth/react";
import TodayProgress from "./TodayProgress";
import DailyStudyChart from "./DailyStudyChart";
import SubjectDistribution from "./SubjectDistribution";
import StudyProjection from "./StudyProjection";
import HabitTracker from "./HabitTracker";

export default function Dashboard() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-sky-500" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-semibold mb-3">Welcome to Study Stats</h2>
        <p className="text-zinc-500 mb-6 max-w-md mx-auto">
          Sign in with your Google account to view your study statistics from
          Google Calendar.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      <div className="xl:col-span-5">
        <TodayProgress />
      </div>
      <div className="xl:col-span-7">
        <StudyProjection />
      </div>
      <div className="xl:col-span-12">
        <HabitTracker />
      </div>
      <div className="xl:col-span-7">
        <DailyStudyChart />
      </div>
      <div className="xl:col-span-5">
        <SubjectDistribution />
      </div>
    </div>
  );
}
