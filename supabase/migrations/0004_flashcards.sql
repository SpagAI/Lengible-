-- Lengible — Phase 4: flashcards with spaced repetition (FSRS).
-- Run this in Supabase → SQL Editor, after 0003_drugs.sql. Safe to run again.

alter table public.profiles add column if not exists new_cards_per_day int not null default 20;

-- A deck is made from a drug group, from one uploaded file, or by you.
create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  course_id uuid references public.courses (id) on delete set null,
  kind text not null default 'custom' check (kind in ('drugs', 'material', 'custom')),
  drug_class_id uuid references public.drug_classes (id) on delete cascade,
  file_id uuid references public.files (id) on delete cascade,
  -- Material decks: how far through the file's text cards have been made (characters).
  next_offset int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, drug_class_id),
  unique (user_id, file_id)
);

-- One card. The FSRS fields hold its memory state; "due" is when it next comes up.
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deck_id uuid not null references public.decks (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  kind text not null default 'basic' check (kind in ('basic', 'cloze', 'image')),
  front text not null,
  back text not null,
  extra text,
  image_path text,
  source text not null default 'manual' check (source in ('drug', 'material', 'manual')),
  -- Stable key for generated cards, so making a deck again updates instead of duplicating.
  source_ref text,
  drug_id uuid references public.drugs (id) on delete cascade,
  file_id uuid references public.files (id) on delete set null,
  page int,
  -- 0 = on your syllabus (new cards come first), 1 = extra.
  priority smallint not null default 1,
  suspended boolean not null default false,
  due timestamptz not null default now(),
  stability double precision not null default 0,
  difficulty double precision not null default 0,
  elapsed_days int not null default 0,
  scheduled_days int not null default 0,
  learning_steps int not null default 0,
  reps int not null default 0,
  lapses int not null default 0,
  state smallint not null default 0, -- 0 new, 1 learning, 2 review, 3 relearning
  last_review timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_ref)
);
create index if not exists cards_deck_idx on public.cards (deck_id);
create index if not exists cards_due_idx on public.cards (user_id, due) where not suspended;

-- Every answer you give, for progress and streaks.
create table if not exists public.card_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  rating smallint not null, -- 1 again, 2 hard, 3 good, 4 easy
  state smallint not null, -- the card's state before this answer
  scheduled_days int not null default 0,
  review_date date not null, -- your local (Lagos) date
  duration_ms int,
  created_at timestamptz not null default now()
);
create index if not exists card_reviews_day_idx on public.card_reviews (user_id, review_date);

-- A day counts toward the flashcard streak once done = true (20 answers, or nothing left due).
create table if not exists public.flashcard_days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  reviews int not null default 0,
  done boolean not null default false,
  primary key (user_id, day)
);

do $$
declare t text;
begin
  foreach t in array array['decks', 'cards', 'card_reviews', 'flashcard_days'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Card counts per deck (due now, new, total), without loading every card.
create or replace function public.deck_counts()
returns table (deck_id uuid, total bigint, due_now bigint, new_count bigint, suspended bigint)
language sql stable security invoker
set search_path = public
as $$
  select c.deck_id,
         count(*) filter (where not c.suspended),
         count(*) filter (where not c.suspended and c.state <> 0 and c.due <= now()),
         count(*) filter (where not c.suspended and c.state = 0),
         count(*) filter (where c.suspended)
  from public.cards c
  where c.user_id = auth.uid()
  group by c.deck_id;
$$;
