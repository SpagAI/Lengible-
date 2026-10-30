import { NextResponse, type NextRequest } from "next/server";
import { loadOwnFile } from "@/lib/api";
import { isDrivePath } from "@/lib/drive";

// Processing a stored file (brought in from Drive, or an upload that stopped part-way): clears any
// half-finished reading and returns a link so this device can read the file from the start.
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/files/[id]/prepare">) {
  const { id } = await ctx.params;
  const loaded = await loadOwnFile(id);
  if ("error" in loaded) return loaded.error;
  const { supabase, file } = loaded;
  // Linked from Drive: the server reads it (see read-drive), nothing to download here.
  if (isDrivePath(file.storage_path)) return NextResponse.json({ status: "ok", linkOnly: true, name: file.name, courseId: file.course_id });
  await Promise.all([
    supabase.from("chunks").delete().eq("file_id", id),
    supabase.from("file_concepts").delete().eq("file_id", id),
    supabase.from("topic_files").delete().eq("file_id", id),
  ]);
  await supabase.from("files").update({ status: "uploaded", analysis: null, error: null }).eq("id", id);
  const { data: signed } = await supabase.storage.from("library").createSignedUrl(file.storage_path, 3600);
  if (!signed?.signedUrl) return NextResponse.json({ status: "error", message: "Couldn't open the stored file." });
  const ext = file.storage_path.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
  return NextResponse.json({
    status: "ok",
    url: signed.signedUrl,
    name: file.name.toLowerCase().endsWith(ext.toLowerCase()) ? file.name : `${file.name}${ext}`,
    mime: file.mime_type ?? "",
    path: file.storage_path,
    courseId: file.course_id,
  });
}
