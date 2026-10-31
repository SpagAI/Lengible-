"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Loader2, Upload, X, Eye, PauseCircle } from "lucide-react";
import { docTypes, guessType } from "@/lib/library";
import { useBackgroundWork } from "@/components/background-work";
import type { Progress } from "./pipeline";
import { Button, Card, Field, inputClass, cx } from "@/components/ui";

type Item = { key: string; file: File };

const stageText: Record<Progress["stage"], string> = {
  waiting: "Waiting",
  uploading: "Uploading…",
  reading: "Reading text…",
  analysing: "Analysing with AI…",
  done: "Done",
  review: "Ready to review",
  no_text: "Saved (no text found)",
  paused: "Saved — AI paused",
  error: "Failed",
};

export function UploadPanel({
  courseId,
  folderId,
  topics,
  onClose,
}: {
  courseId: string | null;
  folderId: string | null;
  topics: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { jobs, addUploads } = useBackgroundWork();
  const input = useRef<HTMLInputElement>(null);
  // Files chosen but not started yet; once started they're handed to the background uploader,
  // which keeps going if you leave this page.
  const [items, setItems] = useState<Item[]>([]);
  const [batch] = useState(() => crypto.randomUUID());
  const [docType, setDocType] = useState("auto");
  const [topicId, setTopicId] = useState("");
  const mine = jobs.filter((j) => j.batch === batch);
  const busy = mine.some((j) => ["waiting", "uploading", "reading", "analysing"].includes(j.progress.stage));

  function start() {
    addUploads(
      items.map((item) => ({
        batch,
        file: item.file,
        type: docType === "auto" ? guessType(item.file.name) || "other" : docType,
        courseId,
        folderId,
        topicId: topicId || null,
      })),
    );
    setItems([]);
  }

  return (
    <Card className="space-y-4 border-brand/40">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Upload files</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-lg hover:bg-surface-2">
          <X size={18} />
        </button>
      </div>

      <input
        ref={input}
        type="file"
        multiple
        accept=".pdf,.pptx,.ppt,.docx,.doc,.xlsx,.odt,.odp,.ods,.rtf,.epub,.html,.htm,.txt,.md,.csv,image/*"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          setItems((cur) => [...cur, ...files.map((file) => ({ key: crypto.randomUUID(), file }))]);
          e.target.value = "";
        }}
      />
      <Button type="button" variant="secondary" className="w-full border-dashed" onClick={() => input.current?.click()} disabled={busy}>
        <Upload size={18} /> Choose files from your device
      </Button>
      <p className="-mt-2 text-xs text-muted">
        PDF, PowerPoint (.pptx, .ppt), Word (.docx, .doc), Excel (.xlsx), OpenDocument, RTF, e-books (.epub), web pages, text and photos. Up to 300
        MB each: files over 50 MB are stored in pieces and joined back exactly, with nothing compressed.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inputClass}>
            <option value="auto">Guess from file name</option>
            {docTypes.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Topic (optional)">
          <select value={topicId} onChange={(e) => setTopicId(e.target.value)} className={inputClass}>
            <option value="">— Let the AI suggest —</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {(items.length > 0 || mine.length > 0) && (
        <ul className="space-y-2">
          {mine.map((i) => (
            <li key={i.key} className="flex items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm">
              <StageIcon stage={i.progress.stage} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{i.name}</p>
                <p className={cx("text-xs", i.progress.stage === "error" ? "text-danger" : "text-muted")}>
                  {stageText[i.progress.stage]}
                  {i.progress.message ? ` — ${i.progress.message}` : ""}
                </p>
              </div>
              {i.id && i.progress.stage === "review" && (
                <Link href={`/library/file/${i.id}/review`} className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-on-brand">
                  Review
                </Link>
              )}
              {i.id && ["done", "no_text", "paused", "error"].includes(i.progress.stage) && (
                <Link href={`/library/file/${i.id}`} className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium">
                  <Eye size={14} className="inline" /> Open
                </Link>
              )}
            </li>
          ))}
          {items.map((i) => (
            <li key={i.key} className="flex items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm">
              <StageIcon stage="waiting" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{i.file.name}</p>
                <p className="text-xs text-muted">Ready to upload</p>
              </div>
              <button type="button" aria-label="Remove" onClick={() => setItems(items.filter((x) => x.key !== i.key))}>
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" onClick={start} disabled={!items.length} className="w-full">
        {busy && !items.length ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Uploading…
          </>
        ) : (
          "Upload"
        )}
      </Button>
      {busy && (
        <p className="-mt-2 text-center text-xs text-muted">
          You can leave this page. Uploads and reading carry on while you use Lengible; follow them in the corner panel.
        </p>
      )}
    </Card>
  );
}

export function StageIcon({ stage }: { stage: Progress["stage"] }) {
  if (["uploading", "reading", "analysing"].includes(stage)) return <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-brand" />;
  if (stage === "error") return <CircleAlert size={18} className="mt-0.5 shrink-0 text-danger" />;
  if (stage === "paused" || stage === "no_text") return <PauseCircle size={18} className="mt-0.5 shrink-0 text-warn" />;
  if (stage === "waiting") return <span className="mt-1 size-4 shrink-0 rounded-full border-2 border-border" />;
  return <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ok" />;
}
