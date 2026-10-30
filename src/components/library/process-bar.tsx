"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { useBackgroundWork, type StoredFile } from "@/components/background-work";
import { Button, Card } from "@/components/ui";

// Files stored in this course or folder that haven't been read yet: process them all, or one at a time from the list.
export function ProcessBar({ files }: { files: StoredFile[] }) {
  const { addProcessJobs, jobs } = useBackgroundWork();
  const [started, setStarted] = useState(false);
  const busy = new Set(jobs.filter((j) => ["waiting", "uploading", "reading", "analysing"].includes(j.progress.stage)).flatMap((j) => [j.id, j.processFileId]));
  const waiting = files.filter((f) => !busy.has(f.id));
  if (!waiting.length) return null;
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-3 border-brand/40">
      <span className="min-w-0 flex-1 text-sm">
        <b>
          {waiting.length} file{waiting.length === 1 ? "" : "s"}
        </b>{" "}
        here {waiting.length === 1 ? "is" : "are"} stored but not processed yet (no topics, quizzes or flashcards from {waiting.length === 1 ? "it" : "them"}).
        {started && <span className="block text-xs text-muted">Processing. Follow it in the corner panel; you can leave this page.</span>}
      </span>
      <Button
        onClick={() => {
          addProcessJobs(waiting);
          setStarted(true);
        }}
      >
        <Play size={16} /> Process {waiting.length === 1 ? "it" : `all ${waiting.length}`}
      </Button>
    </Card>
  );
}

export function ProcessFileButton({ file }: { file: StoredFile }) {
  const { addProcessJobs, jobs } = useBackgroundWork();
  const busy = jobs.some((j) => (j.id === file.id || j.processFileId === file.id) && ["waiting", "uploading", "reading", "analysing"].includes(j.progress.stage));
  return (
    <Button onClick={() => addProcessJobs([file])} disabled={busy}>
      <Play size={16} /> {busy ? "Processing… (see the corner panel)" : "Process this file"}
    </Button>
  );
}
