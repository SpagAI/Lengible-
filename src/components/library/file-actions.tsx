"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, Loader2, RefreshCw, Share2, Sparkles, Upload } from "lucide-react";
import { useSupabase } from "@/lib/supabase/client";
import { startReplace } from "@/app/(app)/library/actions";
import { analyze, runPipeline, type Progress } from "./pipeline";
import { StageIcon } from "./upload-panel";
import { Button } from "@/components/ui";
import { postJSON } from "@/lib/fetch-json";

export function FileActions({
  file,
  viewUrl,
  downloadUrl,
}: {
  file: { id: string; name: string; mime: string | null; courseId: string | null; status: string; ext: string; scanSkipped: boolean; scanPausedAt: number; pages: number };
  viewUrl: string;
  downloadUrl: string;
}) {
  const supabase = useSupabase();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [sharing, setSharing] = useState(false);
  const busy = progress && ["uploading", "reading", "analysing"].includes(progress.stage);
  const canShare = typeof navigator !== "undefined" && "canShare" in navigator;

  // Hands the file to another app (WPS, a PDF reader…) through the phone's share sheet.
  async function shareFile() {
    setSharing(true);
    try {
      const blob = await (await fetch(viewUrl)).blob();
      const f = new File([blob], `${file.name}${file.ext}`, { type: file.mime ?? blob.type });
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: file.name });
      else window.open(downloadUrl, "_blank");
    } catch {
      // The user closed the share sheet.
    } finally {
      setSharing(false);
    }
  }

  async function reanalyse(reread: boolean, full = false, resume = false) {
    setProgress({ stage: "analysing", message: reread ? "Reading the file with AI…" : undefined });
    if (!resume) {
      const body = await postJSON<{ status: string; message?: string }>(`/api/files/${file.id}/${reread ? "read" : "reset"}`);
      if (body.status !== "ok") {
        setProgress({ stage: body.status === "rate_limited" ? "paused" : "error", message: body.message });
        return;
      }
    }
    const result = await analyze(file.id, setProgress, full);
    setProgress({
      stage: result.status === "review" ? "review" : result.status === "rate_limited" ? "paused" : result.status === "error" ? "error" : "done",
      message: result.message,
    });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canShare ? (
          <Button type="button" onClick={shareFile} disabled={sharing}>
            {sharing ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />} Open in another app
          </Button>
        ) : (
          <a href={viewUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-medium text-on-brand">
            <ExternalLink size={16} /> Open in another app
          </a>
        )}
        <a href={downloadUrl} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2">
          <Download size={16} /> Download
        </a>
        <Button type="button" variant="secondary" disabled={!!busy} onClick={() => input.current?.click()}>
          <Upload size={16} /> Replace with new version
        </Button>
        {file.status === "no_text" ? (
          <Button type="button" variant="secondary" disabled={!!busy} onClick={() => reanalyse(true)}>
            <Sparkles size={16} /> Read with AI
          </Button>
        ) : file.scanPausedAt > 0 ? (
          <Button type="button" variant="secondary" disabled={!!busy} onClick={() => reanalyse(false, true, true)}>
            <Sparkles size={16} /> Continue scan (from page {file.scanPausedAt})
          </Button>
        ) : file.scanSkipped ? (
          <Button
            type="button"
            variant="secondary"
            disabled={!!busy}
            onClick={() => {
              const calls = Math.ceil(file.pages / 12);
              if (confirm(`Scan all ${file.pages} pages for drugs and diseases? That's about ${calls} AI requests, a big share of the free daily allowance. Leave the page open; if Google's limit is reached it pauses and you can continue later.`)) reanalyse(false, true);
            }}
          >
            <Sparkles size={16} /> Scan fully
          </Button>
        ) : (
          <Button type="button" variant="ghost" disabled={!!busy} onClick={() => reanalyse(false, true)}>
            <RefreshCw size={16} /> Re-analyse
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept=".pdf,.pptx,.docx,.txt,.md,image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f || !confirm(`Replace “${file.name}” with “${f.name}”? Links and folder stay the same; the text is read again.`)) return;
          const rec = await startReplace(file.id, f.name, f.type, f.size);
          if ("error" in rec) return setProgress({ stage: "error", message: rec.error });
          await runPipeline(supabase, f, rec as { id: string; path: string }, file.courseId, setProgress);
          router.refresh();
        }}
      />
      {progress && (
        <p className="flex items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          <StageIcon stage={progress.stage} />
          <span>
            {
              {
                waiting: "Waiting",
                uploading: "Uploading…",
                reading: "Reading text…",
                analysing: "Analysing with AI…",
                done: "Done.",
                review: "Ready to review.",
                no_text: "Saved. No text layer — tap “Read with AI”.",
                paused: "AI paused.",
                error: "Failed.",
              }[progress.stage]
            }
            {progress.message ? ` ${progress.message}` : ""}
          </span>
          {progress.stage === "review" && (
            <a href={`/library/file/${file.id}/review`} className="ml-auto rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-on-brand">
              Review
            </a>
          )}
        </p>
      )}
    </div>
  );
}
