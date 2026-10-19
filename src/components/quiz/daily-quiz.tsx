"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Flag, Flame, Loader2, XCircle, BookOpen, FileText, History, Library } from "lucide-react";
import type { Question } from "@/lib/supabase/types";
import type { SourceKind } from "@/lib/quiz";
import { answerQuestion, finishDailyQuiz, flagQuestion } from "@/app/(app)/quiz/actions";
import { Button, Card, cx } from "@/components/ui";

const LETTERS = "ABCDE";

export function DailyQuiz({
  quizId,
  questions,
  answered,
  courseNames,
  finished,
  streak,
  sourceKinds,
}: {
  sourceKinds: Record<string, SourceKind>;
  quizId: string;
  questions: Question[];
  answered: Record<string, number>;
  courseNames: Record<string, string>;
  finished: boolean;
  streak: number;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number>>(answered);
  const firstOpen = questions.findIndex((q) => answers[q.id] === undefined);
  const [index, setIndex] = useState(firstOpen === -1 ? questions.length : firstOpen);
  const [pending, start] = useTransition();
  const [done, setDone] = useState(finished);
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});

  const score = questions.filter((q) => answers[q.id] === Number(q.answer)).length;

  if (done || index >= questions.length) {
    return (
      <Card className="space-y-4 text-center">
        <p className="text-sm text-muted">Today&apos;s quiz</p>
        <p className="text-5xl font-semibold">
          {score}
          <span className="text-2xl text-muted">/{questions.length}</span>
        </p>
        <p className="flex items-center justify-center gap-2 text-lg font-medium">
          <Flame className="text-warn" /> {streak} day streak
        </p>
        <p className="text-sm text-muted">Come back tomorrow for a fresh 10. Review the answers below anytime today.</p>
        {!done && (
          <Button
            onClick={() =>
              start(async () => {
                await finishDailyQuiz(quizId);
                setDone(true);
                router.refresh();
              })
            }
            disabled={pending}
          >
            {pending ? <Loader2 size={16} className="animate-spin" /> : null} Save my score
          </Button>
        )}
        <div className="space-y-2 text-left">
          {questions.map((q, i) => (
            <details key={q.id} className="rounded-xl bg-surface-2 p-3 text-sm">
              <summary className="flex cursor-pointer gap-2">
                {answers[q.id] === Number(q.answer) ? <CheckCircle2 size={18} className="shrink-0 text-ok" /> : <XCircle size={18} className="shrink-0 text-danger" />}
                <span>
                  {i + 1}. {q.stem}
                </span>
              </summary>
              <Feedback q={q} chosen={answers[q.id]} />
              <div className="mt-2 flex justify-end">
                <ReferenceTag q={q} kind={sourceKinds[q.id] ?? "standard"} />
              </div>
            </details>
          ))}
        </div>
      </Card>
    );
  }

  const q = questions[index];
  const chosen = answers[q.id];
  const revealed = chosen !== undefined;

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-text">
          Question {index + 1} of {questions.length}
        </span>
        {q.course_id && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-brand-strong">{courseNames[q.course_id]}</span>}
        {q.topic_name && <span className="truncate">· {q.topic_name}</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-brand transition-all" style={{ width: `${(100 * index) / questions.length}%` }} />
      </div>
      <p className="text-base leading-relaxed font-medium">{q.stem}</p>
      <div className="space-y-2">
        {q.options.map((opt, i) => {
          const isAnswer = i === Number(q.answer);
          return (
            <button
              key={i}
              type="button"
              disabled={revealed || pending}
              onClick={() =>
                start(async () => {
                  setAnswers((a) => ({ ...a, [q.id]: i }));
                  await answerQuestion(quizId, q.id, i);
                })
              }
              className={cx(
                "flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm transition-colors",
                !revealed && "border-border hover:border-brand hover:bg-brand-soft/40",
                revealed && isAnswer && "border-ok bg-ok/10",
                revealed && chosen === i && !isAnswer && "border-danger bg-danger/10",
                revealed && chosen !== i && !isAnswer && "border-border opacity-70",
              )}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold">{LETTERS[i]}</span>
              <span>{opt}</span>
            </button>
          );
        })}
      </div>

      <div className="flex justify-end">
        <ReferenceTag q={q} kind={sourceKinds[q.id] ?? "standard"} />
      </div>

      {revealed && (
        <>
          <Feedback q={q} chosen={chosen} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                if (index === questions.length - 1) {
                  start(async () => {
                    await finishDailyQuiz(quizId);
                    setDone(true);
                    router.refresh();
                  });
                } else setIndex(index + 1);
              }}
              disabled={pending}
            >
              {index === questions.length - 1 ? "See my score" : "Next question"}
            </Button>
            <button
              type="button"
              disabled={flagged[q.id]}
              onClick={async () => {
                const note = prompt("What's wrong with this question? (optional)") ?? "";
                await flagQuestion(q.id, note);
                setFlagged((f) => ({ ...f, [q.id]: true }));
              }}
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted"
            >
              <Flag size={14} /> {flagged[q.id] ? "Flagged" : "Flag as wrong"}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

function Feedback({ q, chosen }: { q: Question; chosen: number | undefined }) {
  const right = chosen === Number(q.answer);
  const whyWrong = q.why_wrong ?? {};
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
      <p className={cx("font-semibold", right ? "text-ok" : "text-danger")}>
        {right ? "Correct" : `Answer: ${LETTERS[Number(q.answer)]}. ${q.options[Number(q.answer)]}`}
      </p>
      {q.explanation && <p>{q.explanation}</p>}
      {Object.keys(whyWrong).length > 0 && (
        <ul className="space-y-1 text-muted">
          {Object.entries(whyWrong)
            .filter(([k]) => Number(k) !== Number(q.answer))
            .map(([k, reason]) => (
              <li key={k}>
                <b>{LETTERS[Number(k)]}</b> — {reason}
              </li>
            ))}
        </ul>
      )}

    </div>
  );
}

const kindStyle: Record<SourceKind, { label: string; icon: typeof BookOpen; cls: string }> = {
  past: { label: "Past question", icon: History, cls: "bg-warn/15 text-warn" },
  mb: { label: "MB question", icon: History, cls: "bg-warn/15 text-warn" },
  material: { label: "Your material", icon: FileText, cls: "bg-brand-soft text-brand-strong" },
  standard: { label: "Standard reference", icon: Library, cls: "bg-surface-2 text-muted" },
};

// Where a question came from, shown in the corner of every question.
function ReferenceTag({ q, kind }: { q: Question; kind: SourceKind }) {
  const { label, icon: Icon, cls } = kindStyle[kind];
  const detail = q.source_label && q.source_label !== "Standard reference" ? q.source_label : kind === "standard" ? "Standard textbook knowledge" : "";
  const body = (
    <>
      <Icon size={13} className="shrink-0" />
      <span className="shrink-0 font-semibold whitespace-nowrap">{label}</span>
      {detail && <span className="min-w-0 truncate opacity-90">· {detail}</span>}
    </>
  );
  const className = cx("inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs", cls);
  return q.source_file_id ? (
    <Link href={`/library/file/${q.source_file_id}?page=${q.source_page ?? 1}`} className={cx(className, "underline-offset-2 hover:underline")} title="Open the source">
      {body}
    </Link>
  ) : (
    <span className={className} title={detail}>
      {body}
    </span>
  );
}
