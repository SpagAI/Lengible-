-- Lengible: bring in files from Google Drive links shared with you (e.g. your class folder).
-- Run this in Supabase → SQL Editor, after 0006_material_topics.sql. Safe to run again.

-- A shared Drive folder (or single file) link you added.
create table if not exists public.drive_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  link text not null,
  drive_id text not null,
  resource_key text,
  name text not null,
  is_folder boolean not null default true,
  -- New files found later are brought in by themselves.
  auto_import boolean not null default true,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, drive_id)
);

-- Every file inside the link, where it goes in your Library, and whether it has changed since it was brought in.
create table if not exists public.drive_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_id uuid not null references public.drive_sources (id) on delete cascade,
  drive_id text not null,
  resource_key text,
  name text not null,
  mime text not null,
  -- Folder path inside the link, e.g. "Haematology/Slides" ("" for the top level).
  path text not null default '',
  size_bytes bigint,
  modified_time timestamptz,
  md5 text,
  course_id uuid references public.courses (id) on delete set null,
  doc_type text not null default 'other',
  include boolean not null default true,
  -- new | imported | changed | skipped | error | removed
  status text not null default 'new',
  error text,
  file_id uuid references public.files (id) on delete set null,
  imported_modified timestamptz,
  -- Set while one device is bringing the file in, so two devices never import it twice.
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_id, drive_id)
);
create index if not exists drive_items_source_idx on public.drive_items (source_id);

do $$
declare t text;
begin
  foreach t in array array['drive_sources', 'drive_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
