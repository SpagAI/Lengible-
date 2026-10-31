import { NextResponse, type NextRequest } from "next/server";
import { loadOwnFile } from "@/lib/api";
import { DriveError, download, isDrivePath } from "@/lib/drive";
import { extractAny } from "@/lib/extract/server";

// Downloading a big deck from Google and unzipping it can take a while.
export const maxDuration = 300;
// Linked files are read on the server, so there's no storage limit; this just keeps memory sensible.
const READ_LIMIT = 300 * 1024 * 1024;

// Reads the text of a file linked from Google Drive (PowerPoint/Word; nothing is copied into storage)
// and saves it page by page, the way the browser does for uploads. The AI pass runs after this.
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/files/[id]/read-drive">) {
  const { id } = await ctx.params;
  const loaded = await loadOwnFile(id);
  if ("error" in loaded) return loaded.error;
  const { supabase, file } = loaded;
  if (!isDrivePath(file.storage_path)) return NextResponse.json({ status: "error", message: "This file isn't linked from Google Drive." });
  const { data: item } = await supabase.from("drive_items").select("drive_id, resource_key, mime, size_bytes, name").eq("file_id", id).limit(1).maybeSingle();
  if (!item) return NextResponse.json({ status: "error", message: "The Drive link for this file was removed. Add the link again to read it." });

  // From the start: clear any earlier reading.
  await Promise.all([
    supabase.from("chunks").delete().eq("file_id", id),
    supabase.from("file_concepts").delete().eq("file_id", id),
    supabase.from("topic_files").delete().eq("file_id", id),
  ]);
  await supabase.from("files").update({ status: "uploaded", analysis: null, error: null }).eq("id", id);
  try {
    const buf = await download(item, READ_LIMIT);
    const { pages, pageCount, kind } = await extractAny(buf, item.name, item.mime);
    if (kind === "other") throw new Error("This kind of file can't be read.");
    for (let i = 0; i < pages.length; i += 100) {
      const rows = pages.slice(i, i + 100).map((p) => ({ file_id: id, course_id: file.course_id, page: p.page, content: p.text.slice(0, 20000) }));
      const { error } = await supabase.from("chunks").insert(rows);
      if (error) throw new Error(`Couldn't save the text: ${error.message}`);
    }
    const hasText = pages.length > 0;
    await supabase.from("files").update({ page_count: pageCount, size_bytes: buf.length, status: hasText ? "extracted" : "no_text", error: null }).eq("id", id);
    return NextResponse.json({ status: "ok", pages: pages.length, pageCount, hasText });
  } catch (e) {
    const message =
      e instanceof DriveError
        ? e.message
        : /zip|central directory|end of data/i.test(e instanceof Error ? e.message : "")
          ? "This doesn't look like a valid PowerPoint/Word file (it may be damaged, or an old .ppt renamed). Open it in Drive and save it again as .pptx or PDF."
          : `Couldn't read this file${e instanceof Error && e.message ? `: ${e.message}` : "."}`;
    await supabase.from("files").update({ status: "failed", error: message.slice(0, 300) }).eq("id", id);
    return NextResponse.json({ status: "error", message });
  }
}
