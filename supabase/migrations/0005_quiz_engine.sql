-- Lengible — Phase 5: full quiz engine.
-- Run this once in Supabase → SQL Editor, after 0004_flashcards.sql.

-- Questions: formats are quickfire, mcq, tf (multiple true/false), short_essay, long_essay, picture.
--   answer holds: mcq → option index; tf → [true, false, …] per statement; quickfire/picture → the answer text;
--   essays → "" (they use model_answer and marking_points instead).
alter table public.questions
  add column if not exists model_answer text,
  add column if not exists marking_points jsonb,
  -- material | past | mb | standard | drugs | picture
  add column if not exists source_kind text,
  add column if not exists image_path text,
  add column if not exists card_id uuid references public.cards (id) on delete cascade,
  add column if not exists drug_class_id uuid references public.drug_classes (id) on delete set null,
  add column if not exists edited boolean not null default false,
  add column if not exists updated_at timestamptz;
create index if not exists questions_format_idx on public.questions (format, difficulty);
create unique index if not exists questions_card_idx on public.questions (user_id, card_id);

-- One quiz you build (or a drug quiz, or a group's mini-quiz).
create table public.quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mode text not null default 'custom' check (mode in ('custom', 'past', 'drugs', 'group')),
  title text not null,
  -- formats, difficulty, course_ids, topics, source, count, timed, negative_marking, …
  settings jsonb not null default '{}',
  question_ids uuid[] not null default '{}',
  -- Seconds allowed when timed; null = untimed.
  time_limit int,
  started_at timestamptz,
  finished_at timestamptz,
  -- Percentage, 0–100.
  score real,
  created_at timestamptz not null default now()
);
create index on public.quiz_sessions (user_id, created_at desc);
alter table public.quiz_sessions enable row level security;
create policy "own rows" on public.quiz_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Answers: partial credit (essays, true/false), your typed answer, the AI's marking, and the topic for weak-topic tracking.
alter table public.attempts
  add column if not exists quiz_session_id uuid references public.quiz_sessions (id) on delete cascade,
  add column if not exists score real,
  add column if not exists answer_text text,
  add column if not exists feedback jsonb,
  add column if not exists topic_name text;
create index if not exists attempts_session_idx on public.attempts (quiz_session_id);

update public.attempts a set topic_name = q.topic_name, score = case when a.correct then 1 else 0 end
from public.questions q where q.id = a.question_id and a.topic_name is null;
update public.questions set source_kind = case when source_file_id is null then 'standard' else 'material' end where source_kind is null;
