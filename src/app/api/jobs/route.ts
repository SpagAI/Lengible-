import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enqueue, isStarted, jobPercent, type ProcessJob } from "@/lib/jobs";
import { isMissingTable } from "@/lib/drugs";
import { serviceKey } from "@/lib/supabase/admin";

// The processing queue: GET lists your jobs (running and recent), POST adds files or pauses/resumes/stops/retries.
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ jobs: [] });
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [{ data: open, error }, { data: recent }] = await Promise.all([
    supabase.from("process_jobs").select("*").in("state", ["queued", "paused", "stopped", "failed"]).order("priority", { ascending: false }).order("created_at").limit(300),
    supabase.from("process_jobs").select("*").eq("state", "done").gt("finished_at", dayAgo).order("finished_at", { ascending: false }).limit(50),
  ]);
  if (error) return NextResponse.json({ jobs: [], setup: isMissingTable(error) });
  // Totals over every job (the list above is capped at 300 for speed), so the panel's numbers are exact.
  const summary = { total: 0, active: 0, waiting: 0, paused: 0, failed: 0, done: 0, percent: 0, waitingAi: 0, lastProgress: null as string | null, doneToday: 0 };
  let sum = 0;
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await supabase
      .from("process_jobs")
      .select("state, step, progress, not_before, finished_at, note, updated_at")
      .or(`state.neq.done,finished_at.gt.${dayAgo}`)
      .order("id")
      .range(from, from + 999);
    for (const j of data ?? []) {
      summary.total++;
      if (j.state === "queued") summary.active++;
      if (j.state === "queued" && j.not_before && new Date(j.not_before).getTime() > Date.now()) {
        summary.waiting++;
        // Waiting for Google's AI limit (per minute or per day), not a problem with the file.
        if (/limit|allowance|overloaded|busy/i.test(j.note ?? "")) summary.waitingAi++;
      }
      if (j.state === "done" && j.finished_at && j.finished_at > dayAgo) summary.doneToday++;
      // When anything last moved forward.
      if (j.updated_at && (!summary.lastProgress || j.updated_at > summary.lastProgress)) summary.lastProgress = j.updated_at;
      if (j.state === "paused" || j.state === "stopped") summary.paused++;
      if (j.state === "failed") summary.failed++;
      if (j.state === "done") summary.done++;
      sum += jobPercent(j as unknown as ProcessJob);
    }
    if (!data || data.length < 1000) break;
  }
  summary.percent = summary.total ? Math.round(sum / summary.total) : 0;
  const jobs = [...(open ?? []), ...(recent ?? [])].map((j) => {
    const job = j as unknown as ProcessJob;
    const now = Date.now();
    return {
      id: job.id,
      name: job.name,
      fileId: job.file_id,
      driveItemId: job.drive_item_id,
      state: job.state,
      step: job.step,
      percent: jobPercent(job),
      // Being worked on right now (claimed by a worker).
      running: job.state === "queued" && !!job.locked_until && new Date(job.locked_until).getTime() > now,
      // One of the (at most 3) files being worked on; the rest wait their turn.
      started: isStarted(job.priority),
      waitingUntil: job.not_before && new Date(job.not_before).getTime() > now ? job.not_before : null,
      note: job.note,
      error: job.error,
      done: job.progress?.done ?? null,
      total: job.progress?.total ?? null,
      finishedAt: job.finished_at,
    };
  });
  // Whether the background worker can run (its settings are in Vercel). If not, files only move while Lengible is open.
  const worker = { configured: !!(process.env.CRON_SECRET?.trim() && serviceKey()) };
  return NextResponse.json({ jobs, summary, worker });
}

type Body =
  | { action: "enqueue"; items: { fileId?: string; driveItemId?: string; name: string; again?: boolean }[] }
  | { action: "pause" | "resume" | "stop" | "retry" | "remove" | "retry-waiting"; ids?: string[]; all?: boolean }
  | { action: "clear" };

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
  const now = new Date().toISOString();

  if (body.action === "enqueue") {
    const r = await enqueue(supabase, (body.items ?? []).slice(0, 2000));
    return NextResponse.json(r);
  }
  if (body.action === "clear") {
    // Clears finished jobs from the list (the files stay processed).
    await supabase.from("process_jobs").delete().eq("state", "done");
    return NextResponse.json({ ok: true });
  }
  // Pause: stops after the current small step and keeps its place. Stop: the same, until you resume it.
  // Resume and Retry carry on from the step where it stopped (finished steps are never redone).
  type Patch = { state: string; updated_at: string; not_before?: null; attempts?: number; error?: null; note?: null; locked_until?: null; finished_at?: null };
  const change: Record<string, { from: string[]; to: Patch }> = {
    pause: { from: ["queued"], to: { state: "paused", updated_at: now } },
    stop: { from: ["queued", "paused"], to: { state: "stopped", updated_at: now } },
    resume: { from: ["paused", "stopped"], to: { state: "queued", not_before: null, updated_at: now } },
    retry: { from: ["failed", "stopped", "paused", "queued"], to: { state: "queued", attempts: 0, error: null, note: null, not_before: null, locked_until: null, finished_at: null, updated_at: now } },
  };
  // Everything waiting after a problem, and everything that failed: try again now, from the step each one reached.
  if (body.action === "retry-waiting") {
    await supabase.from("process_jobs").update({ not_before: null, note: null, attempts: 0, updated_at: now }).eq("state", "queued").not("not_before", "is", null);
    await supabase.from("process_jobs").update({ state: "queued", attempts: 0, error: null, note: null, not_before: null, locked_until: null, finished_at: null, updated_at: now }).eq("state", "failed");
    return NextResponse.json({ ok: true });
  }
  if (body.action === "remove") {
    let q = supabase.from("process_jobs").delete().in("state", ["paused", "stopped", "failed", "done"]);
    if (!body.all) q = q.in("id", body.ids ?? []);
    await q;
    return NextResponse.json({ ok: true });
  }
  const c = change[body.action];
  if (!c) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  let q = supabase.from("process_jobs").update(c.to).in("state", c.from);
  if (!body.all) q = q.in("id", body.ids ?? []);
  await q;
  return NextResponse.json({ ok: true });
}
