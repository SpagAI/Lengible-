-- Lengible: processing on the server (keeps going with Lengible closed), file profiles,
-- the past-question bank, and search by meaning.
-- Run this in Supabase → SQL Editor, after 0008_ally_and_history.sql. Safe to run again.
-- Then follow supabase/setup_worker.sql once to start the background worker.

-- ——— Processing queue ———
-- One row per file being brought in / processed. Every step saves where it got to, so pausing, a network
-- problem or a retry continues from the last finished step instead of starting again.
create table if not exists public.process_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_id uuid references public.files (id) on delete cascade,
  drive_item_id uuid references public.drive_items (id) on delete cascade,
  name text not null,
  -- queued | paused | stopped | done | failed
  state text not null default 'queued',
  -- copy | text | pictures | analyse | profile | questions | embed | done
  step text not null default 'copy',
  progress jsonb not null default '{}',
  attempts int not null default 0,
  error text,
  -- A short note shown with the job, e.g. "Waiting for the AI allowance".
  note text,
  -- Claimed by a worker until this time; and not tried again before not_before (after a hiccup).
  locked_until timestamptz,
  not_before timestamptz,
  priority int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists process_jobs_user_state_idx on public.process_jobs (user_id, state, priority desc, created_at);
-- At most one unfinished job per file and per Drive item.
create unique index if not exists process_jobs_one_per_file on public.process_jobs (file_id) where state in ('queued', 'paused', 'stopped') and file_id is not null;
create unique index if not exists process_jobs_one_per_item on public.process_jobs (drive_item_id) where state in ('queued', 'paused', 'stopped') and drive_item_id is not null;

-- ——— File profiles ———
-- What each file is, worked out from its folder, name and first pages (you can correct it):
-- {"course": "...", "posting": "...", "set": "2K23", "kind": "lecture|practical|tutorial|past_questions|notes|other",
--  "exam": "mb|eopt|resit|test|departmental|other|null", "exam_year": 2023, "lecturer": "...", "topics": [...], "theory_or_practical": "theory|practical|both"}
alter table public.files add column if not exists profile jsonb;
-- Same content in two places is processed once.
alter table public.files add column if not exists content_hash text;

-- ——— Past-question bank ———
-- Every question pulled out of past-question files (MB, EOPT, resit, tests…), so repeats and trends can be counted.
create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  page int,
  -- mb | eopt | resit | test | departmental | other
  exam text not null default 'other',
  -- The class set, e.g. "2K23".
  class_set text,
  exam_year int,
  -- essay | short_note | mcq | tf | osce | practical | other
  format text not null default 'other',
  number text,
  question text not null,
  marks int,
  topic text,
  -- Questions asking the same thing (in any wording) share a cluster.
  cluster_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists exam_questions_user_idx on public.exam_questions (user_id, course_id);
create index if not exists exam_questions_cluster_idx on public.exam_questions (cluster_id);
create index if not exists exam_questions_file_idx on public.exam_questions (file_id);

-- ——— Search by meaning ———
create extension if not exists vector with schema extensions;
alter table public.chunks add column if not exists embedding extensions.vector(768);
create index if not exists chunks_embedding_idx on public.chunks using hnsw (embedding extensions.vector_cosine_ops);
alter table public.exam_questions add column if not exists embedding extensions.vector(768);

-- Pages closest in meaning to a question (only your own, through row-level security).
create or replace function public.match_chunks(query_embedding extensions.vector(768), match_count int default 40, course_ids uuid[] default null, file_ids uuid[] default null)
returns table (id uuid, file_id uuid, page int, content text, similarity float)
language sql stable security invoker
set search_path = public, extensions
as $$
  select c.id, c.file_id, c.page, c.content, 1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  where c.embedding is not null
    and (course_ids is null or c.course_id = any (course_ids))
    and (file_ids is null or c.file_id = any (file_ids))
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Past questions closest in meaning (to group repeats asked in different words).
create or replace function public.match_questions(query_embedding extensions.vector(768), match_count int default 5, in_course uuid default null)
returns table (id uuid, cluster_id uuid, question text, similarity float)
language sql stable security invoker
set search_path = public, extensions
as $$
  select q.id, q.cluster_id, q.question, 1 - (q.embedding <=> query_embedding) as similarity
  from public.exam_questions q
  where q.embedding is not null and (in_course is null or q.course_id = in_course)
  order by q.embedding <=> query_embedding
  limit match_count;
$$;

do $$
declare t text;
begin
  foreach t in array array['process_jobs', 'exam_questions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
