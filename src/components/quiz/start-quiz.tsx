"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";

export function StartQuiz() {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; message?: string }>({ busy: false });
  return (
    <div className="space-y-2">
      <Button
        disabled={state.busy}
        onClick={async () => {
          setState({ busy: true });
          const res = await fetch("/api/quiz/today", { method: "POST" });
          const body = await res.json().catch(() => ({ status: "error", message: "No answer from the server." }));
          if (body.status === "ok") router.refresh();
          setState({ busy: false, message: body.status === "ok" ? undefined : body.message });
        }}
      >
        {state.busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {state.busy ? "Writing your 10 questions…" : "Start today's 10 questions"}
      </Button>
      {state.message && <p className="text-sm text-danger">{state.message}</p>}
    </div>
  );
}
