"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2, Upload, X, Eye, PauseCircle } from "lucide-react";
import { useSupabase } from "@/lib/supabase/client";
import { createFileRecord } from "@/app/(app)/library/actions";
import { docTypes } from "@/lib/library";
import { runPipeline, type Progress } from "./pipeline";
import { Button, Card, Field, inputClass, cx } from "@/components/ui";

type Item = { key: string; file: File; id?: string; progress: Progress };

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

// Guesses the type from the file name so most uploads need no changes.
function guessType(name: string) {
  const n = name.toLowerCase();
  if (/time ?table|schedule/.test(n)) return "timetable";
  if (/topic|syllabus|curriculum/.test(n)) return "topic_list";
  if (/\bmb\b/.test(n)) return "mb_questions";
  if (/past|pq|question/.test(n)) return "past_questions";
  if (/practical|prac\b/.test(n)) return "practical";
  if (/manual/.test(n)) return "manual";
  if (/notes?\b|summary/.test(n)) return "notes";
  if (/\.(pptx?|key)$/.test(n)) return "slides";
  if (/\.(jpe?g|png|webp|heic)$/.test(n)) return "picture_test";
  return "";
}

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
  const supabase = useSupabase();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [docType, setDocType] = useState("auto");
  const [topicId, setTopicId] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (key: string, patch: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function start() {
    setBusy(true);
    for (const item of items.filter((i) => i.progress.stage === "waiting")) {
      const type = docType === "auto" ? guessType(item.file.name) || "other" : docType;
      const record = await createFileRecord({
        courseId,
        folderId,
        topicId: topicId || null,
        name: item.file.name,
        docType: type,
        mime: item.file.type,
        size: item.file.size,
      });
      if ("error" in record) {
        update(item.key, { progress: { stage: "error", message: record.error } });
        continue;
      }
      update(item.key, { id: record.id });
      await runPipeline(supabase, item.file, record as { id: string; path: string }, courseId, (progress) => update(item.key, { progress }));
    }
    setBusy(false);
    router.refresh();
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
        accept=".pdf,.pptx,.docx,.txt,.md,image/*"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          setItems((cur) => [...cur, ...files.map((file) => ({ key: crypto.randomUUID(), file, progress: { stage: "waiting" as const } }))]);
          e.target.value = "";
        }}
      />
      <Button type="button" variant="secondary" className="w-full border-dashed" onClick={() => input.current?.click()} disabled={busy}>
        <Upload size={18} /> Choose files from your device
      </Button>
      <p className="-mt-2 text-xs text-muted">PDF, PowerPoint (.pptx), Word (.docx), photos and text. Up to 50 MB each.</p>

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

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.key} className="flex items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm">
              <StageIcon stage={i.progress.stage} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{i.file.name}</p>
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
              {i.progress.stage === "waiting" && !busy && (
                <button type="button" aria-label="Remove" onClick={() => setItems(items.filter((x) => x.key !== i.key))}>
                  <X size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Button type="button" onClick={start} disabled={busy || !items.some((i) => i.progress.stage === "waiting")} className="w-full">
        {busy ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Working — keep this page open
          </>
        ) : (
          "Upload"
        )}
      </Button>
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
