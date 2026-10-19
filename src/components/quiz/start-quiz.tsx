"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { postJSON } from "@/lib/fetch-json";

export function StartQuiz() {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; message?: string }>({ busy: false });
  return (
    <div className="space-y-2">
      <Button
        disabled={state.busy}
        onClick={async () => {
          setState({ busy: true });
          const body = await postJSON<{ status: string; message?: string }>("/api/quiz/today");
          // Even after an error the quiz may have been saved, so reload to check.
          router.refresh();
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
