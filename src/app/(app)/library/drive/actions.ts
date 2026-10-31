"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { blockedNote, DriveError, getMeta, MAX_FILES, parseDriveLink, syncItems } from "@/lib/drive";
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
  let blocked: string[] = [];
  try {
    const meta = await getMeta(parsed.id, parsed.resourceKey);
    const isFolder = meta.mimeType === "application/vnd.google-apps.folder";
    const { data: existing, error: readError } = await supabase.from("drive_sources").select("id").eq("drive_id", parsed.id).maybeSingle();
    if (readError) throw readError;
    if (existing) {
      // The same link again (e.g. after disconnecting): reconnect it, keeping everything already brought in.
      sourceId = existing.id;
      await supabase.from("drive_sources").update({ removed_at: null, link }).eq("id", sourceId);
    }
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
    ({ blocked } = await syncItems(supabase, source as DriveSource));
  } catch (e) {
    return { error: problem(e) };
  }
  revalidatePath("/library", "layout");
  redirect(`/library/drive/${sourceId}${blocked.length ? `?blocked=${encodeURIComponent(blocked.join("\n"))}` : ""}`);
}

export async function checkDriveLink(id: string) {
  const { supabase } = await requireUser();
  const { data: source } = await supabase.from("drive_sources").select("*").eq("id", id).maybeSingle();
  if (!source) return { error: "Link not found." };
  try {
    const r = await syncItems(supabase, source as DriveSource);
    revalidatePath(`/library/drive/${id}`);
    const found = `Found ${r.total.toLocaleString()} file${r.total === 1 ? "" : "s"}${r.folders ? ` in ${r.folders.toLocaleString()} folder${r.folders === 1 ? "" : "s"}` : ""}.`;
    const what =
      r.added || r.changed || r.removed
        ? [r.added && `${r.added} new`, r.changed && `${r.changed} changed`, r.removed && `${r.removed} no longer in the link`].filter(Boolean).join(" · ")
        : "No changes since last check.";
    return {
      message: `${found} ${what}${r.blocked.length ? ` ${blockedNote(r.blocked)}` : ""}${r.truncated ? ` This link is very big: only the first ${MAX_FILES.toLocaleString()} files are listed. Add its subfolders as separate links to see the rest.` : ""}`,
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

// Tick or untick everything inside a Drive folder (subfolders included); "" means the whole link.
// Files that can't be read stay unticked.
export async function setFolderInclude(sourceId: string, path: string, include: boolean) {
  const { supabase } = await requireUser();
  let q = supabase.from("drive_items").update({ include }).eq("source_id", sourceId).neq("status", "skipped");
  if (path) q = q.or(`path.eq.${JSON.stringify(path)},path.like.${JSON.stringify(`${path}/%`)}`);
  await q;
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

// Disconnecting keeps the link's history and everything brought in (files, text, topics), so reconnecting
// later is instant: nothing is downloaded or processed again unless it changed in Drive.
export async function removeDriveLink(fd: FormData) {
  const { supabase } = await requireUser();
  const id = String(fd.get("id"));
  const { error } = await supabase.from("drive_sources").update({ removed_at: new Date().toISOString() }).eq("id", id);
  // Before migration 0008 there's no "disconnected" state: remove the link (files stay in your Library).
  if (error) await supabase.from("drive_sources").delete().eq("id", id);
  revalidatePath("/library", "layout");
  redirect("/library/drive");
}

export async function reconnectDriveLink(fd: FormData) {
  const { supabase } = await requireUser();
  const id = String(fd.get("id"));
  await supabase.from("drive_sources").update({ removed_at: null }).eq("id", id);
  const { data: source } = await supabase.from("drive_sources").select("*").eq("id", id).maybeSingle();
  // Look at Drive again; if it can't be reached right now, your saved files still work.
  if (source) await syncItems(supabase, source as DriveSource).catch(() => {});
  revalidatePath("/library", "layout");
  redirect(`/library/drive/${id}`);
}

// Removes a disconnected link and its history for good (files already in your Library stay).
export async function deleteDriveLink(fd: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("drive_sources").delete().eq("id", String(fd.get("id")));
  revalidatePath("/library", "layout");
  redirect("/library/drive");
}
