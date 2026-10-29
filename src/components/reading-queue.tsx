"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpenText, Pause, Play } from "lucide-react";
import { postJSON } from "@/lib/fetch-json";
import { cx } from "@/components/ui";

type Next = { file: { id: string; name: string; cursor: number; total: number } | null; left?: number };
type Step = { status: string; message?: string; cursor?: number; total?: number };

const PAUSE_KEY = "lengible:reading-paused";
const readPaused = () => {
  try {
    return localStorage.getItem(PAUSE_KEY) === "1";
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Reads your uploads with the AI in the background while Lengible is open (any page, any device),
// carrying on where it stopped. Waits and tries again later when the free AI allowance runs out.
export function ReadingQueue() {
  const router = useRouter();
  const [now, setNow] = useState<{ id: string; name: string; cursor: number; total: number; left: number; note?: string } | null>(null);
  const [paused, setPaused] = useState(readPaused);
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
        if (pausedRef.current || document.hidden) {
          await sleep(5000);
          continue;
        }
        let next: Next;
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
        setNow({ ...f, left: next.left ?? 1 });
        const r = await postJSON<Step>(`/api/files/${f.id}/analyze`);
        if (r.status === "more") {
          backoff = 60_000;
          setNow({ ...f, cursor: r.cursor ?? f.cursor, total: r.total ?? f.total, left: next.left ?? 1 });
          continue;
        }
        if (r.status === "done" || r.status === "skipped" || r.status === "review") {
          backoff = 60_000;
          router.refresh();
          continue;
        }
        // Out of free AI allowance, AI busy, being read elsewhere, or an error: wait, then try again (longer each time).
        setNow({ ...f, left: next.left ?? 1, note: r.status === "busy" ? "Being read on another device" : r.message });
        await sleep(r.status === "busy" ? 30_000 : backoff);
        if (r.status !== "busy") backoff = Math.min(backoff * 2, 30 * 60_000);
      }
    })();
    return () => {
      stop = true;
    };
  }, [router]);

  if (!now) return null;
  const pct = now.total ? Math.round((100 * now.cursor) / now.total) : 0;
  return (
    <div className="pointer-events-none fixed right-3 bottom-[calc(76px+env(safe-area-inset-bottom,0px))] z-30 flex justify-end md:right-6 md:bottom-6">
      <div className="pointer-events-auto flex max-w-[min(92vw,360px)] items-center gap-2.5 rounded-2xl border border-border bg-surface/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
        <BookOpenText size={16} className={cx("shrink-0 text-brand", !paused && !now.note && "animate-pulse")} />
        <Link href={`/library/file/${now.id}`} className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {paused ? "Reading paused" : "Reading"} · {now.name}
          </span>
          <span className="block truncate text-muted">
            {now.note ? now.note : now.total ? `page ${now.cursor} of ${now.total} (${pct}%)` : "starting…"}
            {now.left > 1 ? ` · ${now.left - 1} more file${now.left > 2 ? "s" : ""} waiting` : ""}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => {
            const v = !paused;
            setPaused(v);
            try {
              localStorage.setItem(PAUSE_KEY, v ? "1" : "0");
            } catch {}
          }}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2"
          aria-label={paused ? "Resume reading" : "Pause reading"}
          title={paused ? "Resume reading" : "Pause reading"}
        >
          {paused ? <Play size={15} /> : <Pause size={15} />}
        </button>
      </div>
    </div>
  );
}
