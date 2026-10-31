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

// ——— Big files from your device ———
// Supabase's free plan stores at most 50 MB per file, so a bigger upload is stored in pieces (45 MB each) and
// joined back, byte for byte, whenever it's read, opened or downloaded. Nothing is compressed or left out.
export const PART_SIZE = 45 * 1024 * 1024;
export const MAX_UPLOAD = 300 * 1024 * 1024;
export const partsPath = (path: string, count: number) => `parts:${count}:${path}`;
export function parsePartsPath(storagePath: string) {
  const m = storagePath.match(/^parts:(\d+):(.+)$/);
  return m ? { count: Number(m[1]), base: m[2] } : null;
}
export const partPaths = (base: string, count: number) => Array.from({ length: count }, (_, i) => `${base}.part${i}`);
// Every storage object behind a file (one, or its pieces).
export function storageObjects(storagePath: string) {
  const parts = parsePartsPath(storagePath);
  return parts ? partPaths(parts.base, parts.count) : storagePath.startsWith("drive:") ? [] : [storagePath];
}
