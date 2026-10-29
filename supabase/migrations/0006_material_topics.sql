-- Lengible: topics found in your uploaded materials.
-- Run this in Supabase → SQL Editor, after 0005_quiz_engine.sql. Safe to run again.

-- Where a topic came from: your topic list / timetable ("list"), your slides and notes ("material"), or typed by you ("manual").
alter table public.topics add column if not exists source text not null default 'list';

-- Which files (and pages) cover each topic, with the headings and key points the AI found there.
create table if not exists public.topic_files (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  start_page int,
  end_page int,
  subtopics text[] not null default '{}',
  key_points text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (topic_id, file_id)
);
create index if not exists topic_files_file_idx on public.topic_files (file_id);
alter table public.topic_files enable row level security;
drop policy if exists "own rows" on public.topic_files;
create policy "own rows" on public.topic_files for all using (user_id = auth.uid()) with check (user_id = auth.uid());
