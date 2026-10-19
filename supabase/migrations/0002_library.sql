-- Lengible — Phase 2: course groups, blocks (postings), timetable, library, cross-links, daily quiz.
-- Run this once in Supabase → SQL Editor, after 0001_foundation.sql.

-- Profiles remember which version of the starting structure they have.
alter table public.profiles add column if not exists structure_version int not null default 1;

-- Course groups: Pathology is a group holding Histopathology, Chemical Pathology, Haematology and MMP.
alter table public.courses add column if not exists parent_id uuid references public.courses (id) on delete cascade;
alter table public.courses add column if not exists is_group boolean not null default false;
alter table public.courses add column if not exists short_name text;

-- Blocks (postings), e.g. "Block 2" from 31 Aug to 23 Oct.
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

alter table public.topics add column if not exists block_id uuid references public.blocks (id) on delete set null;
alter table public.topics add column if not exists session_type text not null default 'lecture'
  check (session_type in ('section', 'lecture', 'tutorial', 'practical', 'other'));
alter table public.topics add column if not exists lecturer_id uuid references public.lecturers (id) on delete set null;
create unique index if not exists topics_unique_name on public.topics (course_id, lower(name), session_type);

-- Exams and tests. "eopt" = End of Posting Test. Dates detected from a timetable start unconfirmed.
alter table public.course_exams add column if not exists kind text not null default 'exam'
  check (kind in ('exam', 'eopt', 'test', 'mb', 'other'));
alter table public.course_exams add column if not exists block_id uuid references public.blocks (id) on delete set null;
alter table public.course_exams add column if not exists start_time text;
alter table public.course_exams add column if not exists venue text;
alter table public.course_exams add column if not exists confirmed boolean not null default true;
alter table public.course_exams add column if not exists source_file_id uuid;

-- Library: folders and files per course.
-- course_id is empty for "General" items that cover every course, like the master timetable.
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  parent_id uuid references public.folders (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index on public.folders (course_id);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete set null,
  topic_id uuid references public.topics (id) on delete set null,
  name text not null,
  doc_type text not null default 'other' check (doc_type in (
    'slides', 'timetable', 'topic_list', 'textbook', 'past_questions', 'picture_test',
    'practical', 'manual', 'essay', 'mb_questions', 'notes', 'other')),
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  -- uploaded → extracted (text saved) → analysed (AI pass done). "no_text" = scanned/image, needs AI reading.
  status text not null default 'uploaded' check (status in ('uploaded', 'extracted', 'no_text', 'analysed', 'failed')),
  error text,
  page_count int,
  -- Results of the AI pass (timetable sessions, topic lists) waiting for your review.
  analysis jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.files (course_id);
create index on public.files (folder_id);

alter table public.course_exams add constraint course_exams_source_file_fk
  foreign key (source_file_id) references public.files (id) on delete set null;

-- Extracted text, one row per page or slide, searchable.
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  page int not null,
  content text not null,
  tsv tsvector generated always as (to_tsvector('english', content)) stored
);
create index on public.chunks (file_id);
create index on public.chunks using gin (tsv);

-- Timetable entries: one row per scheduled lecture, tutorial, practical or assessment.
create table public.schedule_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  block_id uuid references public.blocks (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  source_file_id uuid references public.files (id) on delete set null,
  session_date date not null,
  start_time text,
  end_time text,
  session_type text not null default 'lecture',
  title text not null,
  lecturer text,
  venue text,
  groups text,
  created_at timestamptz not null default now()
);
create index on public.schedule_sessions (session_date);

-- Cross-links: drugs, diseases, organisms and tests found in your materials.
create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'other' check (kind in ('drug', 'disease', 'organism', 'investigation', 'other')),
  aliases text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);
create unique index concepts_unique_name on public.concepts (user_id, lower(name));

create table public.file_concepts (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  concept_id uuid not null references public.concepts (id) on delete cascade,
  pages int[] not null default '{}',
  primary key (file_id, concept_id)
);

-- Questions (shared with the full quiz engine in Phase 5), daily quizzes and answers.
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  format text not null default 'mcq',
  difficulty text not null default 'medium',
  stem text not null,
  options jsonb not null default '[]',
  answer jsonb not null,
  explanation text,
  why_wrong jsonb,
  source_label text,
  source_file_id uuid references public.files (id) on delete set null,
  source_page int,
  topic_name text,
  flagged boolean not null default false,
  flag_note text,
  created_at timestamptz not null default now()
);
create index on public.questions (course_id);

create table public.daily_quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  quiz_date date not null,
  question_ids uuid[] not null,
  score int,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, quiz_date)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  course_id uuid references public.courses (id) on delete cascade,
  daily_quiz_id uuid references public.daily_quizzes (id) on delete cascade,
  chosen jsonb,
  correct boolean not null,
  created_at timestamptz not null default now()
);
create index on public.attempts (course_id);

-- Row-level security for every new table.
do $$
declare t text;
begin
  foreach t in array array['blocks', 'folders', 'files', 'chunks', 'schedule_sessions', 'concepts', 'file_concepts',
                           'questions', 'daily_quizzes', 'attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Full-text search across your materials. Runs with your permissions, so it only sees your rows.
create or replace function public.search_chunks(q text, course uuid default null, lim int default 40)
returns table (chunk_id uuid, file_id uuid, file_name text, course_id uuid, page int, snippet text, rank real)
language sql stable security invoker as $$
  select c.id, c.file_id, f.name, c.course_id, c.page,
         ts_headline('english', c.content, websearch_to_tsquery('english', q),
                     'StartSel=<<, StopSel=>>, MaxWords=30, MinWords=12, MaxFragments=1'),
         ts_rank(c.tsv, websearch_to_tsquery('english', q))
  from public.chunks c join public.files f on f.id = c.file_id
  where c.tsv @@ websearch_to_tsquery('english', q)
    and (course is null or c.course_id = course)
  order by 7 desc
  limit lim;
$$;

-- File storage: a private bucket; each user can only touch files under their own folder.
insert into storage.buckets (id, name, public, file_size_limit)
values ('library', 'library', false, 52428800)
on conflict (id) do nothing;

create policy "library: own files read" on storage.objects for select
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "library: own files insert" on storage.objects for insert
  with check (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "library: own files update" on storage.objects for update
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "library: own files delete" on storage.objects for delete
  using (bucket_id = 'library' and (storage.foldername(name))[1] = auth.uid()::text);
