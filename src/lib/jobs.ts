import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, FileStatus, LibraryFile } from "@/lib/supabase/types";
import { AIError, generateJSON, isDailyMessage, msUntilDailyReset } from "@/lib/ai";
import { analyzeStep, type Analysis, ANALYSIS_VERSION, saveConcepts, saveSections } from "@/lib/analysis/run";
import { download, isDrivePath, isOfficeTemp, unsupportedReason } from "@/lib/drive";
import { parsePartsPath, partPaths } from "@/lib/library";
import { importDriveItem, markDriveItemDone } from "@/lib/drive-import";
import { extractAny, extractPdf } from "@/lib/extract/server";
import { profileStep, questionsStep, needsQuestions } from "@/lib/profile";
import { embedStep } from "@/lib/embed";

type DB = SupabaseClient<Database>;

// Processing on the server: a queue of jobs, one per file, worked through by the background worker (every
// minute, even with Lengible closed) and by any open Lengible tab. Each job goes through the steps below and
// saves where it got to after every one, so a pause, a network problem or a retry carries on from there.
//
//   copy      bring the file in from Google Drive (skipped for your own uploads)
//   text      read the text of every page
//   pictures  the AI reads pages that are mostly a picture (scans, diagrams, micrographs)
//   analyse   the AI finds sections, topics, drugs and diseases (several steps for big files)
//   profile   what the file is: course, set (2K23…), lecture/practical/past questions, exam, year, topics
//   questions past-question files: every question saved for the question bank and trends
//   embed     search by meaning

export type JobState = "queued" | "paused" | "stopped" | "done" | "failed";
export type JobStep = "copy" | "text" | "pictures" | "analyse" | "profile" | "questions" | "embed" | "done";
export type ProcessJob = {
  id: string;
  user_id: string;
  file_id: string | null;
  drive_item_id: string | null;
  name: string;
  state: JobState;
  step: JobStep;
  // textPage: for long PDFs, the next page to read (the text step saves its place every few pages).
  progress: { done?: number; total?: number; pictures?: number[]; message?: string; textPage?: number };
  attempts: number;
  error: string | null;
  note: string | null;
  locked_until: string | null;
  not_before: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

const STEPS: JobStep[] = ["copy", "text", "pictures", "analyse", "profile", "questions", "embed", "done"];
// Share of the progress bar each step covers (they add up to 100).
const WEIGHT: Record<JobStep, number> = { copy: 8, text: 12, pictures: 15, analyse: 40, profile: 5, questions: 10, embed: 10, done: 0 };

// How far along a job is, 0–100.
export function jobPercent(job: Pick<ProcessJob, "state" | "step" | "progress">) {
  if (job.state === "done" || job.step === "done") return 100;
  let pct = 0;
  for (const s of STEPS) {
    if (s === job.step) {
      const frac = job.progress.total ? Math.min(1, (job.progress.done ?? 0) / job.progress.total) : 0;
      return Math.round(pct + WEIGHT[s] * frac);
    }
    pct += WEIGHT[s];
  }
  return Math.round(pct);
}

const READ: FileStatus[] = ["extracted", "analysed"];

// The first step a file still needs, so finished work is never done again.
export async function firstStepFor(supabase: DB, file: LibraryFile | null): Promise<JobStep> {
  if (!file) return "copy";
  if (file.status === "uploaded" || file.status === "failed") return "text";
  if (file.status === "no_text") return "pictures";
  const a = file.analysis as Analysis | null;
  const analysed = file.status === "analysed" || (a?.kind === "concepts" && a.v === ANALYSIS_VERSION && (a.finished || a.skipped)) || !!a?.importedAt || !!a?.pendingReview;
  if (!analysed) return "analyse";
  if (!file.profile) return "profile";
  if (needsQuestions(file) && !(await hasQuestions(supabase, file.id))) return "questions";
  // Search-by-meaning indexing isn't needed for a file to be done: missing pages are indexed in the background.
  return "done";
}

async function hasQuestions(supabase: DB, fileId: string) {
  const { count } = await supabase.from("exam_questions").select("id", { count: "exact", head: true }).eq("file_id", fileId);
  return (count ?? 0) > 0;
}

// Smallest files first: the queue runs highest priority first, so a file's priority is minus its size in KB
// (a 2 MB file comes before a 40 MB one). Files of unknown size (e.g. Google Docs) count as small.
export const sizeOrder = (bytes: number | null | undefined) => (bytes ? -Math.ceil(bytes / 1024) : -1);

// Files queued before smallest-first existed (priority 0): give them their size order.
export async function orderBySize(supabase: DB) {
  const { data: jobs } = await supabase.from("process_jobs").select("id, file_id, drive_item_id").in("state", ["queued", "paused", "stopped"]).eq("priority", 0).limit(500);
  if (!jobs?.length) return;
  const fileIds = jobs.flatMap((j) => (j.file_id ? [j.file_id] : []));
  const itemIds = jobs.flatMap((j) => (!j.file_id && j.drive_item_id ? [j.drive_item_id] : []));
  const sizes = new Map<string, number | null>();
  for (let k = 0; k < fileIds.length; k += 150) {
    const { data } = await supabase.from("files").select("id, size_bytes").in("id", fileIds.slice(k, k + 150));
    for (const f of data ?? []) sizes.set(f.id, f.size_bytes);
  }
  for (let k = 0; k < itemIds.length; k += 150) {
    const { data } = await supabase.from("drive_items").select("id, size_bytes").in("id", itemIds.slice(k, k + 150));
    for (const i of data ?? []) sizes.set(i.id, i.size_bytes);
  }
  // Files of the same size share one update.
  const groups = new Map<number, string[]>();
  for (const j of jobs) {
    const v = sizeOrder(sizes.get(j.file_id ?? j.drive_item_id ?? "") ?? null);
    groups.set(v, [...(groups.get(v) ?? []), j.id]);
  }
  for (const [v, ids] of groups) await supabase.from("process_jobs").update({ priority: v }).in("id", ids);
}

// Adds files to the queue. Files already fully processed are skipped (unless `again`), and a file part-way
// through continues from its first unfinished step.
export async function enqueue(
  supabase: DB,
  items: { fileId?: string | null; driveItemId?: string | null; name: string; again?: boolean; priority?: number }[],
) {
  let added = 0;
  let skipped = 0;
  for (const it of items) {
    let step: JobStep = "copy";
    let fileId = it.fileId ?? null;
    let size: number | null = null;
    if (!it.driveItemId || fileId) {
      const { data } = fileId ? await supabase.from("files").select("*").eq("id", fileId).maybeSingle() : { data: null };
      size = (data as LibraryFile | null)?.size_bytes ?? null;
      step = it.again ? "text" : await firstStepFor(supabase, data as LibraryFile | null);
      if (!data) step = "copy";
      if (step === "done") {
        skipped++;
        continue;
      }
    }
    if (it.driveItemId && !it.fileId) {
      // A Drive file brought in before keeps its place; a newer version is copied again.
      const { data: item } = await supabase.from("drive_items").select("status, file_id, size_bytes").eq("id", it.driveItemId).maybeSingle();
      size = item?.size_bytes ?? null;
      if (item?.file_id && item.status === "imported" && !it.again) {
        fileId = item.file_id;
        const { data } = await supabase.from("files").select("*").eq("id", fileId).maybeSingle();
        step = await firstStepFor(supabase, data as LibraryFile | null);
        if (step === "done") {
          skipped++;
          continue;
        }
      }
    }
    // Revive a stopped or paused job for the same file instead of adding a second one.
    const existing = await findOpenJob(supabase, fileId, it.driveItemId ?? null);
    if (existing) {
      // Already waiting or being worked on: leave it exactly as it is (its place in the queue, its started
      // place among the 3, and any wait). Re-queuing it used to send files in progress back to the end of the
      // queue every time Drive was checked or "Bring in & process" was pressed, so big files never finished.
      if (existing.state === "queued" && !it.again) {
        skipped++;
        continue;
      }
      // A newer version starts again from the beginning; a paused or stopped file carries on where it was.
      await supabase
        .from("process_jobs")
        .update({
          state: "queued",
          attempts: 0,
          error: null,
          note: null,
          not_before: null,
          updated_at: new Date().toISOString(),
          ...(it.again ? { step, progress: {}, priority: it.priority ?? sizeOrder(size) } : {}),
        })
        .eq("id", existing.id);
      added++;
      continue;
    }
    const { error } = await supabase.from("process_jobs").insert({
      file_id: fileId,
      drive_item_id: it.driveItemId ?? null,
      name: it.name,
      step,
      priority: it.priority ?? sizeOrder(size),
    });
    if (!error) added++;
  }
  return { added, skipped };
}

async function findOpenJob(supabase: DB, fileId: string | null, driveItemId: string | null) {
  if (!fileId && !driveItemId) return null;
  let q = supabase.from("process_jobs").select("id, state").in("state", ["queued", "paused", "stopped"]);
  q = fileId ? q.eq("file_id", fileId) : q.eq("drive_item_id", driveItemId!);
  const { data } = await q.limit(1);
  return data?.[0] ?? null;
}

// ——— Working through the queue ———

const LOCK_MS = 5 * 60_000;
// A file that hits a problem gets 2 more tries (30 s, then 60 s later). If it still fails, it's left as Failed
// with the reason (it may need you, e.g. a damaged or private file) and its place goes to the next file.
const MAX_ATTEMPTS = 3;
const iso = (ms: number) => new Date(ms).toISOString();

// Works on a user's queue until the deadline: up to `parallel` files at once.
// At most 3 files are worked on at once. A file that has started keeps its place until it's finished (even
// while it waits for a time limit or the AI allowance, carrying on where it stopped); a new file, smallest
// first, starts only when one of the three finishes, fails, or you pause or stop it.
// PROCESS_FILES_AT_ONCE (1–10) raises it on a paid AI plan, where limits allow more at the same time.
export const MAX_OPEN = Math.min(10, Math.max(1, Number(process.env.PROCESS_FILES_AT_ONCE) || 3));
// A started file's priority is lifted by this much, so it stays ahead of files that haven't started.
export const STARTED = 1_000_000_000;
export const isStarted = (priority: number) => priority >= STARTED / 2;
// Files that used to wait in the queue only for search indexing (that now happens in the background).
const INDEX_LATER = -STARTED / 4;

export async function workQueue(supabase: DB, userId: string, deadline: number, parallel = MAX_OPEN) {
  await orderBySize(supabase).catch(() => {});
  // Files left waiting at 90% only for search indexing are finished: indexing carries on in the background.
  await supabase
    .from("process_jobs")
    .update({ state: "done", step: "done", note: null, not_before: null, locked_until: null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("state", "queued")
    .eq("step", "embed")
    .lt("priority", INDEX_LATER / 2);
  const done: string[] = [];
  const running = new Set<Promise<void>>();
  const take = async (j: ProcessJob, now: string) => {
    // One conditional update: if another worker took it first, nothing changes.
    const { data: got } = await supabase
      .from("process_jobs")
      .update({ locked_until: iso(Date.now() + LOCK_MS), priority: isStarted(j.priority) ? j.priority : j.priority + STARTED })
      .eq("id", j.id)
      .eq("state", "queued")
      .or(`locked_until.is.null,locked_until.lt.${now}`)
      .select("*");
    return (got?.[0] as ProcessJob | undefined) ?? null;
  };
  const claim = async () => {
    const now = new Date().toISOString();
    const ready = (j: Pick<ProcessJob, "not_before" | "locked_until">) => (!j.not_before || j.not_before < now) && (!j.locked_until || j.locked_until < now);
    // Files already started come first.
    const { data: open } = await supabase
      .from("process_jobs")
      .select("*")
      .eq("user_id", userId)
      .eq("state", "queued")
      .gte("priority", STARTED / 2)
      .order("priority", { ascending: false })
      .order("created_at");
    for (const j of ((open ?? []) as ProcessJob[]).filter(ready)) {
      const got = await take(j, now);
      if (got) return got;
    }
    // A free place: start the next file (smallest first).
    if ((open ?? []).length >= MAX_OPEN) return null;
    const { data: next } = await supabase
      .from("process_jobs")
      .select("*")
      .eq("user_id", userId)
      .eq("state", "queued")
      .lt("priority", STARTED / 2)
      .or(`not_before.is.null,not_before.lt.${now}`)
      .or(`locked_until.is.null,locked_until.lt.${now}`)
      .order("priority", { ascending: false })
      .order("created_at")
      .limit(6);
    for (const j of (next ?? []) as ProcessJob[]) {
      const got = await take(j, now);
      if (!got) continue;
      // Two runs may have started a file at the same moment: if that makes more than 3, put this one back.
      const { count } = await supabase.from("process_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("state", "queued").gte("priority", STARTED / 2);
      if ((count ?? 0) > MAX_OPEN) {
        await supabase.from("process_jobs").update({ locked_until: null, priority: j.priority }).eq("id", j.id);
        return null;
      }
      return got;
    }
    return null;
  };
  while (Date.now() < deadline - 20_000) {
    while (running.size < parallel && Date.now() < deadline - 20_000) {
      const job = await claim();
      if (!job) break;
      const p = runJob(supabase, job, deadline)
        .then(() => void done.push(job.id))
        .finally(() => running.delete(p));
      running.add(p);
    }
    if (!running.size) break;
    await Promise.race(running);
  }
  await Promise.all(running);
  return { worked: done.length };
}

// handOver: stopped near the time limit with its place saved; the next run carries on from there.
type Outcome = { handOver?: boolean; next?: JobStep; progress?: ProcessJob["progress"]; wait?: { ms: number; note: string }; fail?: string; finished?: boolean; patch?: Partial<ProcessJob> };

async function runJob(supabase: DB, start: ProcessJob, deadline: number) {
  let job = start;
  try {
    while (Date.now() < deadline - 25_000) {
      // You may have paused or stopped it from another screen.
      const { data: fresh } = await supabase.from("process_jobs").select("state").eq("id", job.id).maybeSingle();
      if (!fresh || fresh.state !== "queued") break;
      const out = await advance(supabase, job, deadline);
      const patch: Partial<ProcessJob> & { updated_at: string } = { updated_at: new Date().toISOString(), ...out.patch };
      if (out.progress) patch.progress = out.progress;
      if (out.next) {
        patch.step = out.next;
        patch.progress = out.progress ?? {};
        patch.attempts = 0;
        patch.note = null;
        patch.error = null;
      }
      if (out.wait) {
        patch.not_before = iso(Date.now() + out.wait.ms);
        patch.note = out.wait.note;
      }
      if (out.fail) {
        await markFileFailed(supabase, job, out.fail);
        patch.state = "failed";
        patch.error = out.fail;
        patch.finished_at = new Date().toISOString();
      }
      if (out.finished || out.next === "done") {
        patch.state = "done";
        patch.step = "done";
        patch.finished_at = new Date().toISOString();
        patch.note = null;
        if (job.drive_item_id) await markDriveItemDone(supabase, job.drive_item_id);
      }
      patch.locked_until = out.wait || out.fail || patch.state === "done" ? null : iso(Date.now() + LOCK_MS);
      await supabase.from("process_jobs").update(patch).eq("id", job.id);
      job = { ...job, ...patch } as ProcessJob;
      if (out.wait || out.fail || patch.state === "done") return;
      if (out.handOver) break;
    }
  } catch (e) {
    // Something unexpected (network, server): try again later, from this same step.
    const attempts = job.attempts + 1;
    const message = plainReason(e instanceof Error ? e.message : "Something went wrong.");
    await supabase
      .from("process_jobs")
      .update(
        attempts >= MAX_ATTEMPTS
          ? { state: "failed", error: `${message} (tried ${attempts} times)`, attempts, locked_until: null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : {
              attempts,
              note: `Problem (${message.slice(0, 120)}). Retry ${attempts} of ${MAX_ATTEMPTS - 1} in ${30 * attempts} seconds, from the same step.`,
              not_before: iso(Date.now() + 30_000 * attempts),
              locked_until: null,
              updated_at: new Date().toISOString(),
            },
      )
      .eq("id", job.id);
    if (attempts >= MAX_ATTEMPTS) await markFileFailed(supabase, job, `${message} (tried ${attempts} times)`);
    return;
  }
  // Out of time, or paused/stopped: let it go, so it can be picked up again straight away (e.g. after Resume).
  await supabase.from("process_jobs").update({ locked_until: null }).eq("id", job.id);
}

// Technical errors in plain words (what's wrong, and what you can do).
function plainReason(m: string) {
  if (/central directory|is this a zip|corrupted zip|end of data/i.test(m))
    return "The file is damaged, or isn't really the type its name says (e.g. an old .ppt renamed .pptx). Open it in Drive or PowerPoint and save it again as .pptx or PDF";
  if (/password|encrypt/i.test(m)) return "The file is password-protected. Save a copy without the password, then add that";
  if (/invalid pdf|invalidpdf|bad xref|xref|no pdf header|unexpected end/i.test(m)) return "The PDF is damaged. Download it from Drive, open it, and save or print it again as a new PDF";
  if (/not a valid|unsupported|can't be read/i.test(m)) return "This kind of file can't be read";
  if (/fetch failed|ECONN|ETIMEDOUT|socket|network/i.test(m)) return `A connection problem kept happening (${m.slice(0, 80)})`;
  return m;
}

// A file that couldn't be processed shows why: in the Library (Failed) and on the Drive page (Problem).
async function markFileFailed(supabase: DB, job: ProcessJob, reason: string) {
  const short = reason.slice(0, 300);
  // Only when there's no usable text yet: a file whose text was saved stays readable and searchable.
  if (job.file_id) await supabase.from("files").update({ status: "failed", error: short }).eq("id", job.file_id).in("status", ["uploaded", "no_text"]);
  if (job.drive_item_id) await supabase.from("drive_items").update({ status: "error", error: short, claimed_at: null }).eq("id", job.drive_item_id).neq("status", "imported");
}

async function loadFile(supabase: DB, id: string | null) {
  if (!id) return null;
  const { data } = await supabase.from("files").select("*").eq("id", id).maybeSingle();
  return data as LibraryFile | null;
}

// The file's bytes: from Lengible's storage, or straight from Google Drive for linked files.
async function fileBytes(supabase: DB, file: LibraryFile): Promise<Buffer> {
  if (isDrivePath(file.storage_path)) {
    const { data: item } = await supabase.from("drive_items").select("drive_id, resource_key, mime, size_bytes").eq("file_id", file.id).limit(1).maybeSingle();
    const driveId = item?.drive_id ?? file.storage_path.slice(6).split("/")[0];
    return download({ drive_id: driveId, resource_key: item?.resource_key ?? null, mime: item?.mime ?? file.mime_type ?? "", size_bytes: item?.size_bytes ?? null }, 300 * 1024 * 1024);
  }
  // A big upload stored in pieces: joined back exactly.
  const parts = parsePartsPath(file.storage_path);
  const objects = parts ? partPaths(parts.base, parts.count) : [file.storage_path];
  const pieces: Buffer[] = [];
  for (const o of objects) {
    const { data, error } = await supabase.storage.from("library").download(o);
    if (error || !data) throw new Error(`Couldn't open the stored file (${error?.message ?? "missing"}).`);
    pieces.push(Buffer.from(await data.arrayBuffer()));
  }
  return pieces.length === 1 ? pieces[0] : Buffer.concat(pieces);
}

// How long to wait after an AI limit: until the daily reset for the daily allowance, a minute and a half for
// the per-minute limit, two minutes when Google's servers are busy.
function limitWait(message: string, busy = false): Outcome {
  if (isDailyMessage(message)) {
    // The panel shows the exact date and time (in your own time zone) from not_before.
    return { wait: { ms: msUntilDailyReset(), note: "Google's daily AI allowance is used up. Resumes automatically when it resets, even with Lengible closed." } };
  }
  // No API credit: checking again every half hour is enough.
  if (/has no credit left/.test(message)) return { wait: { ms: 30 * 60_000, note: `${message.split(".")[0]}. Add credit; files carry on by themselves.` } };
  return { wait: { ms: busy ? 2 * 60_000 : 90_000, note: `${message.split(".")[0]}. Waiting, then carrying on.` } };
}

const aiWait = (e: unknown): Outcome | null =>
  e instanceof AIError && (e.kind === "rate_limit" || e.kind === "busy") ? limitWait(e.message, e.kind === "busy") : null;

async function advance(supabase: DB, job: ProcessJob, deadline: number): Promise<Outcome> {
  if (isOfficeTemp(job.name)) return { fail: unsupportedReason("", job.name)! };
  switch (job.step) {
    case "copy": {
      if (!job.drive_item_id) return { next: "text" };
      const twin = await twinInProgress(supabase, job.drive_item_id);
      if (twin)
        return {
          wait: { ms: 120_000, note: `Same file as “${twin}”, which is being processed now: its results are reused (no extra AI use).` },
          patch: { priority: isStarted(job.priority) ? job.priority - STARTED : job.priority },
        };
      const r = await importDriveItem(supabase, job.user_id, job.drive_item_id);
      if (r.status === "busy") {
        // Already brought in (e.g. by another device): carry on with that file.
        const { data: item } = await supabase.from("drive_items").select("file_id, status").eq("id", job.drive_item_id).maybeSingle();
        if (item?.file_id && item.status !== "new") return { next: "text", patch: { file_id: item.file_id } };
        return { wait: { ms: 60_000, note: "Being brought in on another device." } };
      }
      if (r.status === "error") {
        const permanent = /shared|limit|format|can't be read|blocked|not found/i.test(r.message);
        if (permanent) return { fail: r.message };
        throw new Error(r.message);
      }
      return { next: "text", patch: { file_id: r.fileId } };
    }

    case "text": {
      const file = await loadFile(supabase, job.file_id);
      if (!file) return { fail: "The file was deleted." };
      const buf = await fileBytes(supabase, file);
      const hash = createHash("sha256").update(buf).digest("hex");
      const stored = parsePartsPath(file.storage_path)?.base ?? file.storage_path;
      const name = /\.[a-z0-9]{2,5}$/i.test(stored) ? stored.split("/").pop()! : file.name;
      const resuming = (job.progress.textPage ?? 0) > 1;
      // From the start of this step: replace any earlier text (not when carrying on part-way through a long PDF).
      if (!resuming) {
        await Promise.all([
          supabase.from("chunks").delete().eq("file_id", file.id),
          supabase.from("file_concepts").delete().eq("file_id", file.id),
          supabase.from("topic_files").delete().eq("file_id", file.id),
          supabase.from("exam_questions").delete().eq("file_id", file.id),
        ]);
      }
      // The same file (identical bytes) already processed, e.g. a copy in another Drive folder: reuse its text,
      // reading, search index and profile instead of asking the AI again.
      if (!resuming) {
        if (await reuseTwin(supabase, file, hash, buf.length)) return { next: "embed" };
        // A copy being processed right now (copies are the same size, so they tend to start together): the one
        // that came first carries on, and this one gives up its place and reuses the results when they're ready.
        await supabase.from("files").update({ content_hash: hash }).eq("id", file.id);
        const { data: twins } = await supabase.from("files").select("id, name").eq("content_hash", hash).lt("id", file.id).limit(5);
        if (twins?.length) {
          const { data: busy } = await supabase.from("process_jobs").select("file_id").in("file_id", twins.map((t) => t.id)).eq("state", "queued").limit(1);
          const twin = twins.find((t) => t.id === busy?.[0]?.file_id);
          if (twin)
            return {
              wait: { ms: 120_000, note: `Same file as “${twin.name}”, which is being processed now: its results are reused (no extra AI use).` },
              patch: { priority: isStarted(job.priority) ? job.priority - STARTED : job.priority },
            };
        }
      }
      const save = async (pages: { page: number; text: string }[]) => {
        for (let i = 0; i < pages.length; i += 200) {
          const rows = pages.slice(i, i + 200).map((p) => ({ file_id: file.id, course_id: file.course_id, page: p.page, content: p.text.slice(0, 20000) }));
          const { error } = await supabase.from("chunks").insert(rows);
          if (error) throw new Error(`Couldn't save the text: ${error.message}`);
        }
      };
      const isPdf = file.mime_type === "application/pdf" || /\.pdf$/i.test(name);
      let x: Awaited<ReturnType<typeof extractAny>>;
      if (isPdf) {
        // Long PDFs: read until near the time limit, save, and carry on from the next page in the next run.
        const from = job.progress.textPage ?? 1;
        if (resuming) await supabase.from("chunks").delete().eq("file_id", file.id).gte("page", from);
        const r = await extractPdf(buf, { from, until: deadline - 70_000 });
        await save(r.pages);
        const pictures = [...(job.progress.pictures ?? []), ...r.pictureOnly];
        if (r.next) return { handOver: true, progress: { done: r.next - 1, total: r.pageCount, textPage: r.next, pictures } };
        const { count } = await supabase.from("chunks").select("id", { count: "exact", head: true }).eq("file_id", file.id);
        x = { pages: new Array(count ?? 0), pageCount: r.pageCount, pictureOnly: pictures, kind: "pdf" };
      } else {
        x = await extractAny(buf, name, file.mime_type ?? "");
        await save(x.pages);
      }
      const pictures = x.kind === "pdf" || x.kind === "image" ? x.pictureOnly.slice(0, 600) : [];
      await supabase
        .from("files")
        .update({ page_count: x.pageCount, size_bytes: buf.length, content_hash: hash, status: x.pages.length ? "extracted" : "no_text", analysis: null, profile: null, error: null })
        .eq("id", file.id);
      if (x.kind === "other") return { fail: "This kind of file can't be read." };
      return pictures.length ? { next: "pictures", progress: { done: 0, total: pictures.length, pictures } } : { next: "analyse" };
    }

    case "pictures": {
      const file = await loadFile(supabase, job.file_id);
      if (!file) return { fail: "The file was deleted." };
      const list = job.progress.pictures ?? [];
      let done = job.progress.done ?? 0;
      if (done >= list.length) return finishPictures(supabase, file);
      const buf = await fileBytes(supabase, file);
      const isImage = (file.mime_type ?? "").startsWith("image/");
      const { PDFDocument } = await import("pdf-lib");
      const source = isImage ? null : await PDFDocument.load(buf, { ignoreEncryption: true });
      // A few pages per AI call, up to 3 calls at the same time; the place is saved after each round.
      const readPages = async (pages: number[]) => {
        // Each call: these pages only (a small PDF cut from the file), or the picture itself.
        let data: { mimeType: string; data: string };
        if (isImage) data = { mimeType: file.mime_type!, data: buf.toString("base64") };
        else {
          const part = await PDFDocument.create();
          const copied = await part.copyPages(source!, pages.map((p) => p - 1).filter((p) => p >= 0 && p < source!.getPageCount()));
          copied.forEach((p) => part.addPage(p));
          data = { mimeType: "application/pdf", data: Buffer.from(await part.save()).toString("base64") };
        }
        const r = await generateJSON<{ pages: { page: number; text: string }[] }>(
          `These are pages ${pages.join(", ")} (in that order) of "${file.name}", a medical student's ${file.doc_type.replace("_", " ")}${isImage ? " (a photo or picture)" : ""}.\n` +
            "For each page, write down all readable text (keep headings, lists and table rows). Then, for any picture, diagram, chart, " +
            "micrograph, specimen or film on it, add a line starting with 'Image:' describing what it shows in exam-useful terms " +
            "(what it is, the labelled or key features, and what it illustrates). Don't guess beyond what is visible.",
          {
            type: "object",
            properties: { pages: { type: "array", items: { type: "object", properties: { page: { type: "integer" }, text: { type: "string" } }, required: ["page", "text"] } } },
            required: ["pages"],
          },
          { file: data, maxOutputTokens: 12_000, temperature: 0 },
        );
        const wanted = new Set(pages);
        const rows = (r.pages ?? [])
          .filter((p) => wanted.has(p.page) && p.text?.trim())
          .map((p) => ({ file_id: file.id, course_id: file.course_id, page: p.page, content: p.text.trim().slice(0, 20000) }));
        // Replacing these pages only, so reading them again (after a retry) never doubles them.
        await supabase.from("chunks").delete().eq("file_id", file.id).in("page", [...wanted]);
        if (rows.length) await supabase.from("chunks").insert(rows);
      };
      while (done < list.length && Date.now() < deadline - 40_000) {
        const groups: number[][] = [];
        for (let k = done; k < list.length && groups.length < (isImage ? 1 : 3); k += 6) groups.push(isImage ? [1] : list.slice(k, k + 6));
        try {
          await Promise.all(groups.map(readPages));
        } catch (e) {
          const w = aiWait(e);
          if (w) return { ...w, progress: { ...job.progress, done } };
          throw e;
        }
        done += groups.reduce((n, g) => n + g.length, 0);
        await supabase.from("process_jobs").update({ progress: { ...job.progress, done }, locked_until: iso(Date.now() + LOCK_MS), updated_at: new Date().toISOString() }).eq("id", job.id);
      }
      if (done < list.length) return { progress: { ...job.progress, done } };
      return finishPictures(supabase, file);
    }

    case "analyse": {
      const file = await loadFile(supabase, job.file_id);
      if (!file) return { fail: "The file was deleted." };
      // Several AI steps for big files; each one is saved before the next.
      while (Date.now() < deadline - 60_000) {
        const fresh = (await loadFile(supabase, file.id))!;
        const r = await analyzeStep(supabase, fresh, fresh.doc_type !== "textbook");
        if (r.status === "more") {
          await supabase.from("process_jobs").update({ progress: { done: r.cursor, total: r.total }, locked_until: iso(Date.now() + LOCK_MS), updated_at: new Date().toISOString() }).eq("id", job.id);
          continue;
        }
        if (r.status === "busy") return { wait: { ms: 60_000, note: "Being read on another device; carrying on after." } };
        if (r.status === "rate_limited") return limitWait(r.message ?? "AI limit reached");
        if (r.status === "error") throw new Error(r.message ?? "The AI step failed.");
        return { next: "profile", patch: { note: r.status === "review" ? "Ready for you to review (timetable or topic list)." : r.status === "skipped" ? r.message ?? null : null } };
      }
      return {};
    }

    case "profile": {
      const file = await loadFile(supabase, job.file_id);
      if (!file) return { fail: "The file was deleted." };
      try {
        await profileStep(supabase, file);
      } catch (e) {
        const w = aiWait(e);
        if (w) return w;
        throw e;
      }
      const updated = (await loadFile(supabase, file.id))!;
      // A past-question paper is readable and searchable now: it counts as in your Library while its questions
      // are copied into the question bank (which takes a while for compilations of hundreds of pages).
      if (needsQuestions(updated) && job.drive_item_id) await markDriveItemDone(supabase, job.drive_item_id);
      return { next: needsQuestions(updated) ? "questions" : "embed" };
    }

    case "questions": {
      const file = await loadFile(supabase, job.file_id);
      if (!file) return { fail: "The file was deleted." };
      try {
        const r = await questionsStep(supabase, file, job.progress.done ?? 0, deadline);
        if (!r.finished) return { progress: { done: r.cursor, total: r.total } };
      } catch (e) {
        const w = aiWait(e);
        if (w) return w;
        throw e;
      }
      return { next: "embed" };
    }

    case "embed": {
      const file = await loadFile(supabase, job.file_id);
      if (!file) return { fail: "The file was deleted." };
      try {
        const r = await embedStep(supabase, file, deadline);
        if (!r.finished) return { progress: { done: r.done, total: r.total } };
      } catch (e) {
        // The AI's limit for indexing was reached. The file is already fully usable (readable, searchable by
        // words, questions saved): it's finished now, and search-by-meaning indexing of its remaining pages
        // carries on in the background (indexMissing), without holding the file at 90%.
        if (e instanceof AIError && (e.kind === "rate_limit" || e.kind === "busy")) return { finished: true };
        throw e;
      }
      return { finished: true };
    }

    default:
      return { finished: true };
  }
}

// Drive gives each file's fingerprint (md5) before anything is downloaded, so identical copies in different folders
// are known up front. The copy listed first is processed; the others wait for it (without holding a place), then
// reuse its results.
async function twinInProgress(supabase: DB, driveItemId: string) {
  const { data: me } = await supabase.from("drive_items").select("md5").eq("id", driveItemId).maybeSingle();
  if (!me?.md5) return null;
  const { data: same } = await supabase.from("drive_items").select("id").eq("md5", me.md5).lt("id", driveItemId).limit(20);
  if (!same?.length) return null;
  const { data: busy } = await supabase
    .from("process_jobs")
    .select("name")
    .in("drive_item_id", same.map((x) => x.id))
    .eq("state", "queued")
    .in("step", ["copy", "text", "pictures", "analyse", "profile"])
    .limit(1);
  return busy?.[0]?.name ?? null;
}

async function reuseTwin(supabase: DB, file: LibraryFile, hash: string, size: number) {
  const { data: twins } = await supabase.from("files").select("*").eq("content_hash", hash).neq("id", file.id).not("profile", "is", null).limit(5);
  const twin = ((twins ?? []) as LibraryFile[]).find((t) => {
    const a = t.analysis as Analysis | null;
    return a?.finished && a.kind === "concepts" && a.v === ANALYSIS_VERSION;
  });
  if (!twin) return false;
  // Its pages (with picture descriptions and search index), copied over.
  for (let from = 0; ; from += 500) {
    const { data: pages } = await supabase.from("chunks").select("page, content, embedding").eq("file_id", twin.id).order("page").range(from, from + 499);
    if (!pages?.length) break;
    const { error } = await supabase.from("chunks").insert(pages.map((p) => ({ file_id: file.id, course_id: file.course_id, page: p.page, content: p.content, embedding: p.embedding ?? null })));
    if (error) throw new Error(`Couldn't save the text: ${error.message}`);
    if (pages.length < 500) break;
  }
  const analysis = { ...(twin.analysis as Analysis), lockUntil: null };
  const { data: courses } = await supabase.from("courses").select("id, name, is_group").eq("archived", false);
  const course_id = file.course_id ?? twin.course_id;
  const me = { ...file, course_id };
  await saveConcepts(supabase, file.id, analysis.concepts ?? []);
  const saved = await saveSections(supabase, me, analysis.sections ?? [], courses ?? []);
  const profile = twin.profile ? { ...twin.profile, edited: undefined, duplicate_of: twin.id } : null;
  await supabase
    .from("files")
    .update({
      page_count: twin.page_count,
      size_bytes: size,
      content_hash: hash,
      status: "analysed",
      analysis,
      profile,
      course_id,
      doc_type: file.doc_type === "other" ? twin.doc_type : file.doc_type,
      ...(!file.topic_id && saved.onlyTopic ? { topic_id: saved.onlyTopic } : {}),
      error: null,
    })
    .eq("id", file.id);
  return true;
}

async function finishPictures(supabase: DB, file: LibraryFile): Promise<Outcome> {
  const { count } = await supabase.from("chunks").select("id", { count: "exact", head: true }).eq("file_id", file.id);
  await supabase.from("files").update({ status: count ? "extracted" : "no_text" }).eq("id", file.id);
  return count ? { next: "analyse" } : { fail: "No text could be read from this file, even with the AI." };
}

// Files already in your Library that were part-processed (e.g. before background processing existed, or a
// step added since): queued so they get finished. Files you only stored are left alone.
export async function backfill(supabase: DB, limit = 40) {
  const { data: open } = await supabase.from("process_jobs").select("file_id").in("state", ["queued", "paused", "stopped", "failed"]).not("file_id", "is", null);
  const busy = new Set((open ?? []).map((j) => j.file_id));
  const { data: files } = await supabase.from("files").select("*").in("status", READ).order("created_at", { ascending: false }).limit(400);
  const todo: { fileId: string; name: string }[] = [];
  for (const f of (files ?? []) as LibraryFile[]) {
    if (busy.has(f.id) || todo.length >= limit) continue;
    if ((await firstStepFor(supabase, f)) !== "done") todo.push({ fileId: f.id, name: f.name });
  }
  return todo.length ? enqueue(supabase, todo) : { added: 0, skipped: 0 };
}
