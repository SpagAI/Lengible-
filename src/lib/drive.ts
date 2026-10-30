import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DriveItem, DriveSource } from "@/lib/supabase/types";
import { matchCourse } from "@/lib/analysis/match";
import { guessType } from "@/lib/library";

type DB = SupabaseClient<Database>;

// Reads Google Drive folders and files shared "Anyone with the link" using a Google API key
// (server-side only; never sent to the browser). No Google sign-in is needed.

const BASE = process.env.GOOGLE_DRIVE_BASE_URL || "https://www.googleapis.com/drive/v3";
export const driveKey = () => process.env.GOOGLE_DRIVE_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";

export class DriveError extends Error {
  constructor(
    message: string,
    public kind: "setup" | "not_shared" | "too_big" | "unsupported" | "other",
  ) {
    super(message);
  }
}

const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
// Google Docs/Slides are brought in as PDF.
const EXPORT_AS_PDF = new Set(["application/vnd.google-apps.document", "application/vnd.google-apps.presentation"]);
const SUPPORTED = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];
export const MAX_BYTES = 50 * 1024 * 1024;

export function isSupported(mime: string, name: string) {
  return EXPORT_AS_PDF.has(mime) || SUPPORTED.includes(mime) || mime.startsWith("image/") || /\.(pdf|pptx|docx|txt|md|jpe?g|png|webp)$/i.test(name);
}
// Why a file can't be read, in plain words (or null when it can).
export function unsupportedReason(mime: string, name: string) {
  if (isSupported(mime, name)) return null;
  if (/\.ppt$/i.test(name) || mime === "application/vnd.ms-powerpoint") return "Old .ppt format: save it as .pptx or PDF to include it.";
  if (/\.doc$/i.test(name) || mime === "application/msword") return "Old .doc format: save it as .docx or PDF to include it.";
  if (mime === "application/vnd.google-apps.spreadsheet" || /\.xlsx?$/i.test(name)) return "Spreadsheets aren't read yet.";
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return "Videos and audio aren't read.";
  return "This kind of file can't be read.";
}
// The name the file gets in your Library (Google Docs/Slides become PDFs).
export const libraryName = (name: string, mime: string) => (EXPORT_AS_PDF.has(mime) && !/\.pdf$/i.test(name) ? `${name}.pdf` : name);
export const libraryMime = (mime: string) => (EXPORT_AS_PDF.has(mime) ? "application/pdf" : mime);

// Pulls the id (and resource key, for older shared links) out of any Drive link.
export function parseDriveLink(link: string) {
  const s = link.trim();
  let url: URL;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return /^[\w-]{20,}$/.test(s) ? { id: s, resourceKey: null } : null;
  }
  if (!/(^|\.)google\.com$/.test(url.hostname)) return null;
  const m = url.pathname.match(/\/(?:folders|d|file\/d|document\/d|presentation\/d|spreadsheets\/d|drive\/u\/\d+\/folders)\/([\w-]{10,})/);
  const id = m?.[1] ?? url.searchParams.get("id");
  return id ? { id, resourceKey: url.searchParams.get("resourcekey") } : null;
}

async function call(path: string, params: Record<string, string>, resourceKeys: string[] = []) {
  const key = driveKey();
  if (!key) throw new DriveError("No Google API key is set up yet. Add GOOGLE_DRIVE_API_KEY in Vercel (see the steps on this page).", "setup");
  const q = new URLSearchParams({ ...params, key, supportsAllDrives: "true" });
  const res = await fetch(`${BASE}${path}?${q}`, {
    headers: resourceKeys.length ? { "X-Goog-Drive-Resource-Keys": resourceKeys.join(",") } : undefined,
    cache: "no-store",
  });
  if (res.ok) return res;
  let reason = "";
  let message = "";
  try {
    const j = await res.json();
    reason = j.error?.errors?.[0]?.reason ?? j.error?.status ?? "";
    message = j.error?.message ?? "";
    for (const d of j.error?.details ?? []) if (d.reason) reason = d.reason;
  } catch {}
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used|is disabled/i.test(message)) {
    throw new DriveError("The Google Drive API isn't switched on for your API key's Google Cloud project yet. Follow the setup steps on this page, then try again.", "setup");
  }
  if (/keyInvalid|API_KEY_INVALID|API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|forbidden/i.test(reason) || /API key/i.test(message)) {
    throw new DriveError("Your Google API key can't use Google Drive (it may be restricted to other services). Follow the setup steps on this page to make a Drive key.", "setup");
  }
  if (res.status === 404 || /notFound/i.test(reason)) {
    throw new DriveError("Couldn't open this link. It needs to be shared as “Anyone with the link can view”. Ask your class rep, or check the link is complete.", "not_shared");
  }
  if (/exportSizeLimitExceeded/i.test(reason)) throw new DriveError("Google can't convert this file to PDF (it's over Google's 10 MB export limit). Download it as PDF in Drive and add it to your Library instead.", "too_big");
  if (/cannotDownloadFile|downloadQuotaExceeded/i.test(reason)) throw new DriveError("The owner has blocked downloading, or Google's download limit for this file was reached today. Try again tomorrow.", "other");
  if (res.status === 429 || /rateLimit|userRateLimit/i.test(reason)) throw new DriveError("Google Drive is limiting requests right now. Try again in a minute.", "other");
  throw new DriveError(`Google Drive said: ${message || res.statusText}`, "other");
}

type RawFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  resourceKey?: string;
  shortcutDetails?: { targetId: string; targetMimeType: string; targetResourceKey?: string };
};
const FIELDS = "id,name,mimeType,size,modifiedTime,md5Checksum,resourceKey,shortcutDetails";

export async function getMeta(id: string, resourceKey?: string | null) {
  const res = await call(`/files/${id}`, { fields: FIELDS }, resourceKey ? [`${id}/${resourceKey}`] : []);
  return (await res.json()) as RawFile;
}

export type ListedFile = { id: string; resourceKey: string | null; name: string; mime: string; path: string; size: number | null; modified: string | null; md5: string | null };

// Every file under a folder, subfolders included (at most 8 levels and 3,000 files).
export async function listFolder(id: string, resourceKey: string | null) {
  const out: ListedFile[] = [];
  const keys = resourceKey ? [`${id}/${resourceKey}`] : [];
  const walk = async (folderId: string, path: string, depth: number) => {
    let pageToken = "";
    do {
      const res = await call(
        "/files",
        {
          q: `'${folderId}' in parents and trashed = false`,
          fields: `nextPageToken,files(${FIELDS})`,
          pageSize: "1000",
          includeItemsFromAllDrives: "true",
          orderBy: "folder,name",
          ...(pageToken ? { pageToken } : {}),
        },
        keys,
      );
      const j = (await res.json()) as { files: RawFile[]; nextPageToken?: string };
      for (let f of j.files ?? []) {
        if (f.mimeType === SHORTCUT && f.shortcutDetails) {
          f = { ...f, id: f.shortcutDetails.targetId, mimeType: f.shortcutDetails.targetMimeType, resourceKey: f.shortcutDetails.targetResourceKey };
        }
        if (f.resourceKey) keys.push(`${f.id}/${f.resourceKey}`);
        if (f.mimeType === FOLDER) {
          if (depth < 8) await walk(f.id, path ? `${path}/${f.name}` : f.name, depth + 1);
        } else if (out.length < 3000) {
          out.push({ id: f.id, resourceKey: f.resourceKey ?? null, name: f.name, mime: f.mimeType, path, size: f.size ? Number(f.size) : null, modified: f.modifiedTime ?? null, md5: f.md5Checksum ?? null });
        }
      }
      pageToken = j.nextPageToken ?? "";
    } while (pageToken);
  };
  await walk(id, "", 0);
  return out;
}

// Downloads a file (Google Docs/Slides as PDF), refusing anything over the 50 MB storage limit.
export async function download(item: Pick<DriveItem, "drive_id" | "resource_key" | "mime" | "size_bytes">) {
  const keys = item.resource_key ? [`${item.drive_id}/${item.resource_key}`] : [];
  if (item.size_bytes && item.size_bytes > MAX_BYTES) throw new DriveError(`Over the 50 MB limit (${Math.round(item.size_bytes / 1e6)} MB). Compress or split it, then add it by hand.`, "too_big");
  const res = EXPORT_AS_PDF.has(item.mime)
    ? await call(`/files/${item.drive_id}/export`, { mimeType: "application/pdf" }, keys)
    : await call(`/files/${item.drive_id}`, { alt: "media", acknowledgeAbuse: "true" }, keys);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new DriveError(`Over the 50 MB limit (${Math.round(buf.length / 1e6)} MB). Compress or split it, then add it by hand.`, "too_big");
  return buf;
}

// Saves what the link contains: new files are added, changed ones marked, gone ones marked removed.
// Course and type are guessed from folder and file names; your own choices are kept.
export async function syncItems(supabase: DB, source: DriveSource) {
  let files: ListedFile[];
  if (source.is_folder) files = await listFolder(source.drive_id, source.resource_key);
  else {
    const m = await getMeta(source.drive_id, source.resource_key);
    files = [{ id: m.id, resourceKey: m.resourceKey ?? source.resource_key, name: m.name, mime: m.mimeType, path: "", size: m.size ? Number(m.size) : null, modified: m.modifiedTime ?? null, md5: m.md5Checksum ?? null }];
  }
  const [{ data: existing }, { data: courses }] = await Promise.all([
    supabase.from("drive_items").select("*").eq("source_id", source.id),
    supabase.from("courses").select("id, name, short_name, is_group").eq("archived", false),
  ]);
  const leaf = (courses ?? []).filter((c) => !c.is_group);
  const have = new Map(((existing ?? []) as DriveItem[]).map((i) => [i.drive_id, i]));
  const seen = new Set<string>();
  const fresh = [];
  let changed = 0;
  for (const f of files) {
    seen.add(f.id);
    const old = have.get(f.id);
    if (!old) {
      // Course from the nearest folder name that matches one of your courses (then the file name).
      const parts = f.path.split("/").filter(Boolean).reverse();
      const course = [...parts, f.name].map((p) => matchCourse(p, leaf)).find(Boolean) ?? null;
      const why = unsupportedReason(f.mime, f.name);
      // The file's own name and kind first, then its folder names.
      const type =
        guessType(f.name) ||
        (f.mime === "application/vnd.google-apps.presentation" ? "slides" : f.mime.startsWith("image/") ? "picture_test" : "") ||
        guessType([...parts].join(" ")) ||
        "other";
      fresh.push({
        source_id: source.id,
        drive_id: f.id,
        resource_key: f.resourceKey,
        name: f.name,
        mime: f.mime,
        path: f.path,
        size_bytes: f.size,
        modified_time: f.modified,
        md5: f.md5,
        course_id: course,
        doc_type: type,
        include: !why && !(f.size && f.size > MAX_BYTES),
        status: (why ? "skipped" : "new") as DriveItem["status"],
        error: why ?? (f.size && f.size > MAX_BYTES ? `Over the 50 MB limit (${Math.round(f.size / 1e6)} MB).` : null),
      });
      continue;
    }
    const moved = old.path !== f.path || old.name !== f.name;
    const isNewer = !!f.modified && !!old.imported_modified && new Date(f.modified) > new Date(old.imported_modified) && (!f.md5 || f.md5 !== old.md5);
    const update: Database["public"]["Tables"]["drive_items"]["Update"] = {};
    if (moved) Object.assign(update, { name: f.name, path: f.path });
    if (f.modified !== old.modified_time || f.md5 !== old.md5 || f.size !== old.size_bytes) Object.assign(update, { modified_time: f.modified, md5: f.md5, size_bytes: f.size });
    if (old.status === "imported" && isNewer) {
      update.status = "changed";
      changed++;
    }
    if (old.status === "removed") update.status = old.file_id ? "imported" : "new";
    if (Object.keys(update).length) await supabase.from("drive_items").update(update).eq("id", old.id);
  }
  for (let i = 0; i < fresh.length; i += 200) await supabase.from("drive_items").insert(fresh.slice(i, i + 200));
  const gone = [...have.values()].filter((i) => !seen.has(i.drive_id) && i.status !== "removed");
  if (gone.length) await supabase.from("drive_items").update({ status: "removed" }).in("id", gone.map((i) => i.id));
  await supabase.from("drive_sources").update({ last_checked_at: new Date().toISOString() }).eq("id", source.id);
  return { added: fresh.filter((f) => f.status === "new").length, changed, removed: gone.length, total: files.length };
}
