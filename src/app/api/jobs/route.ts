import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enqueue, jobPercent, type ProcessJob } from "@/lib/jobs";
import { isMissingTable } from "@/lib/drugs";

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
      waitingUntil: job.not_before && new Date(job.not_before).getTime() > now ? job.not_before : null,
      note: job.note,
      error: job.error,
      done: job.progress?.done ?? null,
      total: job.progress?.total ?? null,
      finishedAt: job.finished_at,
    };
  });
  return NextResponse.json({ jobs });
}

type Body =
  | { action: "enqueue"; items: { fileId?: string; driveItemId?: string; name: string; again?: boolean }[] }
  | { action: "pause" | "resume" | "stop" | "retry" | "remove"; ids?: string[]; all?: boolean }
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
