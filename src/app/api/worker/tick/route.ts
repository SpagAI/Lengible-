import { NextResponse, type NextRequest } from "next/server";
import { adminClient, clientForUser } from "@/lib/supabase/admin";
import { withClient } from "@/lib/supabase/server";
import { backfill, enqueue, workQueue } from "@/lib/jobs";
import { checkDriveLinks } from "@/lib/drive-updates";

// The background worker: Supabase calls this every minute (see supabase/setup_worker.sql), so files keep
// being brought in and processed with Lengible closed. Each run works for up to ~4 minutes; runs overlap,
// and each job is claimed by one run at a time.
export const maxDuration = 300;
const BUDGET_MS = 250_000;

// Per warm server: Drive checks and the catch-up scan don't need to run every minute.
const lastScan = new Map<string, number>();

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY isn't set." }, { status: 500 });
  const deadline = Date.now() + BUDGET_MS;

  // Who has work: files waiting in the queue, or Drive links due a check.
  const now = new Date().toISOString();
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const [{ data: waiting }, { data: links }] = await Promise.all([
    admin.from("process_jobs").select("user_id").eq("state", "queued").or(`not_before.is.null,not_before.lt.${now}`).limit(500),
    admin.from("drive_sources").select("user_id").is("removed_at", null).eq("auto_import", true).or(`last_checked_at.is.null,last_checked_at.lt.${hourAgo}`).limit(100),
  ]);
  const users = [...new Set([...(waiting ?? []), ...(links ?? [])].map((r) => r.user_id))].slice(0, 5);
  const report: Record<string, unknown> = {};
  await Promise.all(
    users.map(async (userId) => {
      try {
        const supabase = await clientForUser(userId);
        report[userId] = await withClient(supabase as never, async () => {
          let queued = 0;
          if (Date.now() - (lastScan.get(userId) ?? 0) > 10 * 60_000) {
            lastScan.set(userId, Date.now());
            const r = await checkDriveLinks(supabase).catch(() => ({ items: [] as { id: string; name: string; changed: boolean }[] }));
            if (r.items.length) queued += (await enqueue(supabase, r.items.map((i) => ({ driveItemId: i.id, name: i.changed ? `${i.name} (newer version)` : i.name, again: i.changed })))).added;
            queued += (await backfill(supabase)).added;
          }
          return { queued, ...(await workQueue(supabase, userId, deadline, 4)) };
        });
      } catch (e) {
        report[userId] = { error: e instanceof Error ? e.message : "failed" };
      }
    }),
  );
  return NextResponse.json({ users: users.length, report });
}

// Vercel Cron (if you use it instead) calls with GET.
export const GET = POST;
