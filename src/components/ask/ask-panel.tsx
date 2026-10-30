"use client";

import { Fragment, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, BookOpen, FileText, ListChecks, Loader2, Sparkles, X } from "lucide-react";
import type { AskResult, AskScope } from "@/lib/ask";
import type { QuizSettings } from "@/lib/supabase/types";
import { startQuiz } from "@/app/(app)/quiz/actions";
import { Button, Card, cx } from "@/components/ui";
import { InfoTip } from "@/components/info-tip";

type Turn = { q: string; result?: AskResult; error?: string };

const EXAMPLES = [
  "Explain the mechanism of action of warfarin from my slides",
  "Which slides cover haemolytic anaemia?",
  "Compare first-line TB drugs and their side effects",
  "Quiz me on the antimicrobials slides",
];

// **bold** and [n] citations inside one line of the answer.
function inline(text: string, onCite: (n: number) => void, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  return parts.map((p, i) => {
    const cite = p.match(/^\[(\d+)\]$/);
    if (cite)
      return (
        <button
          key={`${key}-${i}`}
          type="button"
          onClick={() => onCite(Number(cite[1]))}
          className="mx-0.5 inline-grid min-w-5 place-items-center rounded-md bg-brand-soft px-1 align-text-top text-[11px] font-semibold text-brand-strong hover:bg-brand hover:text-on-brand"
          aria-label={`Source ${cite[1]}`}
        >
          {cite[1]}
        </button>
      );
    if (p.startsWith("**") && p.endsWith("**")) return <b key={`${key}-${i}`}>{p.slice(2, -2)}</b>;
    return <Fragment key={`${key}-${i}`}>{p}</Fragment>;
  });
}

// Paragraphs and "- " bullet lists.
function AnswerText({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    const items = bullets;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc space-y-1 pl-5">
        {items.map((b, i) => (
          <li key={i}>{inline(b, onCite, `li-${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^[-*•]\s+/.test(t)) bullets.push(t.replace(/^[-*•]\s+/, ""));
    else {
      flush();
      if (t) {
        const heading = /^#{1,4}\s+/.test(t);
        blocks.push(
          <p key={`p-${blocks.length}`} className={heading ? "font-semibold" : undefined}>
            {inline(t.replace(/^#{1,4}\s+/, ""), onCite, `p-${blocks.length}`)}
          </p>,
        );
      }
    }
  }
  flush();
  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>;
}

function Answer({ turn, onAsk }: { turn: Turn; onAsk: (q: string) => void }) {
  const router = useRouter();
  const r = turn.result!;
  const [open, setOpen] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [quizError, setQuizError] = useState<string>();
  const refs = useRef<Record<number, HTMLLIElement | null>>({});
  const cite = (n: number) => {
    setOpen(n);
    refs.current[n]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const startQuizNow = async () => {
    if (!r.quiz) return;
    setStarting(true);
    setQuizError(undefined);
    const settings: QuizSettings = {
      formats: ["mcq"],
      difficulty: "medium",
      course_ids: [],
      topics: [],
      source: "slides",
      count: r.quiz.count,
      timed: false,
      negative_marking: false,
      materials: r.quiz.materials,
    };
    const res = await startQuiz(settings, "custom");
    if ("error" in res) {
      setQuizError(res.error);
      setStarting(false);
    } else router.push(`/quiz/session/${res.id}`);
  };
  const best = new Set(r.best);
  return (
    <div className="space-y-3">
      <AnswerText text={r.answer} onCite={cite} />
      {r.quiz && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={r.intent === "quiz" ? "primary" : "secondary"} onClick={startQuizNow} disabled={starting}>
            {starting ? <Loader2 size={16} className="animate-spin" /> : <ListChecks size={16} />} {r.intent === "quiz" ? "Start quiz" : "Quiz me on these slides"}
          </Button>
          <InfoTip label="Quiz on these slides">
            {r.quiz.count} multiple-choice questions written only from the slides found here ({r.quiz.materials.files.length} file
            {r.quiz.materials.files.length === 1 ? "" : "s"}). For other formats or more questions, use Quiz → Build your own.
          </InfoTip>
          {quizError && <span className="text-sm text-danger">{quizError}</span>}
        </div>
      )}
      {r.sources.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Sources from your files</p>
          <ol className="space-y-1.5">
            {r.sources.map((s) => (
              <li
                key={s.n}
                ref={(el) => {
                  refs.current[s.n] = el;
                }}
                className={cx("rounded-xl border px-3 py-2 text-sm", open === s.n ? "border-brand bg-brand-soft/40" : "border-border")}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="grid min-w-5 place-items-center rounded-md bg-brand-soft px-1 text-[11px] font-semibold text-brand-strong">{s.n}</span>
                  <button type="button" onClick={() => setOpen(open === s.n ? null : s.n)} className="min-w-0 flex-1 text-left">
                    <span className="font-medium">{s.file_name}</span>
                    <span className="text-muted"> · page {s.page}</span>
                    {best.has(s.n) && <span className="ml-1.5 rounded-full bg-ok/15 px-1.5 text-xs text-ok">Best to read</span>}
                    {s.path && <span className="block truncate text-xs text-muted">{s.path}</span>}
                  </button>
                  <Link href={`/library/file/${s.file_id}?page=${s.page}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand">
                    <BookOpen size={13} /> Open slide
                  </Link>
                </div>
                {open === s.n && <p className="mt-1.5 line-clamp-6 text-xs text-muted">{s.text}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {r.unread > 0 && (
        <p className="text-xs text-muted">
          {r.unread} file{r.unread === 1 ? "" : "s"} in {r.scopeLabel} {r.unread === 1 ? "isn't" : "aren't"} processed yet, so {r.unread === 1 ? "it wasn't" : "they weren't"}{" "}
          searched. Process them in Library to include them.
        </p>
      )}
      {r.follow_ups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.follow_ups.map((f) => (
            <button key={f} type="button" onClick={() => onAsk(f)} className="rounded-full border border-border px-3 py-1 text-left text-xs text-muted hover:bg-surface-2">
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Ask AI about your materials, within a course, folder or file (or everything).
export function AskPanel({
  scope,
  scopeLabel,
  scopes,
  compact,
}: {
  scope?: AskScope;
  scopeLabel?: string;
  // Choices for "Search in" (e.g. your courses), when no fixed scope is given.
  scopes?: { label: string; scope: AskScope }[];
  compact?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(0);
  const current = scope ?? scopes?.[pick]?.scope ?? {};
  const label = scopeLabel ?? scopes?.[pick]?.label ?? "All your materials";

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setText("");
    setBusy(true);
    const history = turns.filter((t) => t.result).map((t) => ({ q: t.q, a: t.result!.answer }));
    setTurns((t) => [...t, { q }]);
    let turn: Turn;
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, scope: current, history }) });
      const body = await res.json();
      turn = body.error ? { q, error: body.error } : { q, result: body as AskResult };
    } catch {
      turn = { q, error: "Couldn't reach Lengible. Check your connection and try again." };
    }
    setTurns((t) => [...t.slice(0, -1), turn]);
    setBusy(false);
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={18} className="text-brand" />
        <h2 className="font-semibold">Ask AI</h2>
        <InfoTip label="Ask AI">
          Ask in your own words. Lengible looks at how your files are grouped, searches the text of every processed slide (with synonyms and
          drug/disease names), and answers from your slides with numbered sources you can open. Ask “which slides cover…”, or “quiz me on…” to
          get a quiz from exactly those slides.
        </InfoTip>
        <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted">
          {scopes && !scope ? (
            <>
              Search in
              <select
                value={pick}
                onChange={(e) => {
                  setPick(Number(e.target.value));
                  setTurns([]);
                }}
                className="min-h-8 rounded-lg border border-border bg-surface px-2 text-xs text-text"
                aria-label="Search in"
              >
                {scopes.map((s, i) => (
                  <option key={i} value={i}>
                    {s.label}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-1 truncate">
              <FileText size={13} className="shrink-0" /> <span className="truncate">{label}</span>
            </span>
          )}
        </span>
      </div>

      {turns.length === 0 && !compact && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => send(e)} className="rounded-full border border-border px-3 py-1.5 text-left text-xs text-muted hover:bg-surface-2">
              {e}
            </button>
          ))}
        </div>
      )}

      {turns.map((t, i) => (
        <div key={i} className="space-y-2 border-t border-border pt-3 first:border-0 first:pt-0">
          <div className="flex items-start gap-2">
            <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm text-on-brand">{t.q}</p>
          </div>
          {t.result ? (
            <Answer turn={t} onAsk={send} />
          ) : t.error ? (
            <p className="text-sm text-danger">{t.error}</p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Searching your slides…
            </p>
          )}
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          rows={compact ? 1 : 2}
          placeholder={turns.length ? "Ask a follow-up…" : compact ? "Ask about these slides…" : "Ask anything about your slides, e.g. “side effects of aminoglycosides”"}
          className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand"
          aria-label="Your question"
        />
        <Button type="submit" disabled={busy || !text.trim()} aria-label="Ask">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
        </Button>
        {turns.length > 0 && (
          <button type="button" onClick={() => setTurns([])} className="grid size-11 place-items-center rounded-xl text-muted hover:bg-surface-2" aria-label="Start over" title="Start over">
            <X size={16} />
          </button>
        )}
      </form>
    </Card>
  );
}
