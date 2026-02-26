create table if not exists public.study_stats_user_sync (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists study_stats_user_sync_updated_at_idx
  on public.study_stats_user_sync (updated_at desc);
