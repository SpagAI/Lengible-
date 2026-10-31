-- Lengible: Ally chat history, reconnecting Drive links, and exact folder counts.
-- Run this in Supabase → SQL Editor, after 0007_drive_links.sql. Safe to run again.

-- Drive links: disconnecting keeps the link and everything brought in, so reconnecting is instant
-- (no re-downloading or re-processing). Also every folder in the link (empty ones too) for exact counts.
alter table public.drive_sources add column if not exists removed_at timestamptz;
alter table public.drive_sources add column if not exists folder_paths text[] not null default '{}';
alter table public.drive_sources add column if not exists blocked_paths text[] not null default '{}';

-- Ally conversations, saved so you can go back to them.
create table if not exists public.ally_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  -- Where Ally searched: {"courseId": ...} / {"folderId": ...} / {"fileId": ...} / {} for everything.
  scope jsonb not null default '{}',
  scope_label text,
  -- [{ "q": "...", "result": {...answer, sources...} }, ...]
  messages jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ally_chats_user_idx on public.ally_chats (user_id, updated_at desc);

alter table public.ally_chats enable row level security;
drop policy if exists "own rows" on public.ally_chats;
create policy "own rows" on public.ally_chats for all using (user_id = auth.uid()) with check (user_id = auth.uid());
