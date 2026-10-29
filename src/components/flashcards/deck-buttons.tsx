"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { createDrugDeck, createSyllabusDecks, refreshDrugDeck } from "@/app/(app)/flashcards/actions";
import { postJSON } from "@/lib/fetch-json";
import { Button } from "@/components/ui";

type Variant = "primary" | "secondary";

// A button that runs a server task and shows its result underneath.
function TaskButton({ label, busyLabel, icon, variant = "secondary", run }: {
  label: string;
  busyLabel: string;
  icon: React.ReactNode;
  variant?: Variant;
  run: () => Promise<{ message?: string; error?: string; more?: boolean } | void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; more?: boolean }>();
  return (
    <div className="space-y-1.5">
      <Button
        variant={variant}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setResult(undefined);
          const r = await run();
          setBusy(false);
          if (r) setResult({ ok: !r.error, text: r.error ?? r.message ?? "", more: r.more });
          router.refresh();
        }}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : icon} {busy ? busyLabel : result?.more ? `${label} (next pages)` : label}
      </Button>
      {result?.text && <p className={result.ok ? "text-sm text-muted" : "text-sm text-danger"}>{result.text}</p>}
    </div>
  );
}

export function SyllabusDecksButton({ variant }: { variant?: Variant }) {
  return (
    <TaskButton
      label="Make decks for my Pharmacology syllabus"
      busyLabel="Making decks…"
      icon={<Layers size={16} />}
      variant={variant}
      run={() => createSyllabusDecks()}
    />
  );
}

export function DrugDeckButton({ classId }: { classId: string }) {
  return (
    <TaskButton
      label="Make flashcards for this group"
      busyLabel="Making cards…"
      icon={<Layers size={16} />}
      run={async () => (await createDrugDeck(classId)) ?? undefined}
    />
  );
}

export function RefreshDrugDeckButton({ deckId }: { deckId: string }) {
  return <TaskButton label="Update from drug database" busyLabel="Updating…" icon={<RefreshCw size={16} />} run={() => refreshDrugDeck(deckId)} />;
}

// Material decks: each tap makes up to 15 cards from the next pages of the file.
export function MaterialCardsButton({ fileId, label = "Make flashcards", variant }: { fileId: string; label?: string; variant?: Variant }) {
  return (
    <TaskButton
      label={label}
      busyLabel="Reading and making cards… (up to a minute)"
      icon={<Sparkles size={16} />}
      variant={variant}
      run={async () => {
        const r = await postJSON<{ status: string; message: string }>(`/api/files/${fileId}/flashcards`);
        if (r.status === "error" || r.status === "rate_limited") return { error: r.message };
        return { message: r.message, more: r.status === "more" };
      }}
    />
  );
}
