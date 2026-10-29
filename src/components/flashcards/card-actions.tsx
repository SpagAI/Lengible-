"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { deleteCard, resetCard, setSuspended } from "@/app/(app)/flashcards/actions";

// Small per-card controls on the deck page: pause (suspend), start again, delete.
export function CardActions({ id, suspended, deletedHref }: { id: string; suspended: boolean; deletedHref?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>, ask?: string, then?: string) => () => {
    if (ask && !confirm(ask)) return;
    start(async () => {
      await fn();
      if (then) router.push(then);
      else router.refresh();
    });
  };
  const btn = "rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50";
  return (
    <span className="flex shrink-0 items-center">
      {pending && <Loader2 size={14} className="animate-spin text-muted" />}
      <button type="button" disabled={pending} className={btn} onClick={run(() => setSuspended(id, !suspended))} aria-label={suspended ? "Resume card" : "Pause card"} title={suspended ? "Resume" : "Pause (skip in study)"}>
        {suspended ? <Play size={15} /> : <Pause size={15} />}
      </button>
      <button type="button" disabled={pending} className={btn} onClick={run(() => resetCard(id), "Start this card again as new?")} aria-label="Start again" title="Start again as new">
        <RotateCcw size={15} />
      </button>
      <button type="button" disabled={pending} className={btn} onClick={run(() => deleteCard(id), "Delete this card?", deletedHref)} aria-label="Delete card" title="Delete">
        <Trash2 size={15} />
      </button>
    </span>
  );
}
