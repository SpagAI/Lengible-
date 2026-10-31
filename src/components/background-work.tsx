"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, CircleStop, GripVertical, Loader2, Maximize2, Minimize2, Pause, Play, RotateCcw, Server, Trash2, Upload } from "lucide-react";
import { useSupabase } from "@/lib/supabase/client";
import { createFileRecord } from "@/app/(app)/library/actions";
import { progressPercent, type Progress } from "@/components/library/pipeline";
import { ProgressPct } from "@/components/progress-pct";
import { StageIcon } from "@/components/library/upload-panel";
import { cx } from "@/components/ui";
import { PART_SIZE } from "@/lib/library";

// Processing happens on the server, in a queue (see src/lib/jobs.ts): it keeps going with Lengible closed,
// and pausing, a lost connection or a retry continues from the last finished step. This provider sends work
// to that queue, shows it in a small panel in the corner (minimisable to a round button) with Pause, Stop,
// Resume and Retry, and nudges the queue while Lengible is open so it starts straight away.
// Files chosen on this device are uploaded from here first.

export type UploadJob = {
  key: string;
  batch: string;
  name: string;
  file?: File;
  driveItemId?: string | null;
  processFileId?: string | null;
  type: string;
  courseId: string | null;
  folderId: string | null;
  topicId: string | null;
  id?: string | null;
  progress: Progress;
  // Server jobs: how far along (0–100) and their queue state.
  percent?: number;
  server?: ServerJob;
};
type NewUpload = Omit<UploadJob, "key" | "progress" | "id" | "name" | "driveItemId" | "processFileId" | "file" | "percent" | "server"> & { file: File };
export type DriveImport = { id: string; name: string; courseId: string | null; changed?: boolean; process?: boolean };
export type StoredFile = { id: string; name: string };

export type ServerJob = {
  id: string;
  name: string;
  fileId: string | null;
  driveItemId: string | null;
  state: "queued" | "paused" | "stopped" | "done" | "failed";
  step: string;
  percent: number;
  running: boolean;
  started?: boolean;
  waitingUntil: string | null;
  note: string | null;
  error: string | null;
  done: number | null;
  total: number | null;
  finishedAt: string | null;
};

const Ctx = createContext<{
  jobs: UploadJob[];
  addUploads: (items: NewUpload[]) => void;
  addDriveImports: (items: DriveImport[]) => void;
  addProcessJobs: (files: StoredFile[], again?: boolean) => void;
  control: (action: "pause" | "resume" | "stop" | "retry" | "remove" | "retry-waiting", ids?: string[]) => Promise<void>;
} | null>(null);
export const useBackgroundWork = () => useContext(Ctx)!;

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k) === "1";
    } catch {
      return false;
    }
  },
  set: (k: string, v: boolean) => {
    try {
      localStorage.setItem(k, v ? "1" : "0");
    } catch {}
  },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STEP_TEXT: Record<string, string> = {
  copy: "Bringing in from Drive",
  text: "Reading the text",
  pictures: "Reading picture pages with AI",
  analyse: "Finding topics, drugs and diseases",
  profile: "Working out what it is",
  questions: "Saving its past questions",
  embed: "Indexing for search by meaning",
  done: "Done",
};

// A server job in the shape the rest of the app uses (progress stage + percent).
function fromServer(j: ServerJob): UploadJob {
  const stage: Progress["stage"] =
    j.state === "done" ? "done" : j.state === "failed" ? "error" : j.state === "paused" || j.state === "stopped" ? "paused" : j.running ? "analysing" : "waiting";
  return {
    key: j.id,
    batch: "server",
    name: j.name,
    driveItemId: j.driveItemId,
    processFileId: j.fileId,
    id: j.fileId,
    type: "",
    courseId: null,
    folderId: null,
    topicId: null,
    progress: { stage, message: j.error ?? j.note ?? undefined, done: j.done ?? undefined, total: j.total ?? undefined },
    percent: j.percent,
    server: j,
  };
}

async function post(url: string, body?: unknown) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return await res.json().catch(() => ({}));
  } catch {
    return {};
  }
}

export function BackgroundWorkProvider({ children }: { children: ReactNode }) {
  const supabase = useSupabase();
  const router = useRouter();
  // Uploads from this device (until they're handed to the server queue).
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const uploadsRef = useRef<UploadJob[]>([]);
  const [server, setServer] = useState<ServerJob[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const uploading = useRef(false);
  const wakeRef = useRef<() => void>(() => {});

  const updateUpload = useCallback((key: string, patch: Partial<UploadJob>) => {
    uploadsRef.current = uploadsRef.current.map((j) => (j.key === key ? { ...j, ...patch } : j));
    setUploads(uploadsRef.current);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await (await fetch("/api/jobs", { cache: "no-store" })).json();
      setServer(r.jobs ?? []);
      setSummary(r.summary ?? null);
      setSetupNeeded(!!r.setup);
      return (r.jobs ?? []) as ServerJob[];
    } catch {
      return null;
    }
  }, []);

  const enqueue = useCallback(
    async (items: { fileId?: string; driveItemId?: string; name: string; again?: boolean }[]) => {
      if (!items.length) return;
      await post("/api/jobs", { action: "enqueue", items });
      await refresh();
      wakeRef.current();
    },
    [refresh],
  );

  // Uploads one at a time from this device, then queues each for processing on the server.
  const pumpUploads = useCallback(async () => {
    if (uploading.current) return;
    uploading.current = true;
    try {
      for (;;) {
        const job = uploadsRef.current.find((j) => j.progress.stage === "waiting");
        if (!job) break;
        const file = job.file!;
        updateUpload(job.key, { progress: { stage: "uploading", step: "upload" } });
        const record = await createFileRecord({ courseId: job.courseId, folderId: job.folderId, topicId: job.topicId, name: file.name, docType: job.type, mime: file.type, size: file.size });
        if ("error" in record) {
          updateUpload(job.key, { progress: { stage: "error", message: record.error } });
          continue;
        }
        // A file over 50 MB goes up in 45 MB pieces (joined back exactly when it's read).
        let error: { message: string } | null = null;
        if (record.parts) {
          for (let k = 0; k < record.parts.length && !error; k++) {
            updateUpload(job.key, { progress: { stage: "uploading", step: "upload", message: `Uploading part ${k + 1} of ${record.parts.length}`, done: k, total: record.parts.length } });
            const piece = file.slice(k * PART_SIZE, (k + 1) * PART_SIZE);
            ({ error } = await supabase.storage.from("library").upload(record.parts[k], piece, { contentType: "application/octet-stream", upsert: true }));
          }
        } else ({ error } = await supabase.storage.from("library").upload(record.path, file, { contentType: file.type || undefined, upsert: true }));
        if (error) {
          updateUpload(job.key, { id: record.id, progress: { stage: "error", message: error.message.includes("exceeded") ? "File is bigger than the 50 MB limit." : `Upload failed: ${error.message}` } });
          continue;
        }
        updateUpload(job.key, { id: record.id, progress: { stage: "done", message: "Uploaded. Processing on the server." } });
        await enqueue([{ fileId: record.id, name: file.name }]);
        router.refresh();
      }
    } finally {
      uploading.current = false;
    }
  }, [supabase, updateUpload, enqueue, router]);

  const addUploads = useCallback(
    (items: NewUpload[]) => {
      const added = items.map((i) => ({ ...i, name: i.file.name, key: crypto.randomUUID(), progress: { stage: "waiting" as const } }));
      uploadsRef.current = [...uploadsRef.current, ...added];
      setUploads(uploadsRef.current);
      void pumpUploads();
    },
    [pumpUploads],
  );
  const addDriveImports = useCallback(
    (items: DriveImport[]) => void enqueue(items.map((i) => ({ driveItemId: i.id, name: i.changed ? `${i.name} (newer version)` : i.name, again: i.changed }))),
    [enqueue],
  );
  const addProcessJobs = useCallback((files: StoredFile[], again?: boolean) => void enqueue(files.map((f) => ({ fileId: f.id, name: f.name, again }))), [enqueue]);
  const control = useCallback(
    async (action: "pause" | "resume" | "stop" | "retry" | "remove" | "retry-waiting", ids?: string[]) => {
      await post("/api/jobs", ids ? { action, ids } : { action, all: true });
      await refresh();
      if (action === "resume" || action === "retry" || action === "retry-waiting") wakeRef.current();
    },
    [refresh],
  );

  // Watches the queue: quickly while work is going on, slowly otherwise. While there's work waiting, it also
  // nudges the server to carry on now (the minute-by-minute worker does the same with Lengible closed).
  useEffect(() => {
    let stop = false;
    let kicking = false;
    const kick = async () => {
      if (kicking) return;
      kicking = true;
      await post("/api/worker/kick");
      kicking = false;
    };
    (async () => {
      await sleep(1500);
      let lastActive = 0;
      while (!stop) {
        const jobs = await refresh();
        const waiting = (jobs ?? []).filter((j) => j.state === "queued");
        const ready = waiting.filter((j) => !j.running && (!j.waitingUntil || new Date(j.waitingUntil).getTime() <= Date.now()));
        if (ready.length) void kick();
        if (waiting.length < lastActive) router.refresh();
        lastActive = waiting.length;
        await new Promise<void>((r) => {
          const t = setTimeout(r, waiting.length ? 4000 : 30_000);
          wakeRef.current = () => {
            clearTimeout(t);
            r();
          };
        });
      }
    })();
    return () => {
      stop = true;
    };
  }, [refresh, router]);

  // Drive links are checked when Lengible opens and every hour while it's open (changes go into the queue).
  useEffect(() => {
    let stop = false;
    (async () => {
      await sleep(8000);
      while (!stop) {
        try {
          const r = await (await fetch("/api/drive/check", { cache: "no-store" })).json();
          if (!stop && r.queued) wakeRef.current();
        } catch {}
        await sleep(3600_000);
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  // Closing the tab stops an upload from this device (server processing carries on); warn first.
  const uploadingNow = uploads.some((j) => ["waiting", "uploading"].includes(j.progress.stage));
  useEffect(() => {
    if (!uploadingNow) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploadingNow]);

  const jobs = [...uploads, ...server.map(fromServer)];

  return (
    <Ctx.Provider value={{ jobs, addUploads, addDriveImports, addProcessJobs, control }}>
      {children}
      <Dock
        uploads={uploads}
        server={server}
        summary={summary}
        setupNeeded={setupNeeded}
        control={control}
        onClear={async () => {
          uploadsRef.current = uploadsRef.current.filter((j) => ["waiting", "uploading"].includes(j.progress.stage));
          setUploads(uploadsRef.current);
          await post("/api/jobs", { action: "clear" });
          await refresh();
        }}
      />
    </Ctx.Provider>
  );
}

function JobButtons({ job, control }: { job: ServerJob; control: (a: "pause" | "resume" | "stop" | "retry" | "remove" | "retry-waiting", ids?: string[]) => Promise<void> }) {
  const btn = "grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text";
  return (
    <span className="flex shrink-0 items-center">
      {job.state === "queued" && (
        <button type="button" className={btn} onClick={() => control("pause", [job.id])} aria-label={`Pause ${job.name}`} title="Pause">
          <Pause size={14} />
        </button>
      )}
      {(job.state === "paused" || job.state === "stopped") && (
        <button type="button" className={btn} onClick={() => control("resume", [job.id])} aria-label={`Resume ${job.name}`} title="Resume from where it stopped">
          <Play size={14} />
        </button>
      )}
      {(job.state === "queued" || job.state === "paused") && (
        <button type="button" className={btn} onClick={() => control("stop", [job.id])} aria-label={`Stop ${job.name}`} title="Stop (keeps what's done)">
          <CircleStop size={14} />
        </button>
      )}
      {(job.state === "failed" || (job.state === "queued" && !!job.waitingUntil)) && (
        <button type="button" className={btn} onClick={() => control("retry", [job.id])} aria-label={`Retry ${job.name}`} title="Retry now from the step where it stopped">
          <RotateCcw size={14} />
        </button>
      )}
      {(job.state === "failed" || job.state === "stopped") && (
        <button type="button" className={btn} onClick={() => control("remove", [job.id])} aria-label={`Remove ${job.name} from the list`} title="Remove from the list (the file stays)">
          <Trash2 size={14} />
        </button>
      )}
    </span>
  );
}

// Totals over every job in the queue (the list itself shows at most 300).
type Summary = { total: number; active: number; waiting: number; paused: number; failed: number; done: number; percent: number };

function Dock({
  uploads,
  server,
  setupNeeded,
  summary,
  control,
  onClear,
}: {
  uploads: UploadJob[];
  server: ServerJob[];
  setupNeeded: boolean;
  summary: Summary | null;
  control: (a: "pause" | "resume" | "stop" | "retry" | "remove" | "retry-waiting", ids?: string[]) => Promise<void>;
  onClear: () => void;
}) {
  const [small, setSmall] = useState(() => store.get("lengible:dock-small"));
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Width: drag the left edge (or tap Widen) to see full file names. Remembered on this device.
  const NARROW = 380;
  const widest = () => (typeof window === "undefined" ? 1200 : Math.max(NARROW, window.innerWidth - 32));
  const [width, setWidth] = useState(() => {
    try {
      return Math.min(widest(), Math.max(320, Number(localStorage.getItem("lengible:dock-width")) || NARROW));
    } catch {
      return NARROW;
    }
  });
  const saveWidth = (w: number) => {
    const v = Math.round(Math.min(widest(), Math.max(320, w)));
    setWidth(v);
    try {
      localStorage.setItem("lengible:dock-width", String(v));
    } catch {}
  };
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => saveWidth(startW + (startX - ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // The diagonal arrows step through three sizes: small → medium → large → small.
  const sizes = { small: NARROW, medium: Math.min(680, widest()), large: widest() };
  const size: keyof typeof sizes = width < (sizes.small + sizes.medium) / 2 ? "small" : width < (sizes.medium + sizes.large) / 2 ? "medium" : "large";
  const nextSize = ({ small: "medium", medium: "large", large: "small" } as const)[size];
  const minimise = (v: boolean) => {
    setSmall(v);
    store.set("lengible:dock-small", v);
  };
  // When files change place (one finishes and drops to the green list, the next moves up), they slide there.
  const rowEls = useRef(new Map<string, HTMLElement>());
  const lastTop = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const seen = new Map<string, number>();
    for (const [key, el] of rowEls.current) {
      if (!el.isConnected) continue;
      const top = el.offsetTop;
      seen.set(key, top);
      const before = lastTop.current.get(key);
      if (before !== undefined && before !== top && typeof el.animate === "function") {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], { duration: 450, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
    lastTop.current = seen;
  });
  const active = server.filter((j) => j.state === "queued");
  const sending = uploads.filter((j) => ["waiting", "uploading"].includes(j.progress.stage));
  const paused = server.filter((j) => j.state === "paused" || j.state === "stopped");
  const failed = server.filter((j) => j.state === "failed");
  const finished = server.filter((j) => j.state === "done").length + uploads.filter((u) => !["waiting", "uploading"].includes(u.progress.stage)).length;
  if (!uploads.length && !server.length && !setupNeeded) return null;
  // Order: the files being worked on (at most 3) at the top, then those waiting their turn (smallest first),
  // then paused/stopped and failed ones, and finished ones (green) at the bottom, the newest first.
  const group = (j: ServerJob) => (j.state === "queued" ? (j.started || j.running ? 0 : 1) : j.state === "paused" || j.state === "stopped" ? 2 : j.state === "failed" ? 3 : 4);
  const all = [...server].sort((a, b) => group(a) - group(b) || (group(a) === 4 ? (b.finishedAt ?? "").localeCompare(a.finishedAt ?? "") : 0));
  const GROUP_LABEL = ["Working on now", "Waiting their turn", "Paused or stopped", "Need attention", "Finished"];
  // Exact numbers come from the server's totals; the list below may be only the first 300.
  const overall = summary?.total ? summary.percent : server.length ? server.reduce((t, j) => t + j.percent, 0) / server.length : 0;
  const nActive = summary?.active ?? active.length;
  const nFailed = summary?.failed ?? failed.length;
  const nPaused = summary?.paused ?? paused.length;
  const nWaiting = summary?.waiting ?? server.filter((j) => j.state === "queued" && j.waitingUntil).length;
  const working = active.length > 0 || sending.length > 0;
  const position = "fixed right-3 bottom-[calc(76px+env(safe-area-inset-bottom,0px))] z-30 md:right-6 md:bottom-6";

  if (small) {
    return (
      <button
        type="button"
        onClick={() => minimise(false)}
        className={cx(position, "grid size-12 place-items-center rounded-full border border-border bg-surface shadow-lg")}
        aria-label="Show processing progress"
        title={`${nActive} processing · ${Math.round(overall)}%`}
      >
        <svg viewBox="0 0 36 36" className="absolute inset-1 -rotate-90" aria-hidden="true">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-surface-2)" strokeWidth="3" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-brand)" strokeWidth="3" strokeDasharray={`${(overall / 100) * 97.4} 97.4`} strokeLinecap="round" />
        </svg>
        {sending.length ? <Upload size={16} className="text-brand" /> : <Server size={16} className="text-brand" />}
        {nFailed || nPaused || nWaiting ? (
          <span className="absolute top-0.5 right-0.5 size-3 rounded-full bg-warn ring-2 ring-surface" />
        ) : (
          working && <span className="absolute top-0.5 right-0.5 size-3 animate-pulse rounded-full bg-brand ring-2 ring-surface" />
        )}
      </button>
    );
  }

  return (
    <div className={cx(position, "max-w-[calc(100vw-1.5rem)]")} style={{ width }}>
      {/* A handle on the left edge, outside the panel's content: drag it left to widen, right to narrow. */}
      <div
        onPointerDown={startDrag}
        className="group absolute top-1/2 -left-2.5 z-10 grid h-14 w-5 -translate-y-1/2 cursor-ew-resize touch-none place-items-center rounded-full border border-border bg-surface shadow-md hover:border-brand hover:bg-brand-soft"
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize the panel"
        title="Drag to widen or narrow"
      >
        <GripVertical size={14} className="text-muted group-hover:text-brand" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface/95 text-xs shadow-lg backdrop-blur">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {working ? <Loader2 size={14} className="animate-spin text-brand" /> : <Server size={14} className="text-brand" />}
        <span className="min-w-0 flex-1 font-semibold">
          {sending.length ? `Uploading ${sending.length} · ` : ""}
          {nActive
            ? `Processing ${nActive} file${nActive > 1 ? "s" : ""}`
            : nPaused
              ? `${nPaused} paused`
              : nFailed
                ? `${nFailed} need${nFailed === 1 ? "s" : ""} attention`
                : "Processing finished"}
          <span className="block text-[11px] font-normal text-muted">
            {summary ? `${summary.done} done${nWaiting ? ` · ${nWaiting} waiting after a problem` : ""}${nFailed ? ` · ${nFailed} failed` : ""} · ` : ""}on the server, keeps going with Lengible closed
          </span>
        </span>
        {(summary?.total ?? server.length) > 0 && <ProgressPct pct={overall} label="All files in the queue" />}
        <button
          type="button"
          onClick={() => saveWidth(sizes[nextSize])}
          className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-2"
          aria-label={`Panel size: ${size}. Change to ${nextSize}`}
          title={`Size: ${size} (tap for ${nextSize})`}
        >
          {size === "large" ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button type="button" onClick={() => minimise(true)} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Minimise">
          <ChevronDown size={16} />
        </button>
      </div>
      {(nActive > 0 || nPaused > 0 || nFailed > 0) && (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-1.5">
          {nActive > 0 && (
            <button type="button" onClick={() => control("pause")} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium hover:bg-surface-2">
              <Pause size={13} /> Pause all
            </button>
          )}
          {nPaused > 0 && (
            <button type="button" onClick={() => control("resume")} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-brand hover:bg-surface-2">
              <Play size={13} /> Resume all ({nPaused})
            </button>
          )}
          {nWaiting + nFailed > 0 && (
            <button type="button" onClick={() => control("retry-waiting")} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-brand hover:bg-surface-2" title="Try again now, from the step each file reached">
              <RotateCcw size={13} /> Retry now ({nWaiting + nFailed})
            </button>
          )}
        </div>
      )}
      {setupNeeded && (
        <p className="border-b border-border px-3 py-2 text-warn">
          Server processing needs one setup step: run supabase/migrations/0009_server_processing.sql in Supabase.
        </p>
      )}
      {summary && summary.total > server.length && (
        <p className="border-b border-border px-3 py-1.5 text-muted">Showing the first {server.length} of {summary.total} files.</p>
      )}
      <ul className="max-h-[min(60vh,480px)] divide-y divide-border overflow-y-auto">
        {uploads.map((j) => (
          <li key={j.key} className="flex items-start gap-2 px-3 py-2">
            <StageIcon stage={j.progress.stage} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium break-words" title={j.name}>
                      {j.name}
                    </span>
              <span className={cx("block", j.progress.stage === "error" ? "text-danger" : "text-muted")}>
                {j.progress.stage === "uploading" ? (j.progress.message ?? "Uploading from this device…") : j.progress.stage === "waiting" ? "Waiting to upload" : j.progress.message}
              </span>
            </span>
            <ProgressPct pct={progressPercent(j.progress) === 100 ? 10 : progressPercent(j.progress)} failed={j.progress.stage === "error"} className="mt-0.5" />
          </li>
        ))}
        {all.flatMap((j, k) => {
          const open = openKey === j.id;
          const g = group(j);
          const heading =
            k === 0 || group(all[k - 1]) !== g ? (
              <li key={`group-${g}`} className="sticky top-0 z-[1] bg-surface-2/95 px-3 py-1 text-[10px] font-semibold tracking-wide text-muted uppercase backdrop-blur">
                {GROUP_LABEL[g]} ({all.filter((x) => group(x) === g).length})
              </li>
            ) : null;
          return [
            heading,
            <li
              key={j.id}
              ref={(el) => {
                if (el) rowEls.current.set(j.id, el);
                else rowEls.current.delete(j.id);
              }}
              className={cx("px-3 py-2 transition-colors duration-700", j.state === "done" && "bg-ok/10")}
            >
              <div className="flex items-start gap-2">
                <button type="button" onClick={() => setOpenKey(open ? null : j.id)} className="flex min-w-0 flex-1 items-start gap-2 text-left" aria-expanded={open}>
                  <StageIcon stage={fromServer(j).progress.stage} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium break-words" title={j.name}>
                      {j.name}
                    </span>
                    <span className={cx("block", j.state === "failed" ? "line-clamp-3 text-danger" : j.state === "done" ? "font-medium text-ok" : "truncate text-muted")}>
                      {j.state === "done"
                        ? "Processed ✓"
                        : j.state === "failed"
                          ? `Couldn't be processed (stopped at “${STEP_TEXT[j.step] ?? j.step}”): ${j.error ?? "unknown problem"}. Other files carry on. Fix the cause if you can, then tap Retry.`
                          : j.state === "paused"
                            ? `Paused at “${STEP_TEXT[j.step] ?? j.step}”`
                            : j.state === "stopped"
                              ? `Stopped at “${STEP_TEXT[j.step] ?? j.step}”`
                              : j.waitingUntil
                                ? j.note ?? "Waiting to carry on"
                                : j.running
                                  ? `${STEP_TEXT[j.step] ?? j.step}${j.total ? ` · ${j.done ?? 0} of ${j.total}` : ""}`
                                  : j.started
                                    ? `Carrying on with “${STEP_TEXT[j.step] ?? j.step}”`
                                    : "Waiting its turn (3 files at a time, smallest first)"}
                    </span>
                  </span>
                </button>
                <ProgressPct pct={j.percent} failed={j.state === "failed"} className="mt-0.5" />
                <JobButtons job={j} control={control} />
              </div>
              {open && (
                <div className="mt-2 space-y-1 rounded-lg bg-surface-2 p-2 text-[11px]">
                  <ol className="space-y-0.5">
                    {["copy", "text", "pictures", "analyse", "profile", "questions", "embed"].map((s) => {
                      const order = ["copy", "text", "pictures", "analyse", "profile", "questions", "embed", "done"];
                      const doneStep = order.indexOf(s) < order.indexOf(j.step) || j.state === "done";
                      const now = s === j.step && j.state !== "done";
                      return (
                        <li key={s} className={cx("flex items-center gap-1.5", doneStep ? "text-ok" : now ? "font-medium text-text" : "text-muted")}>
                          <span className={cx("size-1.5 rounded-full", doneStep ? "bg-ok" : now ? "bg-brand" : "bg-border")} />
                          {STEP_TEXT[s]}
                          {now && j.total ? ` (${j.done ?? 0}/${j.total})` : ""}
                        </li>
                      );
                    })}
                  </ol>
                  {j.note && j.state !== "done" && <p className="text-muted">{j.note}</p>}
                  <p className="text-muted">Steps already done are never redone: pausing, a lost connection or a retry continue from the current step.</p>
                  {j.fileId && (
                    <Link href={`/library/file/${j.fileId}`} className="inline-block font-medium text-brand">
                      Open file →
                    </Link>
                  )}
                </div>
              )}
            </li>,
          ];
        })}
      </ul>
      {finished > 0 && (
        <button type="button" onClick={onClear} className="flex w-full items-center gap-1 border-t border-border px-3 py-1.5 text-left text-muted hover:bg-surface-2">
          <ChevronRight size={12} /> Clear finished ({finished})
        </button>
      )}
      </div>
    </div>
  );
}
