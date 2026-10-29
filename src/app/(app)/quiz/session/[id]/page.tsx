import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourses } from "@/lib/courses";
import { PageHeader } from "@/components/ui";
import { QuizPlayer, type PlayerQuestion, type Result } from "@/components/quiz/quiz-player";
import { QuizGenerator } from "@/components/quiz/quiz-generator";
import type { Question, QuizSession } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Quiz" };
// Essay marking (a server action on this page) can take a while on the free AI tier.
export const maxDuration = 300;

export default async function QuizSessionPage({ params, searchParams }: PageProps<"/quiz/session/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const { data } = await supabase.from("quiz_sessions").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const session = data as QuizSession;
  const plan = (session.settings as { plan?: Record<string, number> }).plan;
  const want = plan ? Object.values(plan).reduce((a, b) => a + b, 0) : session.question_ids.length;
  const fromLearn = sp.from === "learn" && typeof sp.class === "string";
  const doneHref = fromLearn ? `/drugs/class/${sp.class}/learn` : session.mode === "drugs" ? "/quiz?tab=drugs" : "/quiz?tab=build";
  const back = (
    <Link href={fromLearn ? doneHref : "/quiz?tab=history"} className="mb-2 inline-flex items-center gap-1 text-sm text-brand">
      <ChevronLeft size={16} /> {fromLearn ? "Back to the group" : "Quizzes"}
    </Link>
  );

  const generating = !session.finished_at && session.question_ids.length < want && sp.ready !== "1" && (session.mode === "custom" || session.mode === "past");
  if (generating) {
    return (
      <div className="mx-auto max-w-2xl">
        {back}
        <PageHeader title={session.title} />
        <QuizGenerator sessionId={id} have={session.question_ids.length} want={want} />
      </div>
    );
  }

  const [{ data: qs }, { data: atts }, courses] = await Promise.all([
    session.question_ids.length ? supabase.from("questions").select("*").in("id", session.question_ids) : Promise.resolve({ data: [] }),
    supabase.from("attempts").select("question_id, score, correct, chosen, answer_text, feedback").eq("quiz_session_id", id),
    getCourses(supabase),
  ]);
  const ordered = session.question_ids.map((qid) => (qs ?? []).find((q) => q.id === qid)).filter(Boolean) as Question[];
  const withImages = ordered.filter((q) => q.image_path);
  const { data: signed } = withImages.length
    ? await supabase.storage.from("library").createSignedUrls(withImages.map((q) => q.image_path!), 6 * 3600)
    : { data: [] as { signedUrl: string }[] };
  const questions: PlayerQuestion[] = ordered.map((q) => ({
    ...q,
    image_url: q.image_path ? (signed?.[withImages.findIndex((w) => w.id === q.id)]?.signedUrl ?? null) : null,
  }));
  const initial: Record<string, Result> = Object.fromEntries(
    (atts ?? []).map((a) => [a.question_id, { score: a.score ?? (a.correct ? 1 : 0), correct: a.correct, chosen: a.chosen, answer_text: a.answer_text, feedback: a.feedback }]),
  );
  const notes = session.settings.notes ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      {back}
      <PageHeader title={session.title} subtitle={session.time_limit ? `Timed: ${Math.round(session.time_limit / 60)} minutes` : undefined} />
      {notes.map((n) => (
        <p key={n} className="mb-3 rounded-xl bg-warn/10 p-3 text-sm text-warn">
          {n}
        </p>
      ))}
      {questions.length ? (
        <QuizPlayer
          session={session}
          questions={questions}
          initial={initial}
          courseNames={Object.fromEntries(courses.map((c) => [c.id, c.short_name || c.name]))}
          doneHref={doneHref}
          doneLabel={fromLearn ? "Back to the group" : "Another quiz"}
        />
      ) : (
        <p className="text-sm text-muted">This quiz has no questions.</p>
      )}
    </div>
  );
}
