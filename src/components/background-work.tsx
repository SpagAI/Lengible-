"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, ChevronDown, ChevronRight, Loader2, Pause, Play, Upload } from "lucide-react";
import { useSupabase } from "@/lib/supabase/client";
import { createFileRecord } from "@/app/(app)/library/actions";
import { runDrivePipeline, runPipeline, type Progress } from "@/components/library/pipeline";
import { StageIcon } from "@/components/library/upload-panel";
import { ProcessDetails } from "@/components/process-details";
import { postJSON } from "@/lib/fetch-json";
import { cx } from "@/components/ui";

// Uploads and AI reading live here, above every page, so they keep going while you use the rest of
// Lengible. A small panel in the corner shows progress and can be minimised to a round button.

export type UploadJob = {
  key: string;
  batch: string;
  name: string;
  // A file chosen on this device, or one to bring in from a Google Drive link.
  file?: File;
  driveItemId?: string;
  // Process a file already stored in Lengible (brought in from Drive, or an upload that stopped).
  processFileId?: string;
  // For Drive files: read it now (otherwise it is only stored until you tap Process).
  process?: boolean;
  type: string;
  courseId: string | null;
  folderId: string | null;
  topicId: string | null;
  id?: string;
  progress: Progress;
};
type NewUpload = Omit<UploadJob, "key" | "progress" | "id" | "name" | "driveItemId" | "processFileId" | "process" | "file"> & { file: File };
export type DriveImport = { id: string; name: string; courseId: string | null; changed?: boolean; process?: boolean };
export type StoredFile = { id: string; name: string };
type Reading = { id: string; name: string; cursor: number; total: number; left: number; note?: string; retryAt?: number } | null;

const Ctx = createContext<{
  jobs: UploadJob[];
  addUploads: (items: NewUpload[]) => void;
  addDriveImports: (items: DriveImport[]) => void;
  addProcessJobs: (files: StoredFile[]) => void;
} | null>(null);
export const useBackgroundWork = () => useContext(Ctx)!;

const ACTIVE: Progress["stage"][] = ["waiting", "uploading", "reading", "analysing"];
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

export function BackgroundWorkProvider({ children }: { children: ReactNode }) {
  const supabase = useSupabase();
  const router = useRouter();
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const jobsRef = useRef<UploadJob[]>([]);
  const running = useRef(false);

  // Keeps the ref in step at once, so the upload loop never sees a stale stage.
  const update = useCallback((key: string, patch: Partial<UploadJob>) => {
    jobsRef.current = jobsRef.current.map((j) => (j.key === key ? { ...j, ...patch } : j));
    setJobs(jobsRef.current);
  }, []);

  // Drive: the server copies the file into your storage, then this device reads it like an upload.
  const bringInFromDrive = useCallback(
    async (job: UploadJob) => {
      const first = await postJSON<{
        status: string;
        message?: string;
        fileId?: string;
        path?: string;
        name?: string;
        mime?: string;
        courseId?: string | null;
        url?: string;
        wasProcessed?: boolean;
        linkOnly?: boolean;
      }>(`/api/drive/items/${job.driveItemId}/import`);
      let r = first;
      // Network drops and server hiccups get one more try; real problems (not shared, too big…) don't.
      if (r.status === "error" && /connection|server had a problem|took too long|Couldn't bring this file in/i.test(r.message ?? "")) {
        await new Promise((res) => setTimeout(res, 4000));
        r = await postJSON<typeof first>(`/api/drive/items/${job.driveItemId}/import`);
      }
      if (r.status !== "ok" || (!r.url && !r.linkOnly)) {
        update(job.key, { progress: { stage: r.status === "busy" ? "done" : "error", message: r.status === "busy" ? "Already brought in elsewhere." : r.message } });
        return;
      }
      if (!job.process && !r.wasProcessed) {
        // Stored only: it waits in your Library until you tap Process.
        await postJSON(`/api/drive/items/${job.driveItemId}/done`);
        update(job.key, { id: r.fileId, progress: { stage: "done", message: r.linkOnly ? "Linked from Drive. Tap Process when you need it." : "Stored. Tap Process when you need it." } });
        router.refresh();
        return;
      }
      if (r.linkOnly) {
        update(job.key, { id: r.fileId });
        await runDrivePipeline(r.fileId!, (progress) => update(job.key, { progress }));
        await postJSON(`/api/drive/items/${job.driveItemId}/done`);
        return;
      }
      update(job.key, { id: r.fileId, progress: { stage: "uploading", step: "upload", message: "Copied from Google Drive" } });
      let file: File;
      try {
        const blob = await (await fetch(r.url!)).blob();
        file = new File([blob], r.name!, { type: r.mime });
      } catch {
        update(job.key, { progress: { stage: "error", message: "Couldn't open the copied file. Try again from the Drive page." } });
        return;
      }
      await runPipeline(supabase, file, { id: r.fileId!, path: r.path! }, r.courseId ?? null, (progress) => update(job.key, { progress }), { uploaded: true });
      await postJSON(`/api/drive/items/${job.driveItemId}/done`);
    },
    [supabase, update, router],
  );

  // Process a stored file: read it from the start, the same way as an upload.
  const processStored = useCallback(
    async (job: UploadJob) => {
      const r = await postJSON<{ status: string; message?: string; url?: string; name?: string; mime?: string; path?: string; courseId?: string | null; linkOnly?: boolean }>(
        `/api/files/${job.processFileId}/prepare`,
      );
      if (r.status === "ok" && r.linkOnly) {
        update(job.key, { id: job.processFileId });
        await runDrivePipeline(job.processFileId!, (progress) => update(job.key, { progress }));
        return;
      }
      if (r.status !== "ok" || !r.url) {
        update(job.key, { progress: { stage: "error", message: r.message ?? "Couldn't open the stored file." } });
        return;
      }
      update(job.key, { id: job.processFileId });
      let file: File;
      try {
        const blob = await (await fetch(r.url)).blob();
        file = new File([blob], r.name!, { type: r.mime || blob.type });
      } catch {
        update(job.key, { progress: { stage: "error", message: "Couldn't download the stored file. Check your connection and try again." } });
        return;
      }
      await runPipeline(supabase, file, { id: job.processFileId!, path: r.path! }, r.courseId ?? null, (progress) => update(job.key, { progress }), { uploaded: true });
    },
    [supabase, update],
  );

  // Works through waiting uploads one at a time.
  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const job = jobsRef.current.find((j) => j.progress.stage === "waiting");
        if (!job) break;
        update(job.key, { progress: { stage: "uploading", step: "upload" } });
        if (job.driveItemId) {
          await bringInFromDrive(job);
          continue;
        }
        if (job.processFileId) {
          await processStored(job);
          router.refresh();
          continue;
        }
        const file = job.file!;
        const record = await createFileRecord({
          courseId: job.courseId,
          folderId: job.folderId,
          topicId: job.topicId,
          name: file.name,
          docType: job.type,
          mime: file.type,
          size: file.size,
        });
        if ("error" in record) {
          update(job.key, { progress: { stage: "error", message: record.error } });
          continue;
        }
        update(job.key, { id: record.id });
        await runPipeline(supabase, file, record as { id: string; path: string }, job.courseId, (progress) => update(job.key, { progress }));
        router.refresh();
      }
    } finally {
      running.current = false;
    }
  }, [supabase, router, update, bringInFromDrive, processStored]);

  const addUploads = useCallback(
    (items: NewUpload[]) => {
      const added = items.map((i) => ({ ...i, name: i.file.name, key: crypto.randomUUID(), progress: { stage: "waiting" as const } }));
      jobsRef.current = [...jobsRef.current, ...added];
      setJobs(jobsRef.current);
      void pump();
    },
    [pump],
  );

  const addDriveImports = useCallback(
    (items: DriveImport[]) => {
      // Skip anything already queued in this tab.
      const queued = new Set(jobsRef.current.filter((j) => ACTIVE.includes(j.progress.stage)).map((j) => j.driveItemId));
      const added = items
        .filter((i) => !queued.has(i.id))
        .map((i) => ({
          key: crypto.randomUUID(),
          batch: "drive",
          name: i.changed ? `${i.name} (newer version)` : i.name,
          driveItemId: i.id,
          process: i.process,
          type: "",
          courseId: i.courseId,
          folderId: null,
          topicId: null,
          progress: { stage: "waiting" as const },
        }));
      if (!added.length) return;
      jobsRef.current = [...jobsRef.current, ...added];
      setJobs(jobsRef.current);
      void pump();
    },
    [pump],
  );

  const addProcessJobs = useCallback(
    (files: StoredFile[]) => {
      const queued = new Set(jobsRef.current.filter((j) => ACTIVE.includes(j.progress.stage)).map((j) => j.processFileId));
      const added = files
        .filter((f) => !queued.has(f.id))
        .map((f) => ({
          key: crypto.randomUUID(),
          batch: "process",
          name: f.name,
          processFileId: f.id,
          type: "",
          courseId: null,
          folderId: null,
          topicId: null,
          progress: { stage: "waiting" as const },
        }));
      if (!added.length) return;
      jobsRef.current = [...jobsRef.current, ...added];
      setJobs(jobsRef.current);
      void pump();
    },
    [pump],
  );

  // Your Drive links are checked when Lengible opens and then every hour while it's open: new files
  // and newer versions are brought in by themselves.
  useEffect(() => {
    let stop = false;
    (async () => {
      await sleep(8000);
      while (!stop) {
        try {
          const r = await (await fetch("/api/drive/check", { cache: "no-store" })).json();
          if (!stop && r.items?.length) addDriveImports(r.items);
        } catch {}
        await sleep(3600_000);
      }
    })();
    return () => {
      stop = true;
    };
  }, [addDriveImports]);

  // Closing the tab stops an upload; warn first.
  const uploading = jobs.some((j) => j.file && ACTIVE.includes(j.progress.stage) && j.progress.stage !== "analysing");
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const reading = useReadingQueue();

  return (
    <Ctx.Provider value={{ jobs, addUploads, addDriveImports, addProcessJobs }}>
      {children}
      <Dock
        jobs={jobs}
        reading={reading}
        onClear={() => {
          jobsRef.current = jobsRef.current.filter((j) => ACTIVE.includes(j.progress.stage));
          setJobs(jobsRef.current);
        }}
      />
    </Ctx.Provider>
  );
}

// Reads your uploads with the AI while Lengible is open (any page, any device, also in a background tab),
// carrying on where it stopped. Waits and tries again later when the free AI allowance runs out.
function useReadingQueue() {
  const router = useRouter();
  const [now, setNow] = useState<Reading>(null);
  const [paused, setPausedState] = useState(() => store.get("lengible:reading-paused"));
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  // "Try now" ends the current wait early.
  const wake = useRef<(() => void) | null>(null);
  const nap = (ms: number) =>
    new Promise<void>((r) => {
      const t = setTimeout(r, ms);
      wake.current = () => {
        clearTimeout(t);
        r();
      };
    });

  useEffect(() => {
    let stop = false;
    (async () => {
      let backoff = 60_000;
      await sleep(4000); // let the page load first
      while (!stop) {
        if (pausedRef.current) {
          await sleep(3000);
          continue;
        }
        let next: { file: Omit<NonNullable<Reading>, "left" | "note"> | null; left?: number };
        try {
          next = await (await fetch("/api/library/queue", { cache: "no-store" })).json();
        } catch {
          await sleep(60_000);
          continue;
        }
        if (!next.file) {
          setNow(null);
          await sleep(120_000);
          continue;
        }
        const f = next.file;
        const left = next.left ?? 1;
        setNow({ ...f, left });
        const r = await postJSON<{ status: string; message?: string; cursor?: number; total?: number }>(`/api/files/${f.id}/analyze`);
        if (r.status === "more") {
          backoff = 60_000;
          setNow({ ...f, cursor: r.cursor ?? f.cursor, total: r.total ?? f.total, left });
          continue;
        }
        if (r.status === "done" || r.status === "skipped" || r.status === "review") {
          backoff = 60_000;
          router.refresh();
          continue;
        }
        // Out of free AI allowance, AI busy, being read elsewhere, or an error: wait, then try again (longer each time).
        const wait = r.status === "busy" ? 30_000 : backoff;
        setNow({ ...f, left, note: r.status === "busy" ? "Being read on another device or upload" : r.message, retryAt: Date.now() + wait });
        await nap(wait);
        if (r.status !== "busy") backoff = Math.min(backoff * 2, 30 * 60_000);
      }
    })();
    return () => {
      stop = true;
    };
  }, [router]);

  const setPaused = (v: boolean) => {
    setPausedState(v);
    store.set("lengible:reading-paused", v);
  };
  return { now, paused, setPaused, retryNow: () => wake.current?.() };
}

const stageText: Record<Progress["stage"], string> = {
  waiting: "Waiting",
  uploading: "Uploading…",
  reading: "Reading text…",
  analysing: "Reading with AI…",
  done: "Done",
  review: "Ready to review",
  no_text: "Saved (no text found)",
  paused: "Saved, AI paused",
  error: "Failed",
};

function Dock({ jobs, reading, onClear }: { jobs: UploadJob[]; reading: ReturnType<typeof useReadingQueue>; onClear: () => void }) {
  const [small, setSmall] = useState(() => store.get("lengible:dock-small"));
  // Which task's details are open. Unset = the one that's running (or needs attention) opens by itself.
  const [openKey, setOpenKey] = useState<string | null | undefined>(undefined);
  const minimise = (v: boolean) => {
    setSmall(v);
    store.set("lengible:dock-small", v);
  };
  const active = jobs.filter((j) => ACTIVE.includes(j.progress.stage));
  const r = reading.now;
  if (!jobs.length && !r) return null;
  const pct = r?.total ? Math.round((100 * r.cursor) / r.total) : 0;
  const working = active.length > 0 || (!!r && !reading.paused && !r.note);
  const needsYou = jobs.find((j) => ["error", "paused", "review"].includes(j.progress.stage));
  const autoKey = active[0]?.key ?? needsYou?.key ?? (r ? "reader" : jobs.at(-1)?.key);
  const shown = openKey === undefined ? autoKey : openKey;
  const toggle = (key: string) => setOpenKey(shown === key ? null : key);
  const position = "fixed right-3 bottom-[calc(76px+env(safe-area-inset-bottom,0px))] z-30 md:right-6 md:bottom-6";

  if (small) {
    return (
      <button
        type="button"
        onClick={() => minimise(false)}
        className={cx(position, "grid size-12 place-items-center rounded-full border border-border bg-surface shadow-lg")}
        aria-label="Show uploads and reading progress"
        title={r ? `Reading ${r.name}: ${pct}%` : `${active.length} uploading`}
      >
        {/* Ring shows reading progress; the dot shows something is still running. */}
        <svg viewBox="0 0 36 36" className="absolute inset-1 -rotate-90" aria-hidden="true">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-surface-2)" strokeWidth="3" />
          {r && <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-brand)" strokeWidth="3" strokeDasharray={`${(pct / 100) * 97.4} 97.4`} strokeLinecap="round" />}
        </svg>
        {active.length ? <Upload size={16} className="text-brand" /> : <BookOpenText size={16} className="text-brand" />}
        {/* Amber dot: something needs you (paused, failed or ready to review); blue dot: working. */}
        {needsYou || r?.note ? (
          <span className="absolute top-0.5 right-0.5 size-3 rounded-full bg-warn ring-2 ring-surface" />
        ) : (
          working && <span className="absolute top-0.5 right-0.5 size-3 animate-pulse rounded-full bg-brand ring-2 ring-surface" />
        )}
      </button>
    );
  }

  return (
    <div className={cx(position, "w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-border bg-surface/95 text-xs shadow-lg backdrop-blur")}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {working ? <Loader2 size={14} className="animate-spin text-brand" /> : <BookOpenText size={14} className="text-brand" />}
        <span className="flex-1 font-semibold">{active.length ? `Uploading ${active.length} file${active.length > 1 ? "s" : ""}` : "Background reading"}</span>
        <span className="hidden text-muted sm:inline">keeps going while you browse</span>
        <button type="button" onClick={() => minimise(true)} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Minimise">
          <ChevronDown size={16} />
        </button>
      </div>
      <ul className="max-h-[min(65vh,520px)] divide-y divide-border overflow-y-auto">
        {jobs.map((j) => (
          <li key={j.key} className="px-3 py-2">
            <button type="button" onClick={() => toggle(j.key)} className="flex w-full items-start gap-2 text-left" aria-expanded={shown === j.key}>
              <StageIcon stage={j.progress.stage} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{j.name}</span>
                <span className={cx("block", j.progress.stage === "error" ? "line-clamp-3 text-danger" : "truncate text-muted")}>
                  {stageText[j.progress.stage]}
                  {/* Why it failed, right here (no need to open the details). */}
                  {j.progress.stage === "error" && j.progress.message ? ` · ${j.progress.message}` : ""}
                  {j.progress.step === "ai" && j.progress.total ? ` · page ${j.progress.done ?? 0} of ${j.progress.total}` : ""}
                  {j.progress.step === "pictures" && j.progress.total ? ` · picture ${j.progress.done ?? 0} of ${j.progress.total}` : ""}
                </span>
              </span>
              {shown === j.key ? <ChevronDown size={16} className="mt-0.5 shrink-0 text-muted" /> : <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted" />}
            </button>
            {shown === j.key && (
              <div className="mt-2">
                <ProcessDetails
                  fileId={j.id}
                  live={{
                    step: ACTIVE.includes(j.progress.stage) ? (j.progress.step ?? (j.progress.stage === "uploading" ? "upload" : undefined)) : undefined,
                    done: j.progress.done,
                    total: j.progress.total,
                    note: ["paused", "error"].includes(j.progress.stage) ? j.progress.message : undefined,
                    failed: j.progress.stage === "error",
                  }}
                />
              </div>
            )}
          </li>
        ))}
        {r && (
          <li className="px-3 py-2">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => toggle("reader")} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={shown === "reader"}>
                <BookOpenText size={16} className={cx("shrink-0 text-brand", !reading.paused && !r.note && "animate-pulse")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {reading.paused ? "Reading paused" : "Reading"} · {r.name}
                  </span>
                  <span className="block truncate text-muted">
                    {r.note ? "Waiting, tap for details" : r.total ? `page ${r.cursor} of ${r.total} (${pct}%)` : "starting…"}
                    {r.left > 1 ? ` · ${r.left - 1} more file${r.left > 2 ? "s" : ""} waiting` : ""}
                  </span>
                  {r.total > 0 && shown !== "reader" && (
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full bg-brand" style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </span>
                {shown === "reader" ? <ChevronDown size={16} className="shrink-0 text-muted" /> : <ChevronRight size={16} className="shrink-0 text-muted" />}
              </button>
              <button
                type="button"
                onClick={() => reading.setPaused(!reading.paused)}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2"
                aria-label={reading.paused ? "Resume reading" : "Pause reading"}
                title={reading.paused ? "Resume reading" : "Pause reading"}
              >
                {reading.paused ? <Play size={15} /> : <Pause size={15} />}
              </button>
            </div>
            {shown === "reader" && (
              <div className="mt-2">
                <ProcessDetails
                  fileId={r.id}
                  live={{ step: "ai", done: r.cursor, total: r.total, note: r.note, retryAt: r.retryAt, paused: reading.paused }}
                  onRetryNow={r.note ? reading.retryNow : undefined}
                />
              </div>
            )}
          </li>
        )}
      </ul>
      {jobs.length > active.length && (
        <button type="button" onClick={onClear} className="w-full border-t border-border px-3 py-1.5 text-left text-muted hover:bg-surface-2">
          Clear finished uploads
        </button>
      )}
    </div>
  );
}
