-- Lengible background worker: every minute, Supabase asks your Lengible site to carry on processing,
-- so files keep being brought in and read even when Lengible is closed.
--
-- One time, after 0009_server_processing.sql:
--   1. Replace YOUR-SITE with your Vercel address (e.g. lengible.vercel.app)
--      and YOUR-CRON-SECRET with the same value you put in Vercel as CRON_SECRET.
--   2. Paste this into Supabase → SQL Editor and click Run.
-- Running it again just updates the schedule.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('lengible-worker') where exists (select 1 from cron.job where jobname = 'lengible-worker');

select cron.schedule(
  'lengible-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-SITE/api/worker/tick',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR-CRON-SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- To stop it: select cron.unschedule('lengible-worker');

-- If you set this up before (with a 5-second wait), this one line gives the scheduler 30 seconds instead,
-- without retyping your site or secret:
--   select cron.alter_job(jobid, command := replace(command, 'timeout_milliseconds := 5000', 'timeout_milliseconds := 30000')) from cron.job where jobname = 'lengible-worker';
