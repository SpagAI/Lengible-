"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { postJSON } from "@/lib/fetch-json";
import { Button, Card } from "@/components/ui";

type Step = { status: "done" | "more" | "rate_limited" | "error"; message?: string; have?: number; want?: number };

// Asks the server for questions a batch at a time until the quiz is full, then shows it.
export function QuizGenerator({ sessionId, have, want }: { sessionId: string; have: number; want: number }) {
  const router = useRouter();
  const [count, setCount] = useState(have);
  const [problem, setProblem] = useState<string>();
  const [running, setRunning] = useState(true);
  const started = useRef(false);

  async function run() {
    setRunning(true);
    setProblem(undefined);
    for (let i = 0; i < 12; i++) {
      const r = await postJSON<Step>(`/api/quiz/sessions/${sessionId}/generate`);
      if (r.have !== undefined) setCount(r.have);
      if (r.status === "done") return router.refresh();
      if (r.status !== "more") {
        setRunning(false);
        return setProblem(r.message ?? "Something went wrong.");
      }
    }
    setRunning(false);
    setProblem("This is taking a while. Tap to carry on.");
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="space-y-4 text-center">
      <Sparkles className="mx-auto text-brand" />
      <p className="font-medium">{running ? "Writing your questions…" : "Paused"}</p>
      <p className="text-sm text-muted">
        {count} of {want} ready. Questions you&apos;ve already got in your bank are reused; the AI writes the rest from your material.
      </p>
      <div className="mx-auto h-2 max-w-xs overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-brand transition-all" style={{ width: `${(100 * count) / Math.max(1, want)}%` }} />
      </div>
      {running && <Loader2 className="mx-auto animate-spin text-muted" />}
      {problem && (
        <div className="space-y-3">
          <p className="text-sm text-danger">{problem}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={run}>Try again</Button>
            {count > 0 && (
              <Link href={`/quiz/session/${sessionId}?ready=1`} className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-medium">
                Start with the {count} ready
              </Link>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
