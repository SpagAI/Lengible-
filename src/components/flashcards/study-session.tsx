"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Flame, Loader2, Pencil, RotateCcw } from "lucide-react";
import type { Grade } from "ts-fsrs";
import type { QueueCard } from "@/lib/flashcards";
import { answer, finishSession } from "@/app/(app)/flashcards/actions";
import { clozeAnswers, clozeFront, clozeFull, previewIntervals, RATINGS, stateLabel } from "@/lib/srs";
import { Button, ButtonLink, Card, cx } from "@/components/ui";

// Cards answered "Again" (or still in short learning steps) come back in this session
// when they fall due within this window.
const REQUEUE_MS = 20 * 60 * 1000;

const ratingStyle: Record<number, string> = {
  1: "bg-danger/10 text-danger hover:bg-danger/20",
  2: "bg-warn/15 text-warn hover:bg-warn/25",
  3: "bg-ok/15 text-ok hover:bg-ok/25",
  4: "bg-brand-soft text-brand-strong hover:bg-brand/20",
};

export function StudySession({ initial, backHref, goal }: { initial: QueueCard[]; backHref: string; goal: number }) {
  const [queue, setQueue] = useState(initial);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [answered, setAnswered] = useState(0);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [day, setDay] = useState<{ done: boolean; reviews: number }>();
  const shownAt = useRef(0);
  const card = queue[0];

  useEffect(() => {
    shownAt.current = Date.now();
  }, [card?.id, queue.length]);

  const intervals = useMemo(() => (card ? previewIntervals(card) : null), [card]);
  const finished = !card;
  useEffect(() => {
    if (finished && answered) void finishSession();
  }, [finished, answered]);

  const rate = useCallback(
    async (grade: Grade) => {
      if (!card || busy) return;
      setBusy(true);
      setError(undefined);
      const r = await answer(card.id, grade, Date.now() - shownAt.current);
      setBusy(false);
      if ("error" in r) return setError(r.error);
      setAnswered((n) => n + 1);
      setCounts((c) => ({ ...c, [grade]: (c[grade] ?? 0) + 1 }));
      setDay({ done: r.dayDone, reviews: r.reviewsToday });
      setRevealed(false);
      const updated = { ...card, ...r.fields };
      const comesBack = new Date(r.fields.due).getTime() - Date.now() < REQUEUE_MS;
      setQueue((q) => {
        const rest = q.slice(1);
        if (!comesBack) return rest;
        // Put it a few cards back (or last), so it isn't shown again straight away.
        const at = Math.min(rest.length, grade === 1 ? 3 : 6);
        return [...rest.slice(0, at), updated, ...rest.slice(at)];
      });
    },
    [card, busy],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        const r = RATINGS.find((x) => x.key === e.key);
        if (r) void rate(r.grade);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, rate]);

  if (finished) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const remembered = total ? Math.round((100 * (total - (counts[1] ?? 0))) / total) : 0;
    return (
      <Card className="space-y-4 text-center">
        <p className="text-4xl">🎉</p>
        <p className="text-lg font-semibold">{answered ? "All done for now!" : "Nothing to study right now."}</p>
        {answered > 0 && (
          <p className="text-sm text-muted">
            {answered} answers · remembered {remembered}% the first time
          </p>
        )}
        {day && (
          <p className={cx("inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium", day.done ? "bg-warn/15 text-warn" : "bg-surface-2 text-muted")}>
            <Flame size={15} /> {day.done ? "Today counts toward your streak" : `${day.reviews}/${goal} answers toward today's streak`}
          </p>
        )}
        <div>
          <ButtonLink href={backHref}>Back to flashcards</ButtonLink>
        </div>
      </Card>
    );
  }

  const isCloze = card.kind === "cloze";
  const front = isCloze ? clozeFront(card.front) : card.front;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="truncate">{card.deck_name}</span>
        <span className="ml-auto shrink-0">
          {queue.length} left · {answered} done
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(100 * answered) / (answered + queue.length)}%` }} />
      </div>

      <Card className="flex min-h-72 flex-col gap-4 p-5">
        <div className="flex items-center gap-2 text-xs">
          <span className={cx("rounded-full px-2 py-0.5 font-medium", card.state === 0 ? "bg-brand-soft text-brand-strong" : "bg-surface-2 text-muted")}>
            {stateLabel(card.state)}
          </span>
          {card.priority === 0 && card.source === "drug" && <span className="rounded-full bg-ok/15 px-2 py-0.5 font-medium text-ok">Syllabus</span>}
          <Link href={`/flashcards/card/${card.id}?back=study`} className="ml-auto inline-flex items-center gap-1 text-muted hover:text-brand" aria-label="Edit card">
            <Pencil size={13} /> Edit
          </Link>
        </div>

        {card.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.image_url} alt="" className="max-h-80 w-full rounded-xl bg-surface-2 object-contain" />
        )}
        <p className="text-lg leading-relaxed font-medium whitespace-pre-wrap">{front}</p>

        {revealed && (
          <div className="space-y-2 border-t border-border pt-4">
            {isCloze ? (
              <>
                <p className="leading-relaxed whitespace-pre-wrap">{clozeFull(card.front)}</p>
                <p className="text-sm font-semibold text-brand">{clozeAnswers(card.front).join(" · ")}</p>
              </>
            ) : (
              <p className="leading-relaxed whitespace-pre-wrap">{card.back}</p>
            )}
            {card.extra && <p className="text-sm whitespace-pre-wrap text-muted">{card.extra}</p>}
            {card.page && <p className="text-xs text-muted">From page {card.page} of your material</p>}
          </div>
        )}
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!revealed ? (
        <Button className="w-full py-3.5" onClick={() => setRevealed(true)}>
          Show answer
        </Button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {RATINGS.map((r) => (
            <button
              key={r.grade}
              type="button"
              disabled={busy}
              onClick={() => rate(r.grade)}
              className={cx("flex flex-col items-center rounded-xl py-2.5 text-sm font-semibold transition disabled:opacity-60", ratingStyle[r.grade])}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : r.label}
              <span className="text-xs font-normal opacity-80">{intervals?.[r.grade]}</span>
            </button>
          ))}
        </div>
      )}
      <p className="hidden text-center text-xs text-muted md:block">
        Keys: space = show answer · 1 Again · 2 Hard · 3 Good · 4 Easy
      </p>
      {revealed && (
        <p className="text-center text-xs text-muted">
          <RotateCcw size={12} className="mr-1 inline align-[-1px]" />
          Again = forgot, comes back in minutes. Good = remembered.
        </p>
      )}
    </div>
  );
}
