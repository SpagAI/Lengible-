import type { DocType, Folder } from "@/lib/supabase/types";

export const docTypes: { value: DocType; label: string }[] = [
  { value: "slides", label: "Slides" },
  { value: "timetable", label: "Timetable" },
  { value: "topic_list", label: "Topic list" },
  { value: "textbook", label: "Textbook" },
  { value: "past_questions", label: "Past questions" },
  { value: "mb_questions", label: "MB questions" },
  { value: "picture_test", label: "Picture test" },
  { value: "practical", label: "Practical" },
  { value: "manual", label: "Manual" },
  { value: "essay", label: "Essay" },
  { value: "notes", label: "Notes" },
  { value: "other", label: "Other" },
];
export const docTypeLabel = Object.fromEntries(docTypes.map((d) => [d.value, d.label])) as Record<DocType, string>;

// Timetables and topic lists are read into the app's structure after you review them.
export const importableTypes: DocType[] = ["timetable", "topic_list"];

export function formatBytes(n: number | null) {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Root → ... → current folder, for breadcrumbs.
export function folderPath(folders: Folder[], id: string | null) {
  const path: Folder[] = [];
  let cur = folders.find((f) => f.id === id);
  while (cur) {
    path.unshift(cur);
    cur = folders.find((f) => f.id === cur!.parent_id);
  }
  return path;
}

// Storage paths start with the user's id, which the storage rules check.
export function storagePath(userId: string, fileId: string, name: string, version: number) {
  const safe = name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  return `${userId}/${fileId}/v${version}-${safe}`;
}

// "general" in a URL means files that cover every course (like the master timetable).
export const GENERAL = "general";
export const courseParam = (id: string | null) => id ?? GENERAL;
export const courseFromParam = (p: string) => (p === GENERAL ? null : p);

// Guesses the type from the file name so most uploads need no changes.
export function guessType(name: string) {
  const n = name.toLowerCase();
  if (/time ?table|schedule/.test(n)) return "timetable";
  if (/topic|syllabus|curriculum/.test(n)) return "topic_list";
  if (/\bmb\b/.test(n)) return "mb_questions";
  if (/past|pq|question/.test(n)) return "past_questions";
  if (/practical|prac\b/.test(n)) return "practical";
  if (/manual/.test(n)) return "manual";
  if (/notes?\b|summary/.test(n)) return "notes";
  if (/\.(pptx?|key)$/.test(n) || /\bslides?\b|\blecture\b/.test(n)) return "slides";
  if (/\.(jpe?g|png|webp|heic)$/.test(n)) return "picture_test";
  return "";
}
