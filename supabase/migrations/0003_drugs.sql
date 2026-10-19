-- Lengible — Phase 3: drug database.
-- Run this once in Supabase → SQL Editor, after 0002_library.sql.
-- The starting drug list is copied into your own account (so you can edit and verify every entry);
-- seed_key links each row back to Lengible's list so later updates can add new drugs without
-- touching the ones you have edited.

create table public.drug_classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  seed_key text,
  parent_id uuid references public.drug_classes (id) on delete cascade,
  name text not null,
  system text not null,
  description text,
  mnemonic text,
  recognition_tip text,
  sort_order int not null default 0,
  verified boolean not null default false,
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, seed_key)
);
create index on public.drug_classes (parent_id);

create table public.drugs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  seed_key text,
  class_id uuid not null references public.drug_classes (id) on delete cascade,
  name text not null,
  is_prototype boolean not null default false,
  mechanism text,
  indications text[] not null default '{}',
  side_effects text[] not null default '{}',
  contraindications text[] not null default '{}',
  interactions text[] not null default '{}',
  pharmacokinetics text,
  brands text[] not null default '{}',
  nigerian_context text,
  notes text,
  verified boolean not null default false,
  edited boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, seed_key)
);
create index on public.drugs (class_id);
create index on public.drugs (lower(name));

-- Pill and packaging photos: official images (stored as a link with their source) or your own uploads.
create table public.drug_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  drug_id uuid not null references public.drugs (id) on delete cascade,
  url text,
  storage_path text,
  source text not null,
  source_url text,
  caption text,
  created_at timestamptz not null default now(),
  check (url is not null or storage_path is not null)
);
create index on public.drug_images (drug_id);

do $$
declare t text;
begin
  foreach t in array array['drug_classes', 'drugs', 'drug_images'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
