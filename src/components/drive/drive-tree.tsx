"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, FileText, Folder, Loader2, Play, RefreshCw, Sparkles } from "lucide-react";
import type { DriveItem } from "@/lib/supabase/types";
import { checkDriveLink, setAutoImport, setFolderCourse, setFolderInclude, updateDriveItem } from "@/app/(app)/library/drive/actions";
import { useBackgroundWork } from "@/components/background-work";
import { InfoTip } from "@/components/info-tip";
import { ProgressPct } from "@/components/progress-pct";
import { progressPercent } from "@/components/library/pipeline";
import { docTypes, formatBytes } from "@/lib/library";
import { whenLabel } from "@/lib/dates";
import { Button, Card, cx, inputClass } from "@/components/ui";

type Course = { id: string; name: string };
const statusChip: Record<DriveItem["status"], { label: string; cls: string }> = {
  new: { label: "Not taken", cls: "bg-surface-2 text-muted" },
  changed: { label: "Changed in Drive", cls: "bg-warn/15 text-warn" },
  imported: { label: "In your Library", cls: "bg-ok/15 text-ok" },
  skipped: { label: "Can't be read", cls: "bg-surface-2 text-muted" },
  error: { label: "Problem", cls: "bg-danger/10 text-danger" },
  removed: {
    label: "Deleted in Drive · kept in your Library",
    cls: "bg-surface-2 text-muted",
  },
};

export function DriveTree({
  sourceId,
  items: initial,
  courses,
  autoImport,
  fileStatus,
  linkedAt,
  lastChecked,
  folderPaths = [],
}: {
  sourceId: string;
  items: DriveItem[];
  courses: Course[];
  autoImport: boolean;
  fileStatus: Record<string, string>;
  linkedAt: string;
  lastChecked: string | null;
  // Every folder in the link, empty ones too (saved when Drive is checked), for exact counts.
  folderPaths?: string[];
}) {
  const router = useRouter();
  const { addDriveImports, addProcessJobs, jobs } = useBackgroundWork();
  // Your ticks and choices made on this page, laid over the latest list from the server
  // (so a refresh after "Check for changes" shows new files without losing anything).
  const [overrides, setOverrides] = useState<Record<string, Partial<DriveItem>>>({});
  const items = initial.map((i) => (overrides[i.id] ? { ...i, ...overrides[i.id] } : i));
  const setItems = (fn: (cur: DriveItem[]) => DriveItem[]) => {
    const next = fn(items);
    setOverrides((o) => {
      const copy = { ...o };
      next.forEach((n, k) => {
        if (n !== items[k])
          copy[n.id] = {
            ...copy[n.id],
            include: n.include,
            doc_type: n.doc_type,
            course_id: n.course_id,
          };
      });
      return copy;
    });
  };
  const [filter, setFilter] = useState<"todo" | "all" | "lib" | "skip">("all");
  const [checking, startCheck] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string }>();
  const [auto, setAuto] = useState(autoImport);
  // Looks at Drive again: new files and newer versions show up, and what you picked comes in by itself.
  const check = (quiet: boolean) =>
    startCheck(async () => {
      const r = await checkDriveLink(sourceId);
      if (!quiet || r.error || !/No changes/.test(r.message ?? "")) setNote(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message! });
      if (!r.error && auto) {
        try {
          const c = await (await fetch("/api/drive/check", { cache: "no-store" })).json();
          if (c.items?.length) addDriveImports(c.items);
        } catch {}
      }
      router.refresh();
    });
  // Opening the page checks Drive by itself when the last look was over 15 minutes ago.
  const checkedOnOpen = useRef(false);
  useEffect(() => {
    if (checkedOnOpen.current) return;
    checkedOnOpen.current = true;
    if (!lastChecked || Date.now() - new Date(lastChecked).getTime() > 15 * 60_000) check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Files that appeared in Drive after you added the link (in the last two weeks).
  const [openedAt] = useState(() => Date.now());
  const firstSeen = new Date(linkedAt).getTime() + 10 * 60_000;
  const isNewInDrive = (i: DriveItem) => new Date(i.created_at).getTime() > Math.max(firstSeen, openedAt - 14 * 86_400_000);
  // Latest change in Drive inside each folder (subfolders included; "" = the whole link), worked out once.
  const latestIn = new Map<string, string>();
  for (const i of items) {
    if (!i.modified_time) continue;
    const parts = i.path.split("/").filter(Boolean);
    for (let k = 0; k <= parts.length; k++) {
      const p = parts.slice(0, k).join("/");
      const cur = latestIn.get(p);
      if (!cur || i.modified_time > cur) latestIn.set(p, i.modified_time);
    }
  }
  const lastChange = (path: string) => latestIn.get(path) ?? null;
  // Newest first (like Drive's "Last modified"), or A–Z.
  const [sortBy, setSortBy] = useState<"date" | "name">("date");
  const byDate = (a: string | null, b: string | null) => (b ?? "").localeCompare(a ?? "");

  const patch = (id: string, p: Partial<DriveItem>) => {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...p } : i)));
    void updateDriveItem(id, p as never);
  };
  const toBringAll = items.filter((i) => i.include && (i.status === "new" || i.status === "changed" || i.status === "error"));
  const toBring = toBringAll;
  const active = jobs.filter((j) => ["waiting", "uploading", "reading", "analysing"].includes(j.progress.stage));
  const running = new Set(active.flatMap((j) => [j.driveItemId, j.processFileId, j.id].filter(Boolean) as string[]));
  // Files in your Library that are stored but not processed yet (in a folder, or "" for everything).
  const isStored = (i: DriveItem) => i.status === "imported" && !!i.file_id && fileStatus[i.file_id] === "uploaded";
  const storedIn = (path: string) =>
    items.filter((i) => isStored(i) && !running.has(i.file_id!) && (!path || i.path === path || i.path.startsWith(`${path}/`)));
  const processThese = (list: DriveItem[]) => {
    addProcessJobs(list.map((i) => ({ id: i.file_id!, name: i.name })));
    setNote({
      ok: true,
      text: `Processing ${list.length} file${list.length === 1 ? "" : "s"}. Follow them in the corner panel; you can leave this page.`,
    });
  };

  // How far each file is (0–100): processed = 100 (green), not processed or failed = 0 (red), live while it runs.
  const jobFor = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) for (const k of [j.driveItemId, j.processFileId, j.id]) if (k) jobFor.set(k, j);
  const DONE = ["analysed", "extracted", "no_text"];
  const progressOf = (i: DriveItem): { pct: number; failed: boolean } | null => {
    const job = jobFor.get(i.id) ?? (i.file_id ? jobFor.get(i.file_id) : undefined);
    if (job && job.progress.stage !== "error") return { pct: progressPercent(job.progress), failed: false };
    if (i.status === "skipped") return null;
    if (i.status === "removed" && !i.file_id) return null;
    const fs = i.file_id ? fileStatus[i.file_id] : undefined;
    if (i.file_id && fs && DONE.includes(fs) && i.status !== "changed") return { pct: 100, failed: false };
    return { pct: 0, failed: !!job || i.status === "error" || fs === "failed" };
  };
  const inside = (i: DriveItem, path: string) => !path || i.path === path || i.path.startsWith(`${path}/`);
  // A folder's progress is the average of its files' (subfolders included).
  const folderProgress = (path: string) => {
    const list = items.map((i) => (inside(i, path) ? progressOf(i) : null)).filter((x): x is { pct: number; failed: boolean } => !!x);
    return list.length ? Math.round(list.reduce((t, x) => t + x.pct, 0) / list.length) : null;
  };
  // Exact counts: subfolders and files directly inside a folder, and all files inside it (deleted-in-Drive files left out).
  const allPaths = new Set<string>(folderPaths);
  for (const i of items) {
    const parts = i.path.split("/").filter(Boolean);
    for (let k = 1; k <= parts.length; k++) allPaths.add(parts.slice(0, k).join("/"));
  }
  const counts = (path: string) => {
    const depth = path ? path.split("/").length : 0;
    const subfolders = [...allPaths].filter((p) => p.split("/").length === depth + 1 && (!path || p.startsWith(`${path}/`))).length;
    const present = items.filter((i) => i.status !== "removed");
    return {
      subfolders,
      files: present.filter((i) => i.path === path).length,
      total: present.filter((i) => inside(i, path)).length,
    };
  };
  const countLabel = (path: string) => {
    const c = counts(path);
    const parts = [c.subfolders ? `${c.subfolders} folder${c.subfolders === 1 ? "" : "s"}` : "", `${c.files} file${c.files === 1 ? "" : "s"}`].filter(Boolean);
    return `${parts.join(" · ")}${c.subfolders ? ` · ${c.total} in all` : ""}`;
  };

  const shown = items.filter((i) =>
    filter === "all"
      ? true
      : filter === "lib"
        ? i.status === "imported"
        : filter === "skip"
          ? i.status === "skipped" || i.status === "removed" || !i.include
          : i.status === "new" || i.status === "changed" || i.status === "error",
  );
  // Folders you've opened. Every folder starts closed, and opening one shows its subfolders closed too.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggleFolder = (path: string) =>
    setOpened((cur) => {
      const next = new Set(cur);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  // A folder's contents are hidden unless it and every folder above it are open ("" is the top level, always open).
  const hidden = (path: string) => {
    const parts = path.split("/").filter(Boolean);
    return parts.some((_, k) => !opened.has(parts.slice(0, k + 1).join("/")));
  };
  // Tick state of a folder ("" = the whole link): all, some or none of the files that can be read.
  const within = (path: string) => items.filter((i) => i.status !== "skipped" && (!path || i.path === path || i.path.startsWith(`${path}/`)));
  const tickState = (path: string) => {
    const list = within(path);
    const on = list.filter((i) => i.include).length;
    return {
      state: on === 0 ? "none" : on === list.length ? "all" : "some",
      on,
      total: list.length,
    } as const;
  };
  const tickFolder = (path: string) => {
    const include = tickState(path).state !== "all";
    setItems((cur) =>
      cur.map((i) => (i.status !== "skipped" && (!path || i.path === path || i.path.startsWith(`${path}/`)) ? { ...i, include } : i)),
    );
    void setFolderInclude(sourceId, path, include);
  };
  // Folder tree: every folder path, with the files directly inside it.
  const folders = (() => {
    // Empty folders too, when showing everything.
    const paths = new Set<string>(["", ...(filter === "all" ? folderPaths : [])]);
    for (const i of shown) {
      const parts = i.path.split("/").filter(Boolean);
      for (let k = 1; k <= parts.length; k++) paths.add(parts.slice(0, k).join("/"));
    }
    // Folders under their parent, each level sorted on its own.
    const kids = new Map<string, string[]>();
    for (const p of paths) {
      if (!p) continue;
      const parent = p.split("/").slice(0, -1).join("/");
      kids.set(parent, [...(kids.get(parent) ?? []), p]);
    }
    const order: string[] = [];
    const visit = (p: string) => {
      order.push(p);
      const list = kids.get(p) ?? [];
      list.sort((a, b) => (sortBy === "date" ? byDate(lastChange(a), lastChange(b)) : 0) || a.localeCompare(b));
      list.forEach(visit);
    };
    visit("");
    return order;
  })();
  const filesIn = (path: string) =>
    shown
      .filter((i) => i.path === path)
      .sort((a, b) => (sortBy === "date" ? byDate(a.modified_time, b.modified_time) : 0) || a.name.localeCompare(b.name));
  const courseOfFolder = (path: string) => {
    const inside = items.filter((i) => i.path === path || i.path.startsWith(`${path}/`));
    const ids = new Set(inside.map((i) => i.course_id ?? ""));
    return ids.size === 1 ? [...ids][0] : "mixed";
  };

  // Saves the ticked files in Lengible and processes them (reads them for topics, search, quizzes and flashcards).
  const bring = () => {
    addDriveImports(toBring.map((i) => ({ id: i.id, name: i.name, courseId: i.course_id, changed: i.status === "changed", process: true })));
    setNote({
      ok: true,
      text: `${toBring.length} file${toBring.length === 1 ? "" : "s"} coming in and being processed. Watch the bars fill here or in the corner panel; you can leave this page.`,
    });
  };
  const overall = folderProgress("");
  const nothingYet = !items.some((i) => i.status === "imported");

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        {nothingYet && (
          <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted">
            <li>
              <b className="text-text">Tick</b> the folders and files you want in Lengible (below). Nothing is taken until you choose.
            </li>
            <li>
              Tap <b className="text-text">Bring in &amp; process</b>: they&apos;re saved in Lengible and read for topics, search, quizzes and
              flashcards. Each bar fills to 100% (green) when done.
            </li>
            <li>What you picked stays up to date with Drive.</li>
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
          <Button disabled={!toBring.length} onClick={bring}>
            <Play size={16} /> Bring in &amp; process
            {toBring.length ? ` (${toBring.length})` : ""}
          </Button>
          <InfoTip label="Bring in & process" className="mr-2">
            Saves the ticked files in Lengible and reads them: topics are found and the text is saved, so you can search them, ask Ally and make
            flashcards and quizzes. Nothing is saved or processed until you tap this. PowerPoint and Word files stay linked to Drive (no storage used).
          </InfoTip>
          <Button variant="secondary" disabled={checking} onClick={() => check(false)}>
            {checking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Check for changes
          </Button>
          <InfoTip label="Check for changes">
            Looks at the Google Drive again now for new files, newer versions and deleted files. Lengible also does this by itself every hour while
            it&apos;s open, and when you open this page.
          </InfoTip>
        </div>
        <p className="text-xs text-muted">
          {checking ? "Checking Google Drive for changes…" : lastChecked ? `Last checked ${whenLabel(lastChecked)}.` : "Not checked yet."}
          {(() => {
            const latest = lastChange("");
            const fresh = items.filter((i) => isNewInDrive(i) && i.status !== "removed").length;
            return (
              <>
                {latest ? ` Last change in Drive ${whenLabel(latest)}.` : ""}
                {fresh ? <b className="text-brand"> {fresh} new in Drive since you added the link.</b> : ""}
              </>
            );
          })()}
        </p>
        {!toBring.length && nothingYet && <p className="text-xs text-muted">Tick something below to bring it in.</p>}
        {overall !== null && !nothingYet && (
          <div className="flex items-center gap-2 text-xs text-muted">
            Processed overall <ProgressPct pct={overall} label="Processed overall" />
          </div>
        )}
        {storedIn("").length > 0 && (
          <div className="flex items-center gap-1">
            <Button variant="secondary" onClick={() => processThese(storedIn(""))}>
              <Play size={16} /> Process all stored files ({storedIn("").length})
            </Button>
            <InfoTip label="Process">
              Reads files you brought in but haven&apos;t processed yet: finds their topics and saves their text for search, flashcards and quizzes.
              Each folder and file also has its own Process button.
            </InfoTip>
          </div>
        )}
        <div className="flex items-start gap-1">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked);
                void setAutoImport(sourceId, e.target.checked);
              }}
              className="mt-0.5 size-4 accent-[var(--brand)]"
            />
            <span>Keep what I brought in up to date</span>
          </label>
          <InfoTip label="Keep what I brought in up to date" className="-mt-0.5">
            When Drive changes, newer versions of files you brought in replace the old ones and are processed again, and new files in folders you
            brought in come in and are processed by themselves. Ticking alone never starts anything. Changed timetables and topic lists wait for
            you to review what changed.
          </InfoTip>
        </div>
        {note && <p className={cx("text-sm", note.ok ? "text-muted" : "text-danger")}>{note.text}</p>}
      </Card>

      <div className="flex gap-1 overflow-x-auto text-sm font-medium">
        {(
          [
            ["todo", `Not taken yet (${items.filter((i) => ["new", "changed", "error"].includes(i.status)).length})`],
            ["lib", `In your Library (${items.filter((i) => i.status === "imported").length})`],
            ["skip", `Left out (${items.filter((i) => i.status === "skipped" || i.status === "removed" || !i.include).length})`],
            ["all", `All (${items.length})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={cx("shrink-0 rounded-full px-3 py-1.5", filter === k ? "bg-brand text-on-brand" : "bg-surface-2 text-muted")}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">Nothing here.</p>
      ) : (
        <Card className="divide-y divide-border p-0">
          {(() => {
            const t = tickState("");
            return (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={t.state === "all"}
                  ref={(el) => {
                    if (el) el.indeterminate = t.state === "some";
                  }}
                  onChange={() => tickFolder("")}
                  className="size-4 shrink-0 accent-[var(--brand)]"
                  aria-label="Tick or untick everything"
                />
                <span className="flex-1 font-medium">
                  {t.state === "all" ? "Everything ticked" : t.state === "none" ? "Nothing ticked" : `${t.on} of ${t.total} files ticked`}
                </span>
                <button type="button" onClick={() => tickFolder("")} className="text-xs text-brand underline">
                  {t.state === "all" ? "Select none" : "Select all"}
                </button>
                <label className="flex items-center gap-1 text-xs text-muted">
                  Sort
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "date" | "name")}
                    className={cx(inputClass, "min-h-7 w-auto py-0 text-xs")}
                    aria-label="Sort folders and files"
                  >
                    <option value="date">Newest first</option>
                    <option value="name">Name A–Z</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setOpened(opened.size ? new Set() : new Set(folders.filter(Boolean)))}
                  className="text-xs text-brand underline"
                >
                  {opened.size ? "Collapse all" : "Expand all"}
                </button>
              </div>
            );
          })()}
          {folders.map((path) => {
            if (path && hidden(path.split("/").slice(0, -1).join("/"))) return null;
            const files = hidden(path) ? [] : filesIn(path);
            const depth = path ? path.split("/").length : 0;
            const c = courseOfFolder(path);
            return (
              <div key={path || "top"}>
                {path && (
                  <div className="flex flex-wrap items-center gap-2 bg-surface-2/50 px-4 py-2" style={{ paddingLeft: 8 + (depth - 1) * 14 }}>
                    <button
                      type="button"
                      onClick={() => toggleFolder(path)}
                      className="grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-surface"
                      aria-label={opened.has(path) ? `Fold ${path}` : `Open ${path}`}
                      aria-expanded={opened.has(path)}
                    >
                      {opened.has(path) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    {(() => {
                      const t = tickState(path);
                      return (
                        <input
                          type="checkbox"
                          checked={t.state === "all"}
                          disabled={!t.total}
                          ref={(el) => {
                            if (el) el.indeterminate = t.state === "some";
                          }}
                          onChange={() => tickFolder(path)}
                          className="size-4 shrink-0 accent-[var(--brand)]"
                          aria-label={`Tick everything in ${path}`}
                        />
                      );
                    })()}
                    <Folder size={16} className="shrink-0 text-brand" />
                    <button
                      type="button"
                      onClick={() => toggleFolder(path)}
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                      aria-hidden
                      tabIndex={-1}
                    >
                      {path.split("/").at(-1)}
                      <span className="ml-1.5 text-xs font-normal text-muted">
                        {countLabel(path)}
                        {lastChange(path) ? ` · changed ${whenLabel(lastChange(path)!)}` : ""}
                      </span>
                      {shown.some((i) => (i.path === path || i.path.startsWith(`${path}/`)) && isNewInDrive(i) && i.status !== "removed") && (
                        <span className="ml-1.5 rounded-full bg-brand-soft px-1.5 text-xs font-medium text-brand-strong">New files</span>
                      )}
                    </button>
                    {folderProgress(path) !== null && <ProgressPct pct={folderProgress(path)!} label={`${path.split("/").at(-1)} processed`} />}
                    {storedIn(path).length > 0 && (
                      <button
                        type="button"
                        onClick={() => processThese(storedIn(path))}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand px-2 py-1 text-xs font-medium text-on-brand"
                        title="Process: read these stored files for topics, search, flashcards and quizzes"
                      >
                        <Play size={12} /> Process {storedIn(path).length}
                      </button>
                    )}
                    <select
                      value={c === "mixed" ? "mixed" : c}
                      onChange={async (e) => {
                        const v = e.target.value === "" ? null : e.target.value;
                        setItems((cur) => cur.map((i) => (i.path === path || i.path.startsWith(`${path}/`) ? { ...i, course_id: v } : i)));
                        await setFolderCourse(sourceId, path, v);
                      }}
                      className={cx(inputClass, "ml-14 min-h-8 basis-full py-0 text-xs sm:ml-0 sm:w-auto sm:max-w-[45%] sm:basis-auto")}
                      aria-label={`Course for ${path}`}
                    >
                      {c === "mixed" && <option value="mixed">Several courses</option>}
                      <option value="">General</option>
                      {courses.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {files.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm" style={{ paddingLeft: 16 + depth * 14 }}>
                    <input
                      type="checkbox"
                      checked={i.include}
                      disabled={i.status === "skipped"}
                      onChange={(e) => patch(i.id, { include: e.target.checked })}
                      className="size-4 shrink-0 accent-[var(--brand)]"
                      aria-label={`Include ${i.name}`}
                    />
                    {(() => {
                      const pr = progressOf(i);
                      return pr ? <ProgressPct pct={pr.pct} failed={pr.failed} label={`${i.name} processed`} /> : <span className="w-[86px] shrink-0" />;
                    })()}
                    <FileText size={15} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      {i.file_id && i.status === "imported" ? (
                        <Link href={`/library/file/${i.file_id}`} className="block truncate text-brand underline">
                          {i.name}
                        </Link>
                      ) : (
                        <span className="block truncate">{i.name}</span>
                      )}
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {running.has(i.id) || (i.file_id && running.has(i.file_id)) ? (
                          <span className="inline-flex items-center gap-1 text-brand">
                            <Loader2 size={11} className="animate-spin" /> {running.has(i.id) ? "Bringing in…" : "Processing…"}
                          </span>
                        ) : isStored(i) ? (
                          <>
                            <span className="rounded-full bg-danger/10 px-1.5 text-danger">Saved · not processed</span>
                            <button
                              type="button"
                              onClick={() => processThese([i])}
                              className="inline-flex items-center gap-0.5 font-medium text-brand"
                            >
                              <Play size={11} /> Process
                            </button>
                          </>
                        ) : (
                          i.status !== "imported" && <span className={cx("rounded-full px-1.5", statusChip[i.status].cls)}>{statusChip[i.status].label}</span>
                        )}
                        {isNewInDrive(i) && i.status !== "removed" && (
                          <span className="rounded-full bg-brand px-1.5 font-medium text-on-brand">New in Drive</span>
                        )}
                        {i.size_bytes ? formatBytes(i.size_bytes) : null}
                        {i.modified_time && <span>· modified {whenLabel(i.modified_time)}</span>}
                        {i.error && <span className={i.status === "error" ? "text-danger" : ""}>{i.error}</span>}
                      </span>
                    </span>
                    {i.status !== "skipped" && (
                      <select
                        value={i.doc_type}
                        onChange={(e) => patch(i.id, { doc_type: e.target.value })}
                        className={cx(inputClass, "ml-12 min-h-8 basis-full py-0 text-xs sm:ml-0 sm:w-32 sm:basis-auto")}
                        aria-label={`Type of ${i.name}`}
                      >
                        {docTypes.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </Card>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted">
        <Sparkles size={13} className="mt-0.5 shrink-0" /> Each Drive folder becomes a Library folder under its course. Timetables and topic lists are
        read and then wait for your review; when one changes in Drive you&apos;ll see exactly what changed before anything updates.
      </p>
      {items.some((i) => i.status === "error") && (
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <CircleAlert size={13} className="mt-0.5 shrink-0" /> Files marked “Problem” are tried again when you tap Bring in.
        </p>
      )}
      {!nothingYet && items.every((i) => i.status === "imported" || i.status === "skipped" || !i.include) && (
        <p className="flex items-center gap-1.5 text-sm text-ok">
          <CheckCircle2 size={16} /> Everything you chose is in your Library.
        </p>
      )}
    </div>
  );
}
