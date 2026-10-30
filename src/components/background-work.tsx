"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpenText, ChevronDown, Loader2, Pause, Play, Upload } from "lucide-react";
import { useSupabase } from "@/lib/supabase/client";
import { createFileRecord } from "@/app/(app)/library/actions";
import { runPipeline, type Progress } from "@/components/library/pipeline";
import { StageIcon } from "@/components/library/upload-panel";
import { postJSON } from "@/lib/fetch-json";
import { cx } from "@/components/ui";

// Uploads and AI reading live here, above every page, so they keep going while you use the rest of
// Lengible. A small panel in the corner shows progress and can be minimised to a round button.

export type UploadJob = {
  key: string;
  batch: string;
  file: File;
  type: string;
  courseId: string | null;
  folderId: string | null;
  topicId: string | null;
  id?: string;
  progress: Progress;
};
type NewUpload = Omit<UploadJob, "key" | "progress" | "id">;
type Reading = { id: string; name: string; cursor: number; total: number; left: number; note?: string } | null;

const Ctx = createContext<{ jobs: UploadJob[]; addUploads: (items: NewUpload[]) => void } | null>(null);
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

  // Works through waiting uploads one at a time.
  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const job = jobsRef.current.find((j) => j.progress.stage === "waiting");
        if (!job) break;
        update(job.key, { progress: { stage: "uploading" } });
        const record = await createFileRecord({
          courseId: job.courseId,
          folderId: job.folderId,
          topicId: job.topicId,
          name: job.file.name,
          docType: job.type,
          mime: job.file.type,
          size: job.file.size,
        });
        if ("error" in record) {
          update(job.key, { progress: { stage: "error", message: record.error } });
          continue;
        }
        update(job.key, { id: record.id });
        await runPipeline(supabase, job.file, record as { id: string; path: string }, job.courseId, (progress) => update(job.key, { progress }));
        router.refresh();
      }
    } finally {
      running.current = false;
    }
  }, [supabase, router, update]);

  const addUploads = useCallback(
    (items: NewUpload[]) => {
      const added = items.map((i) => ({ ...i, key: crypto.randomUUID(), progress: { stage: "waiting" as const } }));
      jobsRef.current = [...jobsRef.current, ...added];
      setJobs(jobsRef.current);
      void pump();
    },
    [pump],
  );

  // Closing the tab stops an upload; warn first.
  const uploading = jobs.some((j) => ACTIVE.includes(j.progress.stage) && j.progress.stage !== "analysing");
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const reading = useReadingQueue();

  return (
    <Ctx.Provider value={{ jobs, addUploads }}>
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
        setNow({ ...f, left, note: r.status === "busy" ? "Being read on another device or upload" : r.message });
        await sleep(r.status === "busy" ? 30_000 : backoff);
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
  return { now, paused, setPaused };
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
  const minimise = (v: boolean) => {
    setSmall(v);
    store.set("lengible:dock-small", v);
  };
  const active = jobs.filter((j) => ACTIVE.includes(j.progress.stage));
  const r = reading.now;
  if (!jobs.length && !r) return null;
  const pct = r?.total ? Math.round((100 * r.cursor) / r.total) : 0;
  const working = active.length > 0 || (!!r && !reading.paused && !r.note);
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
        {working && <span className="absolute top-0.5 right-0.5 size-3 animate-pulse rounded-full bg-brand ring-2 ring-surface" />}
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
      <ul className="max-h-60 divide-y divide-border overflow-y-auto">
        {jobs.map((j) => (
          <li key={j.key} className="flex items-start gap-2 px-3 py-2">
            <StageIcon stage={j.progress.stage} />
            <div className="min-w-0 flex-1">
              {j.id ? (
                <Link href={j.progress.stage === "review" ? `/library/file/${j.id}/review` : `/library/file/${j.id}`} className="block truncate font-medium">
                  {j.file.name}
                </Link>
              ) : (
                <p className="truncate font-medium">{j.file.name}</p>
              )}
              <p className={cx("truncate", j.progress.stage === "error" ? "text-danger" : "text-muted")}>
                {stageText[j.progress.stage]}
                {j.progress.message ? ` · ${j.progress.message}` : ""}
              </p>
            </div>
          </li>
        ))}
        {r && (
          <li className="flex items-center gap-2 px-3 py-2">
            <BookOpenText size={16} className={cx("shrink-0 text-brand", !reading.paused && !r.note && "animate-pulse")} />
            <Link href={`/library/file/${r.id}`} className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {reading.paused ? "Reading paused" : "Reading"} · {r.name}
              </span>
              <span className="block truncate text-muted">
                {r.note ? r.note : r.total ? `page ${r.cursor} of ${r.total} (${pct}%)` : "starting…"}
                {r.left > 1 ? ` · ${r.left - 1} more file${r.left > 2 ? "s" : ""} waiting` : ""}
              </span>
              {r.total > 0 && (
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full bg-brand" style={{ width: `${pct}%` }} />
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => reading.setPaused(!reading.paused)}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2"
              aria-label={reading.paused ? "Resume reading" : "Pause reading"}
              title={reading.paused ? "Resume reading" : "Pause reading"}
            >
              {reading.paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
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
