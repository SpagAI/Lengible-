"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Loader2 } from "lucide-react";
import { loadDrugs } from "@/app/(app)/drugs/actions";
import { Button } from "@/components/ui";

export function LoadDrugsButton({ label, variant = "primary" }: { label: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; message?: string }>({ busy: false });
  return (
    <div className="space-y-2">
      <Button
        variant={variant}
        disabled={state.busy}
        onClick={async () => {
          setState({ busy: true });
          const r = await loadDrugs();
          setState({ busy: false, message: "error" in r ? r.error : `Done: ${r.added} added, ${r.updated} refreshed.` });
          router.refresh();
        }}
      >
        {state.busy ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />} {state.busy ? "Loading… (about a minute)" : label}
      </Button>
      {state.message && <p className="text-sm text-muted">{state.message}</p>}
    </div>
  );
}
