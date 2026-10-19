"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { extractText } from "@/lib/extract/client";
import { finishExtraction, markFailed } from "@/app/(app)/library/actions";
import { postJSON } from "@/lib/fetch-json";

export type Stage = "waiting" | "uploading" | "reading" | "analysing" | "done" | "review" | "no_text" | "paused" | "error";
export type Progress = { stage: Stage; message?: string };

export type AnalyzeResult = { status: "done" | "more" | "review" | "rate_limited" | "skipped" | "error"; message?: string };

// Asks the server to run the AI pass for a file, one step at a time (big files take several steps).
export async function analyze(fileId: string, onProgress: (p: Progress) => void): Promise<AnalyzeResult> {
  for (let step = 0; step < 60; step++) {
    const body = await postJSON<AnalyzeResult>(`/api/files/${fileId}/analyze`);
    if (body.status !== "more") return body;
    onProgress({ stage: "analysing", message: body.message });
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
    onProgress({ stage: "uploading" });
    const { error: upErr } = await supabase.storage.from("library").upload(record.path, file, { contentType: file.type || undefined, upsert: true });
    if (upErr) throw new Error(upErr.message.includes("exceeded") ? "File is bigger than the 50 MB limit." : `Upload failed: ${upErr.message}`);

    onProgress({ stage: "reading" });
    const { pages, pageCount, hasText } = await extractText(file, file.name);
    for (let i = 0; i < pages.length; i += 50) {
      const rows = pages.slice(i, i + 50).map((p) => ({ file_id: record.id, course_id: courseId, page: p.page, content: p.text.slice(0, 20000) }));
      const { error } = await supabase.from("chunks").insert(rows);
      if (error) throw new Error(`Couldn't save the text: ${error.message}`);
      onProgress({ stage: "reading", message: `${Math.min(i + 50, pages.length)} of ${pages.length} pages saved` });
    }
    await finishExtraction(record.id, pageCount, hasText);
    if (!hasText) {
      onProgress({ stage: "no_text", message: "No text layer (photo or scan). Open it and tap “Read with AI”." });
      return;
    }

    onProgress({ stage: "analysing" });
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
