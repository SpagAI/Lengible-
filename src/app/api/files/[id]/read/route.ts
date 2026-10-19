import { NextResponse, type NextRequest } from "next/server";
import { loadOwnFile } from "@/lib/api";
import { AIError, generateJSON } from "@/lib/ai";

// AI calls can be slow on the free tier; Vercel's free plan allows up to 300 seconds.
export const maxDuration = 300;

// Gemini accepts files up to about 20 MB sent this way.
const MAX_BYTES = 15 * 1024 * 1024;

// Reads a photo or scanned PDF with the AI and saves its text like any other file.
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/files/[id]/read">) {
  const { id } = await ctx.params;
  const loaded = await loadOwnFile(id);
  if ("error" in loaded) return loaded.error;
  const { supabase, file } = loaded;

  const { data: blob, error } = await supabase.storage.from("library").download(file.storage_path);
  if (error || !blob) return NextResponse.json({ status: "error", message: "Couldn't fetch the file from storage." });
  if (blob.size > MAX_BYTES) {
    return NextResponse.json({ status: "error", message: "Too big for AI reading (over 15 MB). Split or compress it first." });
  }
  const mimeType = file.mime_type || (file.storage_path.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");

  try {
    const r = await generateJSON<{ pages: { page: number; text: string }[] }>(
      "Transcribe all readable text in this file, page by page (a photo is page 1). Keep headings and lists. " +
        "For a picture of a specimen or slide with no text, briefly describe what is visible instead, starting with 'Image:'.",
      {
        type: "object",
        properties: { pages: { type: "array", items: { type: "object", properties: { page: { type: "integer" }, text: { type: "string" } }, required: ["page", "text"] } } },
        required: ["pages"],
      },
      { file: { mimeType, data: Buffer.from(await blob.arrayBuffer()).toString("base64") }, maxOutputTokens: 60_000, temperature: 0 },
    );
    const pages = (r.pages ?? []).filter((p) => p.text?.trim());
    await supabase.from("chunks").delete().eq("file_id", id);
    if (pages.length) {
      await supabase
        .from("chunks")
        .insert(pages.map((p) => ({ file_id: id, course_id: file.course_id, page: p.page, content: p.text.slice(0, 20000) })));
    }
    await supabase.from("files").update({ status: "extracted", analysis: null, page_count: file.page_count ?? pages.length }).eq("id", id);
    return NextResponse.json({ status: "ok" });
  } catch (e) {
    if (e instanceof AIError) return NextResponse.json({ status: e.kind === "rate_limit" ? "rate_limited" : "error", message: e.message });
    return NextResponse.json({ status: "error", message: "Couldn't read this file with AI." });
  }
}
