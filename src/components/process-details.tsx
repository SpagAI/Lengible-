"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Loader2, RotateCcw } from "lucide-react";
import type { FileProgress } from "@/app/api/files/[id]/progress/route";
import type { Step } from "@/components/library/pipeline";
import { cx } from "@/components/ui";

// What the panel knows right now about a task that is running in this tab.
export type Live = {
  step?: Step;
  done?: number;
  total?: number;
  // Why it's waiting, and when it will try again by itself.
  note?: string;
  retryAt?: number;
  failed?: boolean;
  paused?: boolean;
};

const fmtBytes = (n: number | null) => (!n ? "" : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const fmtWait = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ""}`.trim() : `${s} s`;
};
const fmtLeft = (min: number) => (min < 1 ? "under a minute left" : min < 60 ? `about ${Math.round(min)} min left` : `about ${(min / 60).toFixed(1)} h left`);

// Plain-language reason for a pause, with what happens next.
function explain(note: string) {
  if (/allowance|limit|quota|429/i.test(note)) return "Google's free AI limit for now has been reached. Nothing is lost; Lengible tries again by itself.";
  if (/overloaded|busy at the moment|servers/i.test(note)) return "Google's AI servers are busy right now. Nothing is lost; Lengible tries again by itself.";
  if (/another device|another tab|upload/i.test(note)) return "This file is being read in another tab or device (or by the upload). This one waits its turn.";
  return note;
}

// Speed from what has been seen while the panel is open: pages per minute and time left.
function useEta(done: number | undefined, total: number | undefined) {
  const first = useRef<{ t: number; d: number } | null>(null);
  const [eta, setEta] = useState<{ perMin: number; minLeft: number } | null>(null);
  useEffect(() => {
    if (done === undefined || !total) return;
    const now = Date.now();
    if (!first.current || done < first.current.d) {
      first.current = { t: now, d: done };
      return;
    }
    const mins = (now - first.current.t) / 60000;
    const moved = done - first.current.d;
    if (moved > 0 && mins > 0.05) {
      const perMin = moved / mins;
      setEta({ perMin, minLeft: (total - done) / perMin });
    }
  }, [done, total]);
  return eta;
}

function useCountdown(at: number | undefined) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!at) return;
    const tick = () => setLeft(Math.max(0, at - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [at]);
  return at ? left : 0;
}

type Row = { key: string; label: string; state: "done" | "now" | "todo" | "skip"; detail?: React.ReactNode; bar?: number };

// The step-by-step timeline of one file: upload → text → picture pages → AI reading → topics saved.
export function ProcessDetails({ fileId, live, onRetryNow }: { fileId?: string; live?: Live; onRetryNow?: () => void }) {
  const [info, setInfo] = useState<FileProgress | null>(null);
  const finished = !!info?.reading?.finished || info?.reading?.skipped;

  // Fresh numbers every few seconds while open, and whenever the live step moves on.
  useEffect(() => {
    if (!fileId) return;
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/files/${fileId}/progress`, { cache: "no-store" });
        if (r.ok && !stop) setInfo(await r.json());
      } catch {}
    };
    void load();
    const t = setInterval(load, finished ? 30_000 : 6000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [fileId, live?.step, live?.done, finished]);

  const step = live?.step;
  const aiDone = step === "ai" && live?.done !== undefined ? live.done : (info?.reading?.cursor ?? 0);
  const aiTotal = (step === "ai" && live?.total) || info?.reading?.total || info?.textPages || 0;
  const eta = useEta(step === "pictures" ? live?.done : aiDone, step === "pictures" ? live?.total : aiTotal);
  const wait = useCountdown(live?.retryAt);
  const isList = info?.docType === "timetable" || info?.docType === "topic_list";
  const reading = info?.reading;

  const rows: Row[] = [
    {
      key: "upload",
      label: "Uploaded",
      state: step === "upload" || (!fileId && !info) ? "now" : "done",
      detail: info ? fmtBytes(info.sizeBytes) : undefined,
    },
    {
      key: "text",
      label: "Text saved from the file",
      state: step === "upload" ? "todo" : step === "text" ? "now" : info && info.textPages === 0 && info.status === "no_text" ? "skip" : "done",
      detail:
        step === "text" && live?.total
          ? `${live.done ?? 0} of ${live.total} pages`
          : info
            ? `${info.textPages} page${info.textPages === 1 ? "" : "s"}${info.pageCount ? ` of ${info.pageCount}` : ""} searchable`
            : undefined,
      bar: step === "text" && live?.total ? (100 * (live.done ?? 0)) / live.total : undefined,
    },
    {
      key: "pictures",
      label: "Picture slides read (diagrams, micrographs, tables)",
      state: step === "pictures" ? "now" : (info?.picturePages ?? 0) > 0 ? "done" : step === "upload" || step === "text" ? "todo" : "skip",
      detail:
        step === "pictures" && live?.total
          ? `${live.done ?? 0} of ${live.total}`
          : info?.picturePages
            ? `${info.picturePages} read`
            : "none needed",
      bar: step === "pictures" && live?.total ? (100 * (live.done ?? 0)) / live.total : undefined,
    },
    {
      key: "ai",
      label: isList ? "AI reading the list" : "AI reading for topics, drugs and diseases",
      state: reading?.skipped ? "skip" : finished ? "done" : step === "ai" || (reading && !finished && aiDone > 0) ? "now" : "todo",
      detail: reading?.skipped
        ? "skipped (textbook or very large file): open the file and tap “Scan fully”"
        : aiTotal
          ? `page ${aiDone} of ${aiTotal}`
          : undefined,
      bar: !finished && aiTotal ? (100 * aiDone) / aiTotal : undefined,
    },
    isList
      ? {
          key: "review",
          label: "Ready for your review",
          state: reading?.pendingReview ? "now" : finished ? "done" : "todo",
          detail: reading?.pendingReview && fileId ? <Link href={`/library/file/${fileId}/review`} className="text-brand underline">Review and import →</Link> : undefined,
        }
      : {
          key: "save",
          label: "Topics linked to your courses",
          state: finished ? "done" : (info?.topicsLinked ?? 0) > 0 ? "now" : "todo",
          detail: info
            ? `${info.topicsLinked} topic${info.topicsLinked === 1 ? "" : "s"} · ${info.concepts} ${info.concepts === 1 ? "drug, disease, organism or test" : "drugs, diseases, organisms and tests"}`
            : undefined,
        },
  ];

  return (
    <div className="space-y-3 rounded-xl bg-surface-2/60 p-3">
      <ol className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.key} className="flex gap-2.5">
            <span
              className={cx(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                r.state === "done" && "bg-ok text-white",
                r.state === "now" && "bg-brand text-on-brand",
                r.state === "todo" && "border-2 border-border",
                r.state === "skip" && "border-2 border-dashed border-border",
              )}
            >
              {r.state === "done" ? <Check size={12} strokeWidth={3} /> : r.state === "now" ? <Loader2 size={12} className={cx(!live?.note && !live?.paused && "animate-spin")} /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cx("block font-medium", (r.state === "todo" || r.state === "skip") && "text-muted")}>{r.label}</span>
              {r.detail && <span className="block text-muted">{r.detail}</span>}
              {r.bar !== undefined && r.state === "now" && (
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface">
                  <span className="block h-full rounded-full bg-brand transition-all" style={{ width: `${Math.min(100, r.bar)}%` }} />
                </span>
              )}
              {r.state === "now" && eta && (r.key === "ai" || r.key === "pictures") && !live?.note && (
                <span className="block text-muted">
                  {eta.perMin >= 1 ? `${Math.round(eta.perMin)} pages/min` : `${(eta.perMin * 60).toFixed(0)} pages/hour`} · {fmtLeft(eta.minLeft)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      {info && info.sections.length > 0 && (
        <div>
          <p className="font-semibold">Topics found so far ({info.sections.length})</p>
          <ul className="mt-1 space-y-0.5">
            {info.sections.slice(-8).map((s) => (
              <li key={`${s.title}${s.start}`} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="shrink-0 text-muted">
                  p.{s.start}
                  {s.end !== s.start ? `–${s.end}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {info.sections.length > 8 && <p className="text-muted">…and {info.sections.length - 8} earlier</p>}
        </div>
      )}

      {(live?.note || live?.failed) && (
        <div className={cx("rounded-lg p-2.5", live.failed ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn")}>
          <p>{explain(live.note ?? "Something went wrong.")}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {live.retryAt && wait > 0 && <span>Trying again in {fmtWait(wait)}.</span>}
            {onRetryNow && (
              <button type="button" onClick={onRetryNow} className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 font-medium text-text">
                <RotateCcw size={12} /> Try now
              </button>
            )}
          </div>
          {/allowance|limit|quota/i.test(live.note ?? "") && <p className="mt-1.5 text-muted">Tip: turning on billing for your Gemini key in Google AI Studio removes these waits.</p>}
        </div>
      )}
      {fileId && (
        <Link href={`/library/file/${fileId}`} className="inline-block font-medium text-brand">
          Open the file →
        </Link>
      )}
    </div>
  );
}
