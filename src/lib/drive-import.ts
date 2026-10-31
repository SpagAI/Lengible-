import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DriveItem } from "@/lib/supabase/types";
import { DriveError, download, drivePath, isLinkOnly, libraryMime, libraryName } from "@/lib/drive";
import { storageObjects, storagePath } from "@/lib/library";

type DB = SupabaseClient<Database>;

// Copies one Drive file into your Library (server to server, so your API key stays private), or links it
// (PowerPoint/Word and very big files). A file that changed in Drive replaces its earlier copy, keeping its
// place and links. Used by the browser and by the background worker.
export async function importDriveItem(supabase: DB, userId: string, id: string) {
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
  if (!item) return { status: "busy", message: "Already being brought in, or nothing to do." } as const;

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

    const name = libraryName(item.name, item.mime);
    const mime = libraryMime(item.mime);
    const { data: old } = item.file_id ? await supabase.from("files").select("id, storage_path, version, status").eq("id", item.file_id).maybeSingle() : { data: null };
    // A newer version of a file you had already processed is processed again; one you hadn't stays waiting.
    const wasProcessed = !!old && old.status !== "uploaded";
    const fileId = old?.id ?? crypto.randomUUID();
    // PowerPoint/Word and very big files stay in Drive (linked, nothing copied); the rest is copied into storage.
    const linkOnly = isLinkOnly(item);
    let path: string;
    let size = item.size_bytes ?? 0;
    if (linkOnly) path = drivePath(item.drive_id, name);
    else {
      const buf = await download(item);
      size = buf.length;
      path = storagePath(userId, fileId, name, (old?.version ?? 0) + 1);
      const { error: upErr } = await supabase.storage.from("library").upload(path, buf, { contentType: mime, upsert: true });
      if (upErr) {
        const full = /quota|exceed|too large|payload/i.test(upErr.message);
        throw new DriveError(
          full
            ? `Your Supabase storage is full or the file is too large (${upErr.message}). Free plan: 1 GB in total. Delete files you don't need in Library, or upgrade the Supabase plan.`
            : `Couldn't save the file: ${upErr.message}`,
          "other",
        );
      }
    }

    const fields = {
      name: name.replace(/\.[^.]+$/, "") || name,
      course_id: item.course_id,
      folder_id: folderId,
      doc_type: item.doc_type as never,
      storage_path: path,
      mime_type: mime,
      size_bytes: size,
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
      const before = storageObjects(old.storage_path).filter((o) => o !== path);
      if (before.length) await supabase.storage.from("library").remove(before);
    } else {
      const { error } = await supabase.from("files").insert({ id: fileId, ...fields });
      if (error) throw new DriveError(`Couldn't save the file record: ${error.message}`, "other");
    }
    await supabase.from("drive_items").update({ file_id: fileId }).eq("id", id);
    return { status: "ok", fileId, path, name, mime, courseId: item.course_id, replaced: !!old, wasProcessed, linkOnly } as const;
  } catch (e) {
    const message = e instanceof DriveError ? e.message : `Couldn't bring this file in${e instanceof Error && e.message ? `: ${e.message}` : "."}`;
    console.error("drive import failed", id, e);
    await supabase.from("drive_items").update({ status: "error", error: message, claimed_at: null }).eq("id", id);
    return { status: "error", message, setup: e instanceof DriveError && e.kind === "setup" } as const;
  }
}

// Marks a Drive file as brought in (after it has been processed), remembering which version it was.
export async function markDriveItemDone(supabase: DB, id: string) {
  const { data: item } = await supabase.from("drive_items").select("modified_time").eq("id", id).maybeSingle();
  if (!item) return false;
  await supabase.from("drive_items").update({ status: "imported", imported_modified: item.modified_time, error: null, claimed_at: null }).eq("id", id);
  return true;
}
