create table if not exists public.study_stats_user_sync (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists study_stats_user_sync_updated_at_idx
  on public.study_stats_user_sync (updated_at desc);

create table if not exists public.study_stats_workout_planner (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{"workouts":[],"logs":[]}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists study_stats_workout_planner_updated_at_idx
  on public.study_stats_workout_planner (updated_at desc);

create table if not exists public.study_stats_exam_countdown (
  user_id uuid primary key references auth.users (id) on delete cascade,
  exam_date date not null,
  countdown_start_date date not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists study_stats_exam_countdown_updated_at_idx
  on public.study_stats_exam_countdown (updated_at desc);
