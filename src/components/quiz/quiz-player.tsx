"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, Clock, Flag, Loader2, Pencil, RotateCcw, XCircle } from "lucide-react";
import type { EssayFeedback, Question, QuizSettings } from "@/lib/supabase/types";
import type { SourceKind } from "@/lib/quiz";
import type { AnswerPayload } from "@/lib/quiz-engine";
import { finishQuiz, flagQuestion, retryWrong, startTimer, submitAnswer } from "@/app/(app)/quiz/actions";
import { Button, ButtonLink, Card, cx, inputClass } from "@/components/ui";
import { ReferenceTag } from "@/components/quiz/reference-tag";

const LETTERS = "ABCDE";
const FORMAT_NAME: Record<string, string> = {
  mcq: "MCQ",
  tf: "True/False",
  quickfire: "Quick-fire",
  short_essay: "Short essay",
  long_essay: "Long essay",
  picture: "Picture test",
};

export type PlayerQuestion = Question & { image_url?: string | null };
export type Result = { score: number; correct: boolean; chosen: unknown; answer_text: string | null; feedback: EssayFeedback | null };

const sourceKind = (q: Question): SourceKind => (q.source_kind ?? (q.source_file_id ? "material" : "standard")) as SourceKind;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function QuizPlayer({
  session,
  questions,
  initial,
  courseNames,
  doneHref,
  doneLabel,
}: {
  session: { id: string; title: string; time_limit: number | null; started_at: string | null; finished_at: string | null; settings: QuizSettings; score: number | null };
  questions: PlayerQuestion[];
  initial: Record<string, Result>;
  courseNames: Record<string, string>;
  doneHref: string;
  doneLabel: string;
}) {
  const router = useRouter();
  const [results, setResults] = useState<Record<string, Result>>(initial);
  const firstOpen = questions.findIndex((q) => !initial[q.id]);
  const [index, setIndex] = useState(firstOpen === -1 ? questions.length : firstOpen);
  const [finished, setFinished] = useState(!!session.finished_at);
  const [finalScore, setFinalScore] = useState(session.score);
  const [pending, start] = useTransition();

  // Timer: counts down from when the quiz was first opened.
  const [startedAt] = useState(() => (session.started_at ? new Date(session.started_at).getTime() : session.time_limit ? Date.now() : null));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!session.time_limit || finished) return;
    if (!session.started_at) void startTimer(session.id);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session.time_limit, session.id, session.started_at, finished]);
  const left = session.time_limit && startedAt ? Math.max(0, session.time_limit - Math.floor((now - startedAt) / 1000)) : null;

  const finish = () =>
    start(async () => {
      const r = await finishQuiz(session.id);
      setFinalScore(r.score);
      setFinished(true);
      router.refresh();
    });
  useEffect(() => {
    if (left === 0 && !finished) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, finished]);

  if (finished || index >= questions.length) {
    return (
      <Summary
        sessionId={session.id}
        questions={questions}
        results={results}
        score={finalScore}
        saved={finished}
        onSave={finish}
        pending={pending}
        doneHref={doneHref}
        doneLabel={doneLabel}
        courseNames={courseNames}
      />
    );
  }

  const q = questions[index];
  const result = results[q.id];
  const answeredCount = Object.keys(results).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-text">
          {index + 1} of {questions.length}
        </span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5">{FORMAT_NAME[q.format] ?? q.format}</span>
        {q.course_id && courseNames[q.course_id] && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-brand-strong">{courseNames[q.course_id]}</span>}
        {left !== null && (
          <span className={cx("ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold tabular-nums", left < 60 ? "bg-danger/15 text-danger" : "bg-surface-2")}>
            <Clock size={12} /> {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-brand transition-all" style={{ width: `${(100 * answeredCount) / questions.length}%` }} />
      </div>

      <Card className="space-y-4">
        {q.topic_name && <p className="text-xs text-muted">{q.topic_name}</p>}
        {q.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.image_url} alt="" className="max-h-96 w-full rounded-xl bg-surface-2 object-contain" />
        )}
        <p className="text-base leading-relaxed font-medium whitespace-pre-wrap">{q.stem}</p>

        <QuestionBody
          key={q.id}
          q={q}
          result={result}
          onSubmit={async (payload) => {
            const r = await submitAnswer(session.id, q.id, payload);
            if ("error" in r && r.error) return r.error;
            setResults((x) => ({ ...x, [q.id]: r as Result }));
          }}
        />

        <div className="flex justify-end">
          <ReferenceTag q={q} kind={sourceKind(q)} />
        </div>
      </Card>

      {result && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => (index === questions.length - 1 ? finish() : setIndex(index + 1))} disabled={pending}>
            {pending && <Loader2 size={16} className="animate-spin" />} {index === questions.length - 1 ? "See my score" : "Next question"}
          </Button>
          <FlagButton id={q.id} flagged={q.flagged} />
          <Link href={`/quiz/question/${q.id}?back=/quiz/session/${session.id}`} className="inline-flex items-center gap-1 text-xs text-muted">
            <Pencil size={13} /> Edit
          </Link>
        </div>
      )}
      {!result && answeredCount > 0 && (
        <button type="button" onClick={finish} className="text-xs text-muted underline">
          End quiz now (unanswered questions score 0)
        </button>
      )}
    </div>
  );
}

function QuestionBody({ q, result, onSubmit }: { q: PlayerQuestion; result?: Result; onSubmit: (p: AnswerPayload) => Promise<string | void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const send = async (p: AnswerPayload) => {
    setBusy(true);
    setError(undefined);
    const e = await onSubmit(p);
    setBusy(false);
    if (e) setError(e);
  };
  const errorLine = error && <p className="text-sm text-danger">{error}</p>;

  if (q.format === "mcq") return <><Mcq q={q} result={result} busy={busy} onChoose={(i) => send({ kind: "mcq", chosen: i })} />{errorLine}</>;
  if (q.format === "tf") return <><TrueFalse q={q} result={result} busy={busy} onSubmit={(c) => send({ kind: "tf", chosen: c })} />{errorLine}</>;
  if (q.format === "quickfire" || q.format === "picture") return <><Recall q={q} result={result} busy={busy} onMark={(text, ok) => send({ kind: "recall", text, selfCorrect: ok })} />{errorLine}</>;
  return <><Essay q={q} result={result} busy={busy} onSubmit={(text) => send({ kind: "essay", text })} />{errorLine}</>;
}

function Mcq({ q, result, busy, onChoose }: { q: Question; result?: Result; busy: boolean; onChoose: (i: number) => void }) {
  const [picked, setPicked] = useState<number>();
  const chosen = result ? Number(result.chosen) : picked;
  const answer = Number(q.answer);
  const whyWrong = Object.entries(q.why_wrong ?? {}).filter(([k]) => /^\d+$/.test(k) && Number(k) !== answer);
  return (
    <div className="space-y-2">
      {q.options.map((opt, i) => (
        <button
          key={i}
          type="button"
          disabled={!!result || busy}
          onClick={() => {
            setPicked(i);
            onChoose(i);
          }}
          className={cx(
            "flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm transition-colors",
            !result && "border-border hover:border-brand hover:bg-brand-soft/40",
            !result && picked === i && "border-brand bg-brand-soft/40",
            result && i === answer && "border-ok bg-ok/10",
            result && chosen === i && i !== answer && "border-danger bg-danger/10",
            result && chosen !== i && i !== answer && "border-border opacity-70",
          )}
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold">
            {busy && picked === i ? <Loader2 size={12} className="animate-spin" /> : LETTERS[i]}
          </span>
          <span>{opt}</span>
        </button>
      ))}
      {result && (
        <Explain ok={result.correct} title={result.correct ? "Correct" : `Answer: ${LETTERS[answer]}. ${q.options[answer]}`} text={q.explanation}>
          {whyWrong.length > 0 && (
            <ul className="space-y-1 text-muted">
              {whyWrong.map(([k, reason]) => (
                <li key={k}>
                  <b>{LETTERS[Number(k)]}</b> — {reason}
                </li>
              ))}
            </ul>
          )}
        </Explain>
      )}
    </div>
  );
}

function TrueFalse({ q, result, busy, onSubmit }: { q: Question; result?: Result; busy: boolean; onSubmit: (c: (boolean | null)[]) => void }) {
  const key = q.answer as boolean[];
  const [choice, setChoice] = useState<(boolean | null)[]>(() => q.options.map(() => null));
  const shown = result ? ((result.chosen as (boolean | null)[]) ?? []) : choice;
  return (
    <div className="space-y-2">
      {q.options.map((st, i) => {
        const right = result && shown[i] === key[i];
        return (
          <div
            key={i}
            className={cx(
              "flex items-start gap-3 rounded-xl border p-3 text-sm",
              !result && "border-border",
              result && shown[i] === null && "border-border",
              result && shown[i] !== null && (right ? "border-ok bg-ok/10" : "border-danger bg-danger/10"),
            )}
          >
            <span className="font-semibold text-muted">{"abcde"[i] ?? i + 1}.</span>
            <span className="flex-1">
              {st}
              {result && (
                <span className={cx("mt-1 block text-xs font-semibold", key[i] ? "text-ok" : "text-danger")}>
                  {key[i] ? "TRUE" : "FALSE"}
                  {shown[i] === null ? " · you skipped" : right ? " · you got it" : " · you got it wrong"}
                </span>
              )}
            </span>
            {!result && (
              <span className="flex shrink-0 gap-1">
                {([true, false, null] as const).map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => setChoice((c) => c.map((x, j) => (j === i ? v : x)))}
                    className={cx(
                      "min-w-9 rounded-lg border px-2 py-1 text-xs font-semibold",
                      choice[i] === v ? "border-brand bg-brand text-on-brand" : "border-border text-muted hover:bg-surface-2",
                    )}
                    aria-label={v === null ? "Don't know" : v ? "True" : "False"}
                  >
                    {v === null ? "?" : v ? "T" : "F"}
                  </button>
                ))}
              </span>
            )}
          </div>
        );
      })}
      {!result ? (
        <Button onClick={() => onSubmit(choice)} disabled={busy || choice.every((c) => c === null)}>
          {busy && <Loader2 size={16} className="animate-spin" />} Submit
        </Button>
      ) : (
        <Explain ok={result.correct} title={`You scored ${pct(result.score)}`} text={q.explanation} />
      )}
    </div>
  );
}

// Quick-fire and picture questions: type (or just think of) your answer, see the answer, then mark yourself.
function Recall({ q, result, busy, onMark }: { q: Question; result?: Result; busy: boolean; onMark: (text: string, ok: boolean) => void }) {
  const [text, setText] = useState("");
  const [shown, setShown] = useState(false);
  if (result) {
    return (
      <Explain ok={result.correct} title={`Answer: ${String(q.answer)}`} text={q.explanation}>
        {result.answer_text && <p className="text-muted">You wrote: {result.answer_text}</p>}
      </Explain>
    );
  }
  return (
    <div className="space-y-3">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer (optional)" className={inputClass} disabled={shown} />
      {!shown ? (
        <Button variant="secondary" onClick={() => setShown(true)}>
          Show answer
        </Button>
      ) : (
        <>
          <p className="rounded-xl bg-surface-2 p-3 text-sm">
            <b>Answer:</b> {String(q.answer)}
          </p>
          <div className="flex gap-2">
            <Button className="flex-1 bg-ok text-white hover:bg-ok/90" disabled={busy} onClick={() => onMark(text, true)}>
              <CheckCircle2 size={16} /> I got it
            </Button>
            <Button className="flex-1" variant="danger" disabled={busy} onClick={() => onMark(text, false)}>
              <XCircle size={16} /> I missed it
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Essay({ q, result, busy, onSubmit }: { q: Question; result?: Result; busy: boolean; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const total = (q.marking_points ?? []).reduce((t, p) => t + p.marks, 0);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (!result) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted">
          {total} marks · {q.format === "long_essay" ? "aim for a structured answer with headings" : "aim for clear points"}
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={q.format === "long_essay" ? 16 : 9} className={cx(inputClass, "py-2 leading-relaxed")} placeholder="Type your answer…" />
        <div className="flex items-center gap-2">
          <Button onClick={() => onSubmit(text)} disabled={busy || !text.trim()}>
            {busy && <Loader2 size={16} className="animate-spin" />} {busy ? "Marking… (up to a minute)" : "Submit for marking"}
          </Button>
          <span className="ml-auto text-xs text-muted">{wordCount} words</span>
        </div>
      </div>
    );
  }
  const fb = result.feedback;
  const got = fb?.points.reduce((t, p) => t + p.awarded, 0) ?? 0;
  return (
    <div className="space-y-3 text-sm">
      <p className={cx("text-lg font-semibold", result.score >= 0.5 ? "text-ok" : "text-danger")}>
        {Math.round(got * 10) / 10} / {total} marks ({pct(result.score)})
      </p>
      {fb && (
        <>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {fb.points.map((p, i) => (
              <li key={i} className="flex gap-3 p-2.5">
                <span className={cx("w-12 shrink-0 font-semibold tabular-nums", p.awarded >= p.marks ? "text-ok" : p.awarded > 0 ? "text-warn" : "text-danger")}>
                  {p.awarded}/{p.marks}
                </span>
                <span>
                  {p.point}
                  {p.comment && <span className="block text-xs text-muted">{p.comment}</span>}
                </span>
              </li>
            ))}
          </ul>
          {fb.feedback && <p>{fb.feedback}</p>}
          {fb.missed.length > 0 && (
            <div>
              <p className="font-semibold">What you missed</p>
              <ul className="list-disc pl-5 text-muted">
                {fb.missed.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <details className="rounded-xl bg-surface-2 p-3">
        <summary className="flex cursor-pointer items-center gap-1 font-semibold">
          <ChevronDown size={14} /> Model answer
        </summary>
        <p className="mt-2 leading-relaxed whitespace-pre-wrap">{q.model_answer}</p>
      </details>
      {result.answer_text && (
        <details className="rounded-xl bg-surface-2 p-3">
          <summary className="flex cursor-pointer items-center gap-1 font-semibold">
            <ChevronDown size={14} /> Your answer
          </summary>
          <p className="mt-2 leading-relaxed whitespace-pre-wrap">{result.answer_text}</p>
        </details>
      )}
    </div>
  );
}

function Explain({ ok, title, text, children }: { ok: boolean; title: string; text: string | null; children?: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
      <p className={cx("font-semibold", ok ? "text-ok" : "text-danger")}>{title}</p>
      {text && <p className="whitespace-pre-wrap">{text}</p>}
      {children}
    </div>
  );
}

function FlagButton({ id, flagged }: { id: string; flagged: boolean }) {
  const [done, setDone] = useState(flagged);
  return (
    <button
      type="button"
      disabled={done}
      onClick={async () => {
        const note = prompt("What's wrong with this question? (optional)") ?? "";
        await flagQuestion(id, note);
        setDone(true);
      }}
      className="ml-auto inline-flex items-center gap-1 text-xs text-muted"
    >
      <Flag size={13} /> {done ? "Flagged" : "Flag as wrong"}
    </button>
  );
}

function Summary({
  sessionId,
  questions,
  results,
  score,
  saved,
  onSave,
  pending,
  doneHref,
  doneLabel,
  courseNames,
}: {
  sessionId: string;
  questions: PlayerQuestion[];
  results: Record<string, Result>;
  score: number | null;
  saved: boolean;
  onSave: () => void;
  pending: boolean;
  doneHref: string;
  doneLabel: string;
  courseNames: Record<string, string>;
}) {
  const [retrying, startRetry] = useTransition();
  const [retryError, setRetryError] = useState<string>();
  const shownScore = score ?? Math.round((100 * questions.reduce((t, q) => t + (results[q.id]?.score ?? 0), 0)) / (questions.length || 1));
  // Topics from this quiz, weakest first.
  const topics = useMemo(() => {
    const by = new Map<string, { sum: number; n: number; course: string | null }>();
    for (const q of questions) {
      if (!q.topic_name) continue;
      const e = by.get(q.topic_name) ?? { sum: 0, n: 0, course: q.course_id };
      e.sum += results[q.id]?.score ?? 0;
      e.n++;
      by.set(q.topic_name, e);
    }
    return [...by.entries()].map(([t, e]) => ({ topic: t, pct: Math.round((100 * e.sum) / e.n), course: e.course })).sort((a, b) => a.pct - b.pct);
  }, [questions, results]);
  const anyWrong = questions.some((q) => (results[q.id]?.score ?? 0) < 0.6);

  return (
    <div className="space-y-4">
      <Card className="space-y-3 text-center">
        <p className="text-sm text-muted">Your score</p>
        <p className="text-5xl font-semibold">{shownScore}%</p>
        <p className="text-sm text-muted">
          {questions.filter((q) => (results[q.id]?.score ?? 0) >= 0.6).length} of {questions.length} answered well
        </p>
        {!saved && (
          <Button onClick={onSave} disabled={pending}>
            {pending && <Loader2 size={16} className="animate-spin" />} Save my score
          </Button>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {anyWrong && (
            <Button
              variant="secondary"
              disabled={retrying}
              onClick={() =>
                startRetry(async () => {
                  const r = await retryWrong(sessionId);
                  if (r?.error) setRetryError(r.error);
                })
              }
            >
              {retrying ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />} Redo the ones I missed
            </Button>
          )}
          <ButtonLink href={doneHref} variant="secondary">
            {doneLabel}
          </ButtonLink>
        </div>
        {retryError && <p className="text-sm text-muted">{retryError}</p>}
      </Card>

      {topics.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">By topic</h2>
          <ul className="space-y-2 text-sm">
            {topics.map((t) => (
              <li key={t.topic} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {t.topic}
                  {t.course && courseNames[t.course] && <span className="text-xs text-muted"> · {courseNames[t.course]}</span>}
                </span>
                <span className={cx("font-semibold", t.pct >= 70 ? "text-ok" : t.pct >= 50 ? "text-warn" : "text-danger")}>{t.pct}%</span>
                {t.pct < 60 && (
                  <Link href={`/library/search?q=${encodeURIComponent(t.topic)}`} className="text-xs text-brand underline">
                    Revise
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="space-y-2">
        {questions.map((q, i) => {
          const r = results[q.id];
          return (
            <details key={q.id} className="rounded-xl bg-surface p-3 text-sm ring-1 ring-border">
              <summary className="flex cursor-pointer gap-2">
                {!r ? (
                  <span className="mt-0.5 size-[18px] shrink-0 rounded-full border border-border" title="Not answered" />
                ) : r.score >= 0.6 ? (
                  <CheckCircle2 size={18} className="shrink-0 text-ok" />
                ) : (
                  <XCircle size={18} className="shrink-0 text-danger" />
                )}
                <span className="min-w-0 flex-1">
                  {i + 1}. {q.stem}
                </span>
                <span className="shrink-0 text-xs text-muted">{r ? pct(r.score) : "—"}</span>
              </summary>
              <div className="mt-3 space-y-3">
                <QuestionBody q={q} result={r ?? { score: 0, correct: false, chosen: q.format === "tf" ? q.options.map(() => null) : -1, answer_text: null, feedback: null }} onSubmit={async () => {}} />
                <div className="flex items-center gap-2">
                  <Link href={`/quiz/question/${q.id}?back=/quiz/session/${sessionId}`} className="inline-flex items-center gap-1 text-xs text-muted">
                    <Pencil size={13} /> Edit
                  </Link>
                  <span className="ml-auto">
                    <ReferenceTag q={q} kind={sourceKind(q)} />
                  </span>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
