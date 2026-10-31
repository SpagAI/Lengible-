"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, CheckSquare, ListChecks, Loader2, Square, X } from "lucide-react";
import type { LibraryFile, QuizSettings } from "@/lib/supabase/types";
import { startQuiz } from "@/app/(app)/quiz/actions";
import { FileRow } from "@/components/library/file-row";
import { Button, Card, cx } from "@/components/ui";

// The files in a folder, with a Select mode: tick files, then read them one after another or quiz on them.
export function SelectableFiles({ files, label }: { files: LibraryFile[]; label: string }) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // In the order they're listed.
  const chosen = files.filter((f) => picked.includes(f.id));

  const quiz = async () => {
    setStarting(true);
    setError(undefined);
    const settings: QuizSettings = {
      formats: ["mcq"],
      difficulty: "medium",
      course_ids: [],
      topics: [],
      source: "slides",
      count: 10,
      timed: false,
      negative_marking: false,
      materials: { label: chosen.length === 1 ? chosen[0].name : `${chosen.length} files in ${label}`, files: chosen.map((f) => ({ id: f.id })), folder_ids: [] },
    };
    const r = await startQuiz(settings, "custom");
    if ("error" in r) {
      setError(r.error);
      setStarting(false);
    } else router.push(`/quiz/session/${r.id}`);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
        {selecting ? (
          <>
            <button type="button" onClick={() => setPicked(picked.length === files.length ? [] : files.map((f) => f.id))} className="text-xs font-medium text-brand">
              {picked.length === files.length ? "Select none" : "Select all"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelecting(false);
                setPicked([]);
              }}
              className="inline-flex items-center gap-1 text-xs text-muted"
            >
              <X size={13} /> Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setSelecting(true)} className="inline-flex items-center gap-1 text-xs font-medium text-brand">
            <CheckSquare size={13} /> Select files to read or quiz
          </button>
        )}
      </div>
      <Card className="divide-y divide-border p-0">
        {files.map((f) =>
          selecting ? (
            <button
              key={f.id}
              type="button"
              onClick={() => toggle(f.id)}
              className={cx("flex w-full items-center gap-2 pl-3 text-left", picked.includes(f.id) && "bg-brand-soft/40")}
              aria-pressed={picked.includes(f.id)}
              aria-label={`Select ${f.name}`}
            >
              {picked.includes(f.id) ? <CheckSquare size={18} className="shrink-0 text-brand" /> : <Square size={18} className="shrink-0 text-muted" />}
              <span className="min-w-0 flex-1">
                <FileRow file={f} plain />
              </span>
            </button>
          ) : (
            <FileRow key={f.id} file={f} />
          ),
        )}
      </Card>
      {selecting && picked.length > 0 && (
        <div className="sticky bottom-[calc(80px+env(safe-area-inset-bottom,0px))] z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-2 shadow-lg md:bottom-4">
          <span className="px-2 text-sm font-medium">{picked.length} selected</span>
          <Button onClick={() => router.push(`/read?files=${chosen.map((f) => f.id).join(",")}`)}>
            <BookOpenText size={16} /> Read selected
          </Button>
          <Button variant="secondary" onClick={quiz} disabled={starting}>
            {starting ? <Loader2 size={16} className="animate-spin" /> : <ListChecks size={16} />} Quiz on selected
          </Button>
          {error && <span className="text-sm text-danger">{error}</span>}
        </div>
      )}
    </div>
  );
}
