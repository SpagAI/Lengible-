"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import type { DocType } from "@/lib/supabase/types";
import { docTypes, storagePath, courseParam, MAX_UPLOAD, PART_SIZE, partsPath, partPaths, storageObjects } from "@/lib/library";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const isDocType = (v: string): v is DocType => docTypes.some((d) => d.value === v);

export async function createFolder(fd: FormData) {
  const { supabase } = await requireUser();
  const name = str(fd, "name");
  if (!name) return;
  await supabase.from("folders").insert({ name, course_id: str(fd, "course_id") || null, parent_id: str(fd, "parent_id") || null });
  revalidatePath("/library", "layout");
}

export async function renameFolder(fd: FormData) {
  const { supabase } = await requireUser();
  const name = str(fd, "name");
  if (name) await supabase.from("folders").update({ name }).eq("id", str(fd, "id"));
  revalidatePath("/library", "layout");
}

// Deleting a folder deletes its subfolders; files inside move up to the course's top level.
export async function deleteFolder(fd: FormData) {
  const { supabase } = await requireUser();
  const id = str(fd, "id");
  const { data: folder } = await supabase.from("folders").select("course_id, parent_id").eq("id", id).maybeSingle();
  await supabase.from("folders").delete().eq("id", id);
  revalidatePath("/library", "layout");
  redirect(`/library/course/${courseParam(folder?.course_id ?? null)}${folder?.parent_id ? `?folder=${folder.parent_id}` : ""}`);
}

export type NewFile = { courseId: string | null; folderId: string | null; topicId: string | null; name: string; docType: string; mime: string; size: number };

// Step 1 of an upload: create the record and decide where the file is stored.
export async function createFileRecord(f: NewFile) {
  const { supabase, user } = await requireUser();
  const id = crypto.randomUUID();
  if (f.size > MAX_UPLOAD) return { error: `Files up to ${MAX_UPLOAD / 1024 / 1024} MB can be uploaded (this one is ${Math.round(f.size / 1e6)} MB). Put it in your Google Drive folder instead: Drive files have no size limit.` };
  const base = storagePath(user.id, id, f.name, 1);
  // Over 50 MB: stored in pieces and joined back when read (see lib/library.ts).
  const count = f.size > 50 * 1024 * 1024 ? Math.ceil(f.size / PART_SIZE) : 0;
  const path = count ? partsPath(base, count) : base;
  const { error } = await supabase.from("files").insert({
    id,
    course_id: f.courseId,
    folder_id: f.folderId,
    topic_id: f.topicId,
    name: f.name.replace(/\.[^.]+$/, "") || f.name,
    doc_type: isDocType(f.docType) ? f.docType : "other",
    storage_path: path,
    mime_type: f.mime || null,
    size_bytes: f.size,
  });
  if (error) return { error: "Couldn't save the file record. Has the Phase 2 database update been run?" };
  return { id, path, parts: count ? partPaths(base, count) : null };
}

// Step 3: the browser has saved the text (or found none).
export async function finishExtraction(id: string, pageCount: number, hasText: boolean) {
  const { supabase } = await requireUser();
  await supabase.from("files").update({ page_count: pageCount, status: hasText ? "extracted" : "no_text", error: null }).eq("id", id);
  revalidatePath("/library", "layout");
}

export async function markFailed(id: string, message: string) {
  const { supabase } = await requireUser();
  await supabase.from("files").update({ status: "failed", error: message.slice(0, 300) }).eq("id", id);
}

// Replacing a file: keep its place, links and id, store the new version and clear the old text.
export async function startReplace(id: string, name: string, mime: string, size: number) {
  const { supabase, user } = await requireUser();
  const { data: file } = await supabase.from("files").select("storage_path, version").eq("id", id).maybeSingle();
  if (!file) return { error: "File not found." };
  const version = file.version + 1;
  const path = storagePath(user.id, id, name, version);
  await supabase.from("chunks").delete().eq("file_id", id);
  await supabase.from("file_concepts").delete().eq("file_id", id);
  await supabase
    .from("files")
    .update({ storage_path: path, version, mime_type: mime || null, size_bytes: size, status: "uploaded", analysis: null, error: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (storageObjects(file.storage_path).length) await supabase.storage.from("library").remove(storageObjects(file.storage_path));
  return { id, path };
}

export async function updateFile(fd: FormData) {
  const { supabase } = await requireUser();
  const id = str(fd, "id");
  const courseId = str(fd, "course_id") || null;
  const docType = str(fd, "doc_type");
  await supabase
    .from("files")
    .update({
      name: str(fd, "name") || "Untitled",
      doc_type: isDocType(docType) ? docType : "other",
      course_id: courseId,
      folder_id: str(fd, "folder_id") || null,
      topic_id: str(fd, "topic_id") || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  // Keep the searchable text filed under the same course.
  await supabase.from("chunks").update({ course_id: courseId }).eq("file_id", id);
  revalidatePath("/library", "layout");
}

export async function deleteFile(fd: FormData) {
  const { supabase } = await requireUser();
  const id = str(fd, "id");
  const { data: file } = await supabase.from("files").select("storage_path, course_id, folder_id").eq("id", id).maybeSingle();
  if (file) {
    const objects = storageObjects(file.storage_path);
    if (objects.length) await supabase.storage.from("library").remove(objects);
    await supabase.from("files").delete().eq("id", id);
  }
  revalidatePath("/library", "layout");
  redirect(`/library/course/${courseParam(file?.course_id ?? null)}${file?.folder_id ? `?folder=${file.folder_id}` : ""}`);
}

// Your correction of what a file is (course, set, kind, exam, year…). The AI won't change it again.
export async function saveFileProfile(id: string, profile: import("@/lib/supabase/types").FileProfile) {
  const { supabase } = await requireUser();
  const clean = { ...profile, set: profile.set?.trim().toUpperCase().replace(/\s+/g, "") || null, edited: true };
  await supabase.from("files").update({ profile: clean }).eq("id", id);
  // Past questions keep the paper's exam, set and year.
  if (clean.kind === "past_questions") {
    await supabase.from("exam_questions").update({ exam: clean.exam ?? "other", class_set: clean.set, exam_year: clean.exam_year }).eq("file_id", id);
  }
  revalidatePath(`/library/file/${id}`);
}
