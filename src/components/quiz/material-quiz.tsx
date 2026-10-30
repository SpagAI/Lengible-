"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Loader2 } from "lucide-react";
import type { QuestionFormat, QuizMaterials, QuizSettings } from "@/lib/supabase/types";
import { startQuiz } from "@/app/(app)/quiz/actions";
import { Button, Card, cx, inputClass } from "@/components/ui";

const FORMATS: { value: QuestionFormat; label: string }[] = [
  { value: "mcq", label: "MCQ" },
  { value: "tf", label: "True/False" },
  { value: "quickfire", label: "Quick recall" },
];

// "Quiz me" on one file (optionally slides from–to) or a folder: questions written only from that material.
export function MaterialQuiz({
  label,
  fileId,
  folderId,
  pages,
  startPage,
  buttonLabel = "Quiz me on this",
  variant = "secondary",
}: {
  label: string;
  fileId?: string;
  folderId?: string;
  pages?: number;
  startPage?: number;
  buttonLabel?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(startPage && pages ? String(startPage) : "");
  const [to, setTo] = useState(startPage && pages ? String(Math.min(pages, startPage + 9)) : "");
  const [count, setCount] = useState(10);
  const [formats, setFormats] = useState<QuestionFormat[]>(["mcq"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const start = async () => {
    setBusy(true);
    setError(undefined);
    const a = Number(from) || undefined;
    const b = Number(to) || undefined;
    const range = a || b ? ` (slides ${a ?? 1}–${b ?? pages ?? "end"})` : "";
    const materials: QuizMaterials = {
      label: `${label}${range}`,
      files: fileId ? [{ id: fileId, from: a, to: b }] : [],
      folder_ids: folderId ? [folderId] : [],
    };
    const settings: QuizSettings = {
      formats,
      difficulty: "medium",
      course_ids: [],
      topics: [],
      source: "slides",
      count,
      timed: false,
      negative_marking: false,
      materials,
    };
    const r = await startQuiz(settings, "custom");
    if ("error" in r) {
      setError(r.error);
      setBusy(false);
    } else router.push(`/quiz/session/${r.id}`);
  };

  if (!open)
    return (
      <Button variant={variant} onClick={() => setOpen(true)}>
        <ListChecks size={16} /> {buttonLabel}
      </Button>
    );
  return (
    <Card className="w-full space-y-3 sm:max-w-md">
      <p className="text-sm font-medium">Quiz on {label}</p>
      {fileId && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          Slides
          <input value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="1" className={cx(inputClass, "w-20")} aria-label="From slide" />
          to
          <input
            value={to}
            onChange={(e) => setTo(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder={pages ? String(pages) : "end"}
            className={cx(inputClass, "w-20")}
            aria-label="To slide"
          />
          <span className="text-xs text-muted">Leave empty for the whole file.</span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {FORMATS.map((f) => {
          const on = formats.includes(f.value);
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={on}
              onClick={() => setFormats(on ? (formats.length > 1 ? formats.filter((x) => x !== f.value) : formats) : [...formats, f.value])}
              className={cx("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-brand bg-brand text-on-brand" : "border-border text-muted")}
            >
              {f.label}
            </button>
          );
        })}
        <span className="mx-1 self-center text-xs text-muted">·</span>
        {[5, 10, 20].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={count === n}
            onClick={() => setCount(n)}
            className={cx("rounded-full border px-3 py-1 text-xs font-medium", count === n ? "border-brand bg-brand text-on-brand" : "border-border text-muted")}
          >
            {n} questions
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={start} disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ListChecks size={16} />} Start quiz
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
