"use client";

import { Fragment, useCallback, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, BookOpen, ExternalLink, FileText, ListChecks, Loader2, Sparkles, X } from "lucide-react";
import type { AskResult, AskScope } from "@/lib/ask";
import type { QuizSettings } from "@/lib/supabase/types";
import { startQuiz } from "@/app/(app)/quiz/actions";
import { saveAllyChat } from "@/app/(app)/ally/actions";
import { Button, Card, cx } from "@/components/ui";
import { InfoTip } from "@/components/info-tip";

export type Turn = { q: string; result?: AskResult; error?: string };

export const EXAMPLES = [
  "Explain the mechanism of action of warfarin from my slides",
  "A 60-year-old with bone pain, anaemia and renal failure: what's going on and how is it managed?",
  "How many times has sickle cell disease come up in MB essays?",
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
export function AnswerText({ text, onCite }: { text: string; onCite: (n: number) => void }) {
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

export function Answer({ turn, onPick }: { turn: Turn; onPick: (q: string) => void }) {
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
      {(r.past ?? []).length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Past questions on this</p>
          <ul className="space-y-1.5">
            {r.past.slice(0, r.intent === "questions" ? 15 : 5).map((p) => (
              <li key={p.question} className="rounded-xl border border-border px-3 py-2 text-sm">
                <span className={cx("mr-2 inline-block rounded-md px-1.5 text-[11px] font-semibold", p.times > 1 ? "bg-brand text-on-brand" : "bg-surface-2 text-muted")}>{p.times}×</span>
                {p.question}
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {p.when.map((w) => (
                    <span key={w} className="rounded-full bg-surface-2 px-2 py-0.5">
                      {w}
                    </span>
                  ))}
                  <Link href={`/library/file/${p.file_id}${p.page ? `?page=${p.page}` : ""}`} className="font-medium text-brand">
                    Open paper
                  </Link>
                </span>
              </li>
            ))}
          </ul>
          <Link href="/questions" className="mt-1 inline-block text-xs font-medium text-brand">
            All past questions and trends →
          </Link>
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
            <button key={f} type="button" onClick={() => onPick(f)}
              title="Puts it in the box; edit it or press send" className="rounded-full border border-border px-3 py-1 text-left text-xs text-muted hover:bg-surface-2">
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// One Ally conversation: asks with the last answers as context and saves the chat after every answer.
export function useAllyChat({ scope, scopeLabel, initial }: { scope: AskScope; scopeLabel: string; initial?: { id: string; turns: Turn[] } }) {
  const [turns, setTurns] = useState<Turn[]>(initial?.turns ?? []);
  const [chatId, setChatId] = useState<string | null>(initial?.id ?? null);
  const [busy, setBusy] = useState(false);
  // Saved history needs migration 0008; without it chats still work, they just aren't kept.
  const [notSaved, setNotSaved] = useState(false);
  const idRef = useRef<string | null>(initial?.id ?? null);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setBusy(true);
      const before = turns;
      const history = before.filter((t) => t.result).map((t) => ({ q: t.q, a: t.result!.answer }));
      setTurns([...before, { q }]);
      let turn: Turn;
      try {
        const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, scope, history }) });
        const body = await res.json();
        turn = body.error ? { q, error: body.error } : { q, result: body as AskResult };
      } catch {
        turn = { q, error: "Couldn't reach Lengible. Check your connection and try again." };
      }
      const next = [...before, turn];
      setTurns(next);
      setBusy(false);
      const saved = await saveAllyChat({ id: idRef.current, title: next[0].q, scope, scope_label: scopeLabel, messages: next }).catch(() => ({ error: "offline" }));
      if ("id" in saved && saved.id) {
        idRef.current = saved.id;
        setChatId(saved.id);
      } else setNotSaved(true);
    },
    [busy, turns, scope, scopeLabel],
  );
  const reset = useCallback(() => {
    setTurns([]);
    setChatId(null);
    idRef.current = null;
  }, []);
  return { turns, send, busy, chatId, reset, notSaved };
}

// Ask Ally about your materials, within a course, folder or file (a compact panel on those pages).
// The full chat, with your saved conversations, is on the Ask Ally page.
export function AskPanel({ scope, scopeLabel }: { scope: AskScope; scopeLabel: string; compact?: boolean }) {
  const { turns, send, busy, chatId, reset } = useAllyChat({ scope, scopeLabel });
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const fill = (q: string) => {
    setText(q);
    input.current?.focus();
  };
  const submit = () => {
    const q = text;
    setText("");
    void send(q);
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <AllyMark size={26} />
        <h2 className="font-semibold">Ask Ally</h2>
        <InfoTip label="Ask Ally">
          Ally is Lengible&apos;s study assistant. Ask in your own words: Ally looks at how your files are grouped, searches the text of every
          processed slide (with synonyms and drug/disease names), and answers from your slides with numbered sources you can open. Ask “which
          slides cover…”, or “quiz me on…” to get a quiz from exactly those slides. Chats are saved on the Ask Ally page.
        </InfoTip>
        <span className="ml-auto inline-flex min-w-0 items-center gap-1 truncate text-xs text-muted">
          <FileText size={13} className="shrink-0" /> <span className="truncate">{scopeLabel}</span>
        </span>
      </div>

      {turns.map((t, i) => (
        <div key={i} className="space-y-2 border-t border-border pt-3 first:border-0 first:pt-0">
          <div className="flex items-start gap-2">
            <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm text-on-brand">{t.q}</p>
          </div>
          {t.result ? (
            <Answer turn={t} onPick={fill} />
          ) : t.error ? (
            <p className="text-sm text-danger">{t.error}</p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Ally is searching your slides…
            </p>
          )}
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-1.5 focus-within:border-brand"
      >
        <textarea
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={turns.length ? "Ask a follow-up…" : "Ask Ally about these slides…"}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
          aria-label="Your question"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="Send"
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand text-on-brand disabled:opacity-40"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
        </button>
      </form>
      {turns.length > 0 && (
        <div className="flex items-center gap-3 text-xs">
          {chatId && (
            <Link href={`/ally?chat=${chatId}`} className="inline-flex items-center gap-1 font-medium text-brand">
              Continue in Ally <ExternalLink size={12} />
            </Link>
          )}
          <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-muted hover:text-text">
            <X size={12} /> New question
          </button>
        </div>
      )}
    </Card>
  );
}

// Ally's mark: a small round badge with a sparkle.
export function AllyMark({ size = 28 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-strong text-on-brand shadow-sm" style={{ width: size, height: size }} aria-hidden>
      <Sparkles size={Math.round(size * 0.55)} />
    </span>
  );
}
