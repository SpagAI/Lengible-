"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { extractText, fileKind, renderPdfPages } from "@/lib/extract/client";
import { finishExtraction, markFailed } from "@/app/(app)/library/actions";
import { postJSON } from "@/lib/fetch-json";

export type Stage = "waiting" | "uploading" | "reading" | "analysing" | "done" | "review" | "no_text" | "paused" | "error";
// step/done/total give the detailed timeline: which part of the work is running and how far it is.
export type Step = "upload" | "text" | "pictures" | "ai" | "save";
export type Progress = { stage: Stage; message?: string; step?: Step; done?: number; total?: number };

export type AnalyzeResult = { status: "done" | "more" | "review" | "rate_limited" | "skipped" | "error" | "busy"; message?: string; cursor?: number; total?: number };

// At most this many picture pages are read per file in one go (about 150 AI calls).
export const MAX_PICTURE_PAGES = 600;
const PICTURES_PER_CALL = 4;

// Draws picture-only pages in the browser and has the AI read them, a few pages per call.
// Stops early (keeping what's done) if the free AI allowance runs out.
export async function readPicturePages(
  fileId: string,
  data: ArrayBuffer,
  pages: number[],
  onProgress: (done: number, total: number) => void,
): Promise<{ status: "done" | "rate_limited" | "error"; done: number; message?: string }> {
  const todo = pages.slice(0, MAX_PICTURE_PAGES);
  let group: { page: number; data: string }[] = [];
  let done = 0;
  const send = async () => {
    const r = await postJSON<{ status: string; message?: string }>(`/api/files/${fileId}/read-pages`, { pages: group });
    if (r.status !== "ok") return r;
    done += group.length;
    group = [];
    onProgress(done, todo.length);
    return null;
  };
  for await (const img of renderPdfPages(data, todo)) {
    group.push(img);
    if (group.length >= PICTURES_PER_CALL) {
      const problem = await send();
      if (problem) return { status: problem.status === "rate_limited" ? "rate_limited" : "error", done, message: problem.message };
    }
  }
  if (group.length) {
    const problem = await send();
    if (problem) return { status: problem.status === "rate_limited" ? "rate_limited" : "error", done, message: problem.message };
  }
  return { status: "done", done };
}

// Asks the server to run the AI pass for a file, one step at a time (big files take several steps).
export async function analyze(fileId: string, onProgress: (p: Progress) => void, full = false): Promise<AnalyzeResult> {
  for (let step = 0; step < 300; step++) {
    const body = await postJSON<AnalyzeResult>(`/api/files/${fileId}/analyze${full ? "?full=1" : ""}`);
    if (body.status !== "more") return body;
    onProgress({ stage: "analysing", step: "ai", message: body.message, done: body.cursor, total: body.total });
  }
  return { status: "error", message: "Stopped after too many steps." };
}

// Upload → read text in the browser → save the text → AI pass.
export async function runPipeline(
  supabase: SupabaseClient<Database>,
  file: File,
  record: { id: string; path: string },
  courseId: string | null,
  onProgress: (p: Progress) => void,
) {
  try {
    onProgress({ stage: "uploading", step: "upload" });
    const { error: upErr } = await supabase.storage.from("library").upload(record.path, file, { contentType: file.type || undefined, upsert: true });
    if (upErr) throw new Error(upErr.message.includes("exceeded") ? "File is bigger than the 50 MB limit." : `Upload failed: ${upErr.message}`);

    onProgress({ stage: "reading", step: "text" });
    const { pages, pageCount, hasText: textLayer, pictureOnly } = await extractText(file, file.name);
    for (let i = 0; i < pages.length; i += 50) {
      const rows = pages.slice(i, i + 50).map((p) => ({ file_id: record.id, course_id: courseId, page: p.page, content: p.text.slice(0, 20000) }));
      const { error } = await supabase.from("chunks").insert(rows);
      if (error) throw new Error(`Couldn't save the text: ${error.message}`);
      onProgress({ stage: "reading", step: "text", message: `${Math.min(i + 50, pages.length)} of ${pages.length} pages saved`, done: Math.min(i + 50, pages.length), total: pages.length });
    }
    // Slides that are mostly a picture (and scanned PDFs): the AI reads the page images.
    let hasText = textLayer;
    if (fileKind(file.name, file.type) === "pdf" && pictureOnly?.length) {
      const pictureTotal = Math.min(pictureOnly.length, MAX_PICTURE_PAGES);
      onProgress({ stage: "reading", step: "pictures", message: `Reading ${pictureTotal} picture pages with AI…`, done: 0, total: pictureTotal });
      const r = await readPicturePages(record.id, await file.arrayBuffer(), pictureOnly, (done, total) =>
        onProgress({ stage: "reading", step: "pictures", message: `Read ${done} of ${total} picture pages`, done, total }),
      );
      if (r.done > 0) hasText = true;
      if (r.status !== "done") {
        onProgress({ stage: "reading", step: "pictures", message: `${r.message ?? "Paused."} Open the file later and tap “Read picture pages” to finish them.`, done: r.done, total: pictureTotal });
      }
    }
    await finishExtraction(record.id, pageCount, hasText);
    if (!hasText) {
      onProgress({ stage: "no_text", message: "No text layer (photo or scan). Open it and tap “Read with AI”." });
      return;
    }

    onProgress({ stage: "analysing", step: "ai" });
    const result = await analyze(record.id, onProgress);
    if (result.status === "review") onProgress({ stage: "review", message: result.message });
    else if (result.status === "rate_limited") onProgress({ stage: "paused", message: result.message });
    else if (result.status === "error") onProgress({ stage: "error", message: result.message });
    else onProgress({ stage: "done", message: result.status === "skipped" ? result.message : undefined });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Something went wrong.";
    await markFailed(record.id, message).catch(() => {});
    onProgress({ stage: "error", message });
  }
}
