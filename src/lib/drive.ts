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

export const NOT_PUBLIC =
  "Google won't let Lengible open this folder: it isn't shared as “Anyone with the link can view”. It's probably shared only with your Google account (that's why you can see it in Drive). Ask your class rep to set General access → Anyone with the link → Viewer, or add the subfolders that are shared that way.";

// Plain words for subfolders Google wouldn't open with the link.
export const blockedNote = (paths: string[]) =>
  `${paths.length} subfolder${paths.length === 1 ? "" : "s"} couldn't be opened because ${paths.length === 1 ? "it isn't" : "they aren't"} shared “Anyone with the link”: ${paths.slice(0, 6).join(", ")}${paths.length > 6 ? ` and ${paths.length - 6} more` : ""}. Their files aren't listed.`;

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
  // The file or folder exists but isn't shared "Anyone with the link" (e.g. only with your own Google account).
  if (/insufficientFilePermissions|insufficientPermissions/i.test(reason) || /sufficient permissions/i.test(message)) {
    throw new DriveError(NOT_PUBLIC, "not_shared");
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

const toListed = (f: RawFile, path: string): ListedFile => ({
  id: f.id,
  resourceKey: f.resourceKey ?? null,
  name: f.name,
  mime: f.mimeType,
  path,
  size: f.size ? Number(f.size) : null,
  modified: f.modifiedTime ?? null,
  md5: f.md5Checksum ?? null,
});

export const MAX_FILES = 20000;
const MAX_DEPTH = 25;
// Folders asked about in one request ("'a' in parents or 'b' in parents …"), and requests run at once.
const BATCH = 25;
const PARALLEL = 4;

// Every file under a folder, all subfolders included, each listed once (a shortcut to a file already seen is skipped).
// Folders are read level by level, many per request, so even a whole class drive is listed in a few dozen requests.
export async function listFolder(id: string, resourceKey: string | null) {
  const out: ListedFile[] = [];
  const seenFiles = new Map<string, number>();
  // Files first met through a shortcut: their real folder wins if it's found too.
  const viaShortcut = new Set<string>();
  const seenFolders = new Set<string>([id]);
  const keyOf = new Map<string, string>(resourceKey ? [[id, resourceKey]] : []);
  let level = [{ id, path: "" }];
  let folders = 0;
  // Every subfolder's path, empty ones included (for exact counts).
  const paths: string[] = [];
  let truncated = false;
  // Subfolders that aren't shared "Anyone with the link": skipped (and named) instead of failing the whole link.
  const blocked: string[] = [];
  // A "/" inside a folder name would look like a subfolder.
  const clean = (name: string) => name.replace(/\//g, "∕").trim() || "Untitled folder";
  const listBatch = async (batch: { id: string; path: string }[]) => {
    const next: { id: string; path: string }[] = [];
    const pathOf = new Map(batch.map((b) => [b.id, b.path]));
    let pageToken = "";
    do {
      const res = await call(
        "/files",
        {
          q: `(${batch.map((b) => `'${b.id}' in parents`).join(" or ")}) and trashed = false`,
          fields: `nextPageToken,files(${FIELDS},parents)`,
          pageSize: "1000",
          includeItemsFromAllDrives: "true",
          orderBy: "folder,name",
          ...(pageToken ? { pageToken } : {}),
        },
        batch.flatMap((b) => (keyOf.has(b.id) ? [`${b.id}/${keyOf.get(b.id)}`] : [])),
      );
      const j = (await res.json()) as { files: (RawFile & { parents?: string[] })[]; nextPageToken?: string };
      for (let f of j.files ?? []) {
        const parent = (f.parents ?? []).find((x) => pathOf.has(x)) ?? batch[0].id;
        const path = pathOf.get(parent) ?? "";
        const shortcut = f.mimeType === SHORTCUT;
        if (shortcut && f.shortcutDetails) {
          f = { ...f, id: f.shortcutDetails.targetId, mimeType: f.shortcutDetails.targetMimeType, resourceKey: f.shortcutDetails.targetResourceKey };
        }
        if (f.resourceKey) keyOf.set(f.id, f.resourceKey);
        if (f.mimeType === FOLDER) {
          if (seenFolders.has(f.id)) continue;
          seenFolders.add(f.id);
          next.push({ id: f.id, path: path ? `${path}/${clean(f.name)}` : clean(f.name) });
        } else if (seenFiles.has(f.id)) {
          if (!shortcut && viaShortcut.delete(f.id)) out[seenFiles.get(f.id)!] = toListed(f, path);
        } else {
          if (out.length >= MAX_FILES) {
            truncated = true;
            continue;
          }
          seenFiles.set(f.id, out.length);
          if (shortcut) viaShortcut.add(f.id);
          out.push(toListed(f, path));
        }
      }
      pageToken = j.nextPageToken ?? "";
    } while (pageToken);
    return next;
  };
  // One private folder makes Google refuse the whole request: halve the batch until it's found.
  const listOpen = async (batch: { id: string; path: string }[]): Promise<{ id: string; path: string }[]> => {
    try {
      return await listBatch(batch);
    } catch (e) {
      if (!(e instanceof DriveError && e.kind === "not_shared")) throw e;
      if (batch.length === 1) {
        if (!batch[0].path) throw e;
        blocked.push(batch[0].path);
        return [];
      }
      const half = Math.ceil(batch.length / 2);
      return [...(await listOpen(batch.slice(0, half))), ...(await listOpen(batch.slice(half)))];
    }
  };
  for (let depth = 0; level.length && depth <= MAX_DEPTH; depth++) {
    folders += level.length;
    for (const f of level) if (f.path) paths.push(f.path);
    const batches: { id: string; path: string }[][] = [];
    for (let k = 0; k < level.length; k += BATCH) batches.push(level.slice(k, k + BATCH));
    const next: { id: string; path: string }[] = [];
    for (let k = 0; k < batches.length; k += PARALLEL) {
      for (const found of await Promise.all(batches.slice(k, k + PARALLEL).map(listOpen))) next.push(...found);
    }
    level = next;
  }
  if (level.length) truncated = true;
  // Files only reached through a shortcut: the shortcut doesn't carry their date or size, so look them up
  // (needed to notice when they change).
  const lookups = [...viaShortcut];
  for (let k = 0; k < lookups.length; k += 8) {
    await Promise.all(
      lookups.slice(k, k + 8).map(async (fid) => {
        const at = seenFiles.get(fid)!;
        try {
          const m = await getMeta(fid, keyOf.get(fid));
          out[at] = { ...toListed(m, out[at].path), name: m.name || out[at].name };
        } catch {}
      }),
    );
  }
  // Same order as Drive shows: by folder, then name.
  out.sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
  return { files: out, folders, paths: paths.sort(), truncated, blocked: blocked.sort() };
}

// PowerPoint and Word files (and anything over the 50 MB storage limit) aren't copied into your storage:
// Lengible keeps a link to the Drive file, reads its text on the server, and shows it with Google's viewer.
// This saves your Supabase storage (1 GB on the free plan) and has no size limit.
export const isLinkOnly = (item: Pick<DriveItem, "mime" | "name" | "size_bytes">) =>
  (!EXPORT_AS_PDF.has(item.mime) && /\.(pptx|docx)$/i.test(item.name)) ||
  item.mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
  item.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
  (!!item.size_bytes && item.size_bytes > MAX_BYTES && !EXPORT_AS_PDF.has(item.mime));
// The storage path of a linked file: no copy, just where it lives in Drive (and its name, for its type).
export const drivePath = (driveId: string, name: string) => `drive:${driveId}/${name}`;
export const isDrivePath = (path: string) => path.startsWith("drive:");
export const drivePreviewUrl = (driveId: string, resourceKey?: string | null) =>
  `https://drive.google.com/file/d/${driveId}/preview${resourceKey ? `?resourcekey=${resourceKey}` : ""}`;
export const driveOpenUrl = (driveId: string, resourceKey?: string | null) =>
  `https://drive.google.com/open?id=${driveId}${resourceKey ? `&resourcekey=${resourceKey}` : ""}`;

// Downloads a file (Google Docs/Slides as PDF), refusing anything over the limit (the 50 MB storage limit,
// unless it's only being read on the server).
export async function download(item: Pick<DriveItem, "drive_id" | "resource_key" | "mime" | "size_bytes">, limit = MAX_BYTES) {
  const keys = item.resource_key ? [`${item.drive_id}/${item.resource_key}`] : [];
  if (item.size_bytes && item.size_bytes > limit) throw new DriveError(`Over the 50 MB limit (${Math.round(item.size_bytes / 1e6)} MB). Compress or split it, then add it by hand.`, "too_big");
  const res = EXPORT_AS_PDF.has(item.mime)
    ? await call(`/files/${item.drive_id}/export`, { mimeType: "application/pdf" }, keys)
    : await call(`/files/${item.drive_id}`, { alt: "media", acknowledgeAbuse: "true" }, keys);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw new DriveError(`Over the 50 MB limit (${Math.round(buf.length / 1e6)} MB). Compress or split it, then add it by hand.`, "too_big");
  return buf;
}

// Every Drive item of a link. Supabase hands back at most 1,000 rows per request, so read it page by page.
export async function allDriveItems(supabase: DB, sourceId: string) {
  const rows: DriveItem[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("drive_items").select("*").eq("source_id", sourceId).order("path").order("name").order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as DriveItem[]));
    if (!data || data.length < 1000) return rows;
  }
}

// Saves what the link contains: new files are added, changed ones marked, gone ones marked removed.
// Course and type are guessed from folder and file names; your own choices are kept.
export async function syncItems(supabase: DB, source: DriveSource) {
  let files: ListedFile[];
  let folders = 0;
  let paths: string[] = [];
  let truncated = false;
  let blocked: string[] = [];
  if (source.is_folder) ({ files, folders, paths, truncated, blocked } = await listFolder(source.drive_id, source.resource_key));
  else {
    const m = await getMeta(source.drive_id, source.resource_key);
    files = [{ id: m.id, resourceKey: m.resourceKey ?? source.resource_key, name: m.name, mime: m.mimeType, path: "", size: m.size ? Number(m.size) : null, modified: m.modifiedTime ?? null, md5: m.md5Checksum ?? null }];
  }
  const [existing, { data: courses }] = await Promise.all([
    allDriveItems(supabase, source.id),
    supabase.from("courses").select("id, name, short_name, is_group").eq("archived", false),
  ]);
  const leaf = (courses ?? []).filter((c) => !c.is_group);
  const have = new Map(((existing ?? []) as DriveItem[]).map((i) => [i.drive_id, i]));
  // A new link starts with nothing ticked: you pick what to take in. Later, a new file is ticked by itself
  // when the nearest folder around it (with files you've seen) was picked whole, so chosen folders stay complete.
  const readable = ((existing ?? []) as DriveItem[]).filter((i) => i.status !== "skipped" && i.status !== "removed");
  const pickedFolder = (path: string) => {
    const parts = path.split("/").filter(Boolean);
    for (let k = parts.length; k >= 0; k--) {
      const p = parts.slice(0, k).join("/");
      const inside = readable.filter((i) => !p || i.path === p || i.path.startsWith(`${p}/`));
      if (inside.length) return inside.every((i) => i.include);
    }
    return false;
  };
  const seen = new Set<string>();
  const fresh = [];
  let changed = 0;
  const updates: { id: string; update: Database["public"]["Tables"]["drive_items"]["Update"] }[] = [];
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
        include: !why && pickedFolder(f.path),
        status: (why ? "skipped" : "new") as DriveItem["status"],
        error: why ?? null,
      });
      continue;
    }
    const moved = old.path !== f.path || old.name !== f.name;
    const isNewer = !!f.modified && !!old.imported_modified && new Date(f.modified) > new Date(old.imported_modified) && (!f.md5 || f.md5 !== old.md5);
    const update: Database["public"]["Tables"]["drive_items"]["Update"] = {};
    if (moved) Object.assign(update, { name: f.name, path: f.path });
    const time = (x: string | null) => (x ? new Date(x).getTime() : 0);
    if (time(f.modified) !== time(old.modified_time) || (f.md5 ?? null) !== (old.md5 ?? null) || (f.size ?? null) !== (old.size_bytes == null ? null : Number(old.size_bytes))) Object.assign(update, { modified_time: f.modified, md5: f.md5, size_bytes: f.size });
    if (old.status === "imported" && isNewer) {
      update.status = "changed";
      changed++;
    }
    if (old.status === "removed") update.status = old.file_id ? "imported" : "new";
    // Big files used to be refused; they're linked now.
    if (old.error && /50 MB limit/.test(old.error) && old.status !== "imported") Object.assign(update, { error: null, ...(old.status === "error" ? { status: "new" } : {}) });
    if (Object.keys(update).length) updates.push({ id: old.id, update });
  }
  // Saved 20 at a time (a big drive can have thousands of files moved or renamed at once).
  for (let k = 0; k < updates.length; k += 20) {
    await Promise.all(updates.slice(k, k + 20).map((u) => supabase.from("drive_items").update(u.update).eq("id", u.id)));
  }
  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await supabase.from("drive_items").insert(fresh.slice(i, i + 200));
    if (error) throw new Error(`Couldn't save the file list: ${error.message}`);
  }
  // When the listing stopped early, files not reached aren't gone from Drive.
  // (Nor are files inside folders Google wouldn't open this time.)
  const gone = truncated ? [] : [...have.values()].filter((i) => !seen.has(i.drive_id) && i.status !== "removed" && !blocked.some((b) => i.path === b || i.path.startsWith(`${b}/`)));
  if (gone.length) await supabase.from("drive_items").update({ status: "removed" }).in("id", gone.map((i) => i.id));
  const checked = new Date().toISOString();
  // Folder list for exact counts (needs migration 0008; without it, just the check time).
  const { error: savePaths } = await supabase.from("drive_sources").update({ last_checked_at: checked, folder_paths: paths, blocked_paths: blocked }).eq("id", source.id);
  if (savePaths) await supabase.from("drive_sources").update({ last_checked_at: checked }).eq("id", source.id);
  return { added: fresh.filter((f) => f.status === "new").length, changed, removed: gone.length, total: files.length, folders, truncated, blocked };
}
