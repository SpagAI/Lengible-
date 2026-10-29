import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { formatLabel } from "@/lib/quiz-engine";
import { deleteQuestion, saveQuestion } from "../../actions";
import { PageHeader, Card, Button, Field, inputClass } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import type { Question } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Edit question" };

export default async function EditQuestionPage({ params, searchParams }: PageProps<"/quiz/question/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const { data } = await supabase.from("questions").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const q = data as Question;
  const back = typeof sp.back === "string" && sp.back.startsWith("/") ? sp.back : "/quiz?tab=history";
  const area = (name: string, value: string, rows = 4) => <textarea name={name} defaultValue={value} rows={rows} className={`${inputClass} py-2`} />;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={back} className="mb-2 inline-flex items-center gap-1 text-sm text-brand">
        <ChevronLeft size={16} /> Back
      </Link>
      <PageHeader title="Edit question" subtitle={`${formatLabel(q.format)} · ${q.difficulty}${q.source_label ? ` · ${q.source_label}` : ""}`} />
      {q.flagged && (
        <p className="mb-3 rounded-xl bg-warn/10 p-3 text-sm text-warn">
          You flagged this question{q.flag_note ? `: “${q.flag_note}”` : "."} Fix it below and untick “Flagged”, or delete it.
        </p>
      )}
      <Card>
        <form action={saveQuestion} className="space-y-4">
          <input type="hidden" name="id" value={q.id} />
          <input type="hidden" name="back" value={back} />
          <Field label={q.format === "tf" ? "Stem" : "Question"}>{area("stem", q.stem, 3)}</Field>
          {q.format === "mcq" && (
            <>
              <Field label="Options (one per line)">{area("options", q.options.join("\n"), 6)}</Field>
              <Field label="Correct option number" hint="1 for the first option, 2 for the second…">
                <input name="answer" type="number" min={1} max={q.options.length} defaultValue={Number(q.answer) + 1} className={inputClass} />
              </Field>
            </>
          )}
          {q.format === "tf" && (
            <Field label="Statements (one per line, ending in — T or — F)">
              {area("options", q.options.map((o, i) => `${o} — ${(q.answer as boolean[])[i] ? "T" : "F"}`).join("\n"), 7)}
            </Field>
          )}
          {(q.format === "quickfire" || q.format === "picture") && <Field label="Answer">{area("answer", String(q.answer), 2)}</Field>}
          {(q.format === "short_essay" || q.format === "long_essay") && (
            <>
              <Field label="Model answer">{area("model_answer", q.model_answer ?? "", 10)}</Field>
              <Field label="Marking points (one per line, ending in — marks)">
                {area("marking_points", (q.marking_points ?? []).map((p) => `${p.point} — ${p.marks}`).join("\n"), 6)}
              </Field>
            </>
          )}
          <Field label="Explanation">{area("explanation", q.explanation ?? "", 4)}</Field>
          <Field label="Topic">
            <input name="topic_name" defaultValue={q.topic_name ?? ""} className={inputClass} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="flagged" defaultChecked={q.flagged} className="size-4" /> Flagged as wrong (kept out of new quizzes)
          </label>
          <Button type="submit">Save changes</Button>
        </form>
      </Card>
      <form action={deleteQuestion} className="mt-4">
        <input type="hidden" name="id" value={q.id} />
        <input type="hidden" name="back" value={back} />
        <ConfirmButton variant="danger" message="Delete this question for good?">
          Delete question
        </ConfirmButton>
      </form>
    </div>
  );
}
