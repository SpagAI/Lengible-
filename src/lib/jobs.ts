import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, FileStatus, LibraryFile } from "@/lib/supabase/types";
import { AIError, generateJSON } from "@/lib/ai";
import { analyzeStep, type Analysis, ANALYSIS_VERSION } from "@/lib/analysis/run";
import { download, isDrivePath } from "@/lib/drive";
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
  const { count } = await supabase.from("chunks").select("id", { count: "exact", head: true }).eq("file_id", file.id).is("embedding", null);
  if (count) return "embed";
  return "done";
}

async function hasQuestions(supabase: DB, fileId: string) {
  const { count } = await supabase.from("exam_questions").select("id", { count: "exact", head: true }).eq("file_id", fileId);
  return (count ?? 0) > 0;
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
    if (!it.driveItemId || fileId) {
      const { data } = fileId ? await supabase.from("files").select("*").eq("id", fileId).maybeSingle() : { data: null };
      step = it.again ? "text" : await firstStepFor(supabase, data as LibraryFile | null);
      if (!data) step = "copy";
      if (step === "done") {
        skipped++;
        continue;
      }
    }
    if (it.driveItemId && !it.fileId) {
      // A Drive file brought in before keeps its place; a newer version is copied again.
      const { data: item } = await supabase.from("drive_items").select("status, file_id").eq("id", it.driveItemId).maybeSingle();
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
      await supabase
        .from("process_jobs")
        .update({ state: "queued", attempts: 0, error: null, note: null, not_before: null, updated_at: new Date().toISOString(), ...(it.again ? { step, progress: {} } : {}) })
        .eq("id", existing.id);
      added++;
      continue;
    }
    const { error } = await supabase.from("process_jobs").insert({
      file_id: fileId,
      drive_item_id: it.driveItemId ?? null,
      name: it.name,
      step,
      priority: it.priority ?? 0,
    });
    if (!error) added++;
  }
  return { added, skipped };
}

async function findOpenJob(supabase: DB, fileId: string | null, driveItemId: string | null) {
  if (!fileId && !driveItemId) return null;
  let q = supabase.from("process_jobs").select("id").in("state", ["queued", "paused", "stopped"]);
  q = fileId ? q.eq("file_id", fileId) : q.eq("drive_item_id", driveItemId!);
  const { data } = await q.limit(1);
  return data?.[0] ?? null;
}

// ——— Working through the queue ———

const LOCK_MS = 5 * 60_000;
const MAX_ATTEMPTS = 6;
const iso = (ms: number) => new Date(ms).toISOString();

// Works on a user's queue until the deadline: up to `parallel` files at once.
export async function workQueue(supabase: DB, userId: string, deadline: number, parallel = 3) {
  const done: string[] = [];
  const running = new Set<Promise<void>>();
  const claim = async () => {
    const now = new Date().toISOString();
    const { data: ready } = await supabase
      .from("process_jobs")
      .select("*")
      .eq("user_id", userId)
      .eq("state", "queued")
      .or(`not_before.is.null,not_before.lt.${now}`)
      .or(`locked_until.is.null,locked_until.lt.${now}`)
      .order("priority", { ascending: false })
      .order("created_at")
      .limit(parallel * 2);
    for (const j of ready ?? []) {
      // One conditional update: if another worker took it first, nothing changes.
      const { data: got } = await supabase
        .from("process_jobs")
        .update({ locked_until: iso(Date.now() + LOCK_MS) })
        .eq("id", j.id)
        .eq("state", "queued")
        .or(`locked_until.is.null,locked_until.lt.${now}`)
        .select("*");
      if (got?.[0]) return got[0] as ProcessJob;
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
    const message = e instanceof Error ? e.message : "Something went wrong.";
    await supabase
      .from("process_jobs")
      .update(
        attempts >= MAX_ATTEMPTS
          ? { state: "failed", error: message, attempts, locked_until: null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : {
              attempts,
              note: `Problem (${message.slice(0, 120)}). Trying again shortly from the same step.`,
              not_before: iso(Date.now() + 60_000 * 2 ** (attempts - 1)),
              locked_until: null,
              updated_at: new Date().toISOString(),
            },
      )
      .eq("id", job.id);
    return;
  }
  // Out of time, or paused/stopped: let it go, so it can be picked up again straight away (e.g. after Resume).
  await supabase.from("process_jobs").update({ locked_until: null }).eq("id", job.id);
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

const aiWait = (e: unknown): Outcome | null =>
  e instanceof AIError && (e.kind === "rate_limit" || e.kind === "busy")
    ? { wait: { ms: e.kind === "rate_limit" ? 5 * 60_000 : 2 * 60_000, note: `${e.message.split(".")[0]}. Waiting, then carrying on.` } }
    : null;

async function advance(supabase: DB, job: ProcessJob, deadline: number): Promise<Outcome> {
  switch (job.step) {
    case "copy": {
      if (!job.drive_item_id) return { next: "text" };
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
      // A few pages per AI call; the place is saved after each call.
      while (done < list.length && Date.now() < deadline - 40_000) {
        const pages = isImage ? [1] : list.slice(done, done + 6);
        // Each call: these pages only (a small PDF cut from the file), or the picture itself.
        let data: { mimeType: string; data: string };
        if (isImage) data = { mimeType: file.mime_type!, data: buf.toString("base64") };
        else {
          const part = await PDFDocument.create();
          const copied = await part.copyPages(source!, pages.map((p) => p - 1).filter((p) => p >= 0 && p < source!.getPageCount()));
          copied.forEach((p) => part.addPage(p));
          data = { mimeType: "application/pdf", data: Buffer.from(await part.save()).toString("base64") };
        }
        try {
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
          await supabase.from("chunks").delete().eq("file_id", file.id).in("page", [...wanted]);
          if (rows.length) await supabase.from("chunks").insert(rows);
        } catch (e) {
          const w = aiWait(e);
          if (w) return { ...w, progress: { ...job.progress, done } };
          throw e;
        }
        done += pages.length;
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
        if (r.status === "rate_limited") return { wait: { ms: 5 * 60_000, note: `${(r.message ?? "AI limit reached").split(".")[0]}. Waiting, then carrying on.` } };
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
        // Google's limit for indexing is mostly per minute: wait about a minute, not five.
        if (e instanceof AIError && (e.kind === "rate_limit" || e.kind === "busy")) {
          return {
            wait: {
              ms: 75_000,
              note: "Google's per-minute limit for search indexing was reached. The file is already readable and searchable by words; indexing for search by meaning carries on in about a minute.",
            },
          };
        }
        throw e;
      }
      return { finished: true };
    }

    default:
      return { finished: true };
  }
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
