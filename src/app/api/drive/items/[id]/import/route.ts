import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DriveError, download, libraryMime, libraryName } from "@/lib/drive";
import { storagePath } from "@/lib/library";
import type { DriveItem } from "@/lib/supabase/types";

// Downloading big files from Google can take a while.
export const maxDuration = 300;

// Copies one Drive file into your Library storage (server to server, so your API key stays private).
// A file that changed in Drive replaces its earlier copy, keeping its place and links. The browser
// then reads the text the same way as an upload.
export async function POST(_req: Request, ctx: RouteContext<"/api/drive/items/[id]/import">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ status: "error", message: "Please sign in again." }, { status: 401 });

  // Claim it, so another device doesn't bring in the same file at the same moment.
  const stale = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: claimed } = await supabase
    .from("drive_items")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("include", true)
    .in("status", ["new", "changed", "error"])
    .or(`claimed_at.is.null,claimed_at.lt.${stale}`)
    .select("*");
  const item = claimed?.[0] as DriveItem | undefined;
  if (!item) return NextResponse.json({ status: "busy", message: "Already being brought in, or nothing to do." });

  try {
    // Library folders mirror the Drive folders.
    let folderId: string | null = null;
    for (const name of item.path.split("/").filter(Boolean)) {
      let q = supabase.from("folders").select("id").eq("name", name);
      q = item.course_id ? q.eq("course_id", item.course_id) : q.is("course_id", null);
      q = folderId ? q.eq("parent_id", folderId) : q.is("parent_id", null);
      const { data: found } = await q.limit(1);
      if (found?.[0]) folderId = found[0].id;
      else {
        const made: { data: { id: string } | null } = await supabase.from("folders").insert({ name, course_id: item.course_id, parent_id: folderId }).select("id").single();
        folderId = made.data?.id ?? null;
      }
    }

    const buf = await download(item);
    const name = libraryName(item.name, item.mime);
    const mime = libraryMime(item.mime);
    const { data: old } = item.file_id ? await supabase.from("files").select("id, storage_path, version").eq("id", item.file_id).maybeSingle() : { data: null };
    const fileId = old?.id ?? crypto.randomUUID();
    const path = storagePath(auth.user.id, fileId, name, (old?.version ?? 0) + 1);
    const { error: upErr } = await supabase.storage.from("library").upload(path, buf, { contentType: mime, upsert: true });
    if (upErr) throw new DriveError(`Couldn't save the file: ${upErr.message}`, "other");

    const fields = {
      name: name.replace(/\.[^.]+$/, "") || name,
      course_id: item.course_id,
      folder_id: folderId,
      doc_type: item.doc_type as never,
      storage_path: path,
      mime_type: mime,
      size_bytes: buf.length,
      status: "uploaded" as const,
      analysis: null,
      error: null,
    };
    if (old) {
      // A newer version: clear the old text and links; it is read again from scratch.
      await Promise.all([
        supabase.from("chunks").delete().eq("file_id", old.id),
        supabase.from("file_concepts").delete().eq("file_id", old.id),
        supabase.from("topic_files").delete().eq("file_id", old.id),
      ]);
      await supabase.from("files").update({ ...fields, version: old.version + 1, updated_at: new Date().toISOString() }).eq("id", old.id);
      if (old.storage_path !== path) await supabase.storage.from("library").remove([old.storage_path]);
    } else {
      const { error } = await supabase.from("files").insert({ id: fileId, ...fields });
      if (error) throw new DriveError(`Couldn't save the file record: ${error.message}`, "other");
    }
    await supabase.from("drive_items").update({ file_id: fileId }).eq("id", id);
    const { data: signed } = await supabase.storage.from("library").createSignedUrl(path, 3600);
    return NextResponse.json({ status: "ok", fileId, path, name, mime, courseId: item.course_id, replaced: !!old, url: signed?.signedUrl });
  } catch (e) {
    const message = e instanceof DriveError ? e.message : "Couldn't bring this file in.";
    await supabase.from("drive_items").update({ status: "error", error: message, claimed_at: null }).eq("id", id);
    return NextResponse.json({ status: "error", message, setup: e instanceof DriveError && e.kind === "setup" });
  }
}
