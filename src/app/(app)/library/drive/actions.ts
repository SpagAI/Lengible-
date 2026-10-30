"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { DriveError, getMeta, parseDriveLink, syncItems } from "@/lib/drive";
import { isMissingTable } from "@/lib/drugs";
import type { DriveSource } from "@/lib/supabase/types";

const SETUP = "The Drive tables aren't in your Supabase yet. Run supabase/migrations/0007_drive_links.sql in the Supabase SQL Editor, then try again.";
const problem = (e: unknown) => (e instanceof DriveError ? e.message : isMissingTable({ message: (e as Error)?.message }) ? SETUP : (e as Error)?.message || "Something went wrong.");

// Adds a shared Drive link and lists everything in it.
export async function addDriveLink(_prev: { error?: string } | undefined, fd: FormData) {
  const { supabase } = await requireUser();
  const link = String(fd.get("link") ?? "").trim();
  const parsed = parseDriveLink(link);
  if (!parsed) return { error: "That doesn't look like a Google Drive link. Copy the link from Drive's Share → Copy link." };
  let sourceId: string;
  try {
    const meta = await getMeta(parsed.id, parsed.resourceKey);
    const isFolder = meta.mimeType === "application/vnd.google-apps.folder";
    const { data: existing, error: readError } = await supabase.from("drive_sources").select("id").eq("drive_id", parsed.id).maybeSingle();
    if (readError) throw readError;
    if (existing) sourceId = existing.id;
    else {
      const { data, error } = await supabase
        .from("drive_sources")
        .insert({ link, drive_id: parsed.id, resource_key: parsed.resourceKey ?? meta.resourceKey ?? null, name: meta.name, is_folder: isFolder })
        .select("*")
        .single();
      if (error) throw error;
      sourceId = data.id;
    }
    const { data: source } = await supabase.from("drive_sources").select("*").eq("id", sourceId).single();
    await syncItems(supabase, source as DriveSource);
  } catch (e) {
    return { error: problem(e) };
  }
  revalidatePath("/library", "layout");
  redirect(`/library/drive/${sourceId}`);
}

export async function checkDriveLink(id: string) {
  const { supabase } = await requireUser();
  const { data: source } = await supabase.from("drive_sources").select("*").eq("id", id).maybeSingle();
  if (!source) return { error: "Link not found." };
  try {
    const r = await syncItems(supabase, source as DriveSource);
    revalidatePath(`/library/drive/${id}`);
    return {
      message:
        r.added || r.changed || r.removed
          ? [r.added && `${r.added} new`, r.changed && `${r.changed} changed`, r.removed && `${r.removed} no longer in the link`].filter(Boolean).join(" · ")
          : "No changes since last check.",
    };
  } catch (e) {
    return { error: problem(e) };
  }
}

// One course (or General) for everything inside a Drive folder, subfolders included.
export async function setFolderCourse(sourceId: string, path: string, courseId: string | null) {
  const { supabase } = await requireUser();
  let q = supabase.from("drive_items").update({ course_id: courseId }).eq("source_id", sourceId);
  q = path ? q.or(`path.eq.${JSON.stringify(path)},path.like.${JSON.stringify(`${path}/%`)}`) : q;
  await q;
  revalidatePath(`/library/drive/${sourceId}`);
}

export async function updateDriveItem(id: string, patch: { include?: boolean; doc_type?: string; course_id?: string | null }) {
  const { supabase } = await requireUser();
  await supabase.from("drive_items").update(patch).eq("id", id);
}

export async function setAutoImport(id: string, on: boolean) {
  const { supabase } = await requireUser();
  await supabase.from("drive_sources").update({ auto_import: on }).eq("id", id);
  revalidatePath(`/library/drive/${id}`);
}

export async function removeDriveLink(fd: FormData) {
  const { supabase } = await requireUser();
  // Files already brought in stay in your Library.
  await supabase.from("drive_sources").delete().eq("id", String(fd.get("id")));
  revalidatePath("/library", "layout");
  redirect("/library/drive");
}
