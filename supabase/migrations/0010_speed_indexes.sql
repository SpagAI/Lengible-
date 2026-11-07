-- Lengible: indexes for lookups that run all the time, so they stay quick as your Library grows.
-- Safe to run more than once. Paste into Supabase → SQL Editor and click Run.

-- Pages still to be indexed for search by meaning (the background worker looks for these every minute).
create index if not exists chunks_unindexed_idx on public.chunks (user_id) where embedding is null;

-- Finding a copy of the same file already processed (same content, or same Drive fingerprint).
create index if not exists files_content_hash_idx on public.files (content_hash) where content_hash is not null;
create index if not exists drive_items_md5_idx on public.drive_items (md5) where md5 is not null;

-- From a Library file to its Drive entry (reading it from Drive, marking it brought in).
create index if not exists drive_items_file_idx on public.drive_items (file_id) where file_id is not null;

-- The Drive page lists a link's files in folder order.
create index if not exists drive_items_source_path_idx on public.drive_items (source_id, path, name, id);

-- Files finished in the last 24 hours (the processing panel's count).
create index if not exists process_jobs_finished_idx on public.process_jobs (user_id, finished_at desc) where state = 'done';
