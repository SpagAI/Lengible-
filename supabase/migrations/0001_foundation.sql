-- Lengible — Phase 1: foundation schema.
-- Run this once in Supabase → SQL Editor before signing in for the first time.
-- Every table belongs to one user (user_id) and row-level security keeps rows private to that user.

create extension if not exists pgcrypto;

-- One row per user; created by the app on first sign-in.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

-- A course. "kind" decides which course-specific modules show up (pharmacology drug mastery,
-- pathology picture tests, ...). New courses such as Medicine or Surgery use kind = 'general'.
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  code text,
  kind text not null default 'general' check (kind in ('general', 'pathology', 'pharmacology')),
  notes text,
  color text not null default 'teal',
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.courses (user_id);

create table public.course_exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  label text not null default 'Exam',
  exam_date date not null,
  created_at timestamptz not null default now()
);
create index on public.course_exams (course_id);

create table public.lecturers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  name text not null,
  -- What this lecturer emphasises, in your own words.
  notes text,
  created_at timestamptz not null default now()
);
create index on public.lecturers (course_id);

-- Topics form a tree: a section (e.g. "General Pathology") holds topics, which can hold subtopics.
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  parent_id uuid references public.topics (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.topics (course_id);

-- Which lecturer teaches which topic.
create table public.lecturer_topics (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lecturer_id uuid not null references public.lecturers (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  primary key (lecturer_id, topic_id)
);

-- Saved AI answers, keyed by a hash of the request, so the same request never costs a second API call.
create table public.ai_cache (
  key text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  model text not null,
  output text not null,
  created_at timestamptz not null default now()
);

-- Row-level security: each user sees and edits only their own rows.
do $$
declare t text;
begin
  foreach t in array array['courses', 'course_exams', 'lecturers', 'topics', 'lecturer_topics', 'ai_cache'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
