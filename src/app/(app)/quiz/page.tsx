import type { Metadata } from "next";
import { Flame } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getTodayQuiz } from "@/lib/quiz";
import { getStreak } from "@/lib/progress";
import { getCourses } from "@/lib/courses";
import { isAIConfigured } from "@/lib/ai";
import { aiConfig } from "@/config/ai";
import { PageHeader, Card } from "@/components/ui";
import { DailyQuiz } from "@/components/quiz/daily-quiz";
import { StartQuiz } from "@/components/quiz/start-quiz";

export const metadata: Metadata = { title: "Quiz" };

export default async function QuizPage() {
  const { supabase } = await requireUser();
  const [today, streak, courses] = await Promise.all([getTodayQuiz(supabase), getStreak(supabase), getCourses(supabase)]);
  const names = Object.fromEntries(courses.map((c) => [c.id, c.short_name || c.name]));

  return (
    <>
      <PageHeader
        title="Daily quiz"
        subtitle="10 questions a day from your own materials, across all your courses."
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-3 py-1.5 text-sm font-semibold text-warn">
            <Flame size={16} /> {streak.current}
          </span>
        }
      />
      {today ? (
        <DailyQuiz
          quizId={today.quiz.id}
          questions={today.questions}
          answered={Object.fromEntries(today.attempts.map((a) => [a.question_id, Number(a.chosen)]))}
          courseNames={names}
          finished={!!today.quiz.completed_at}
          streak={streak.current + (streak.doneToday ? 0 : 1)}
          sourceKinds={today.sourceKinds}
        />
      ) : (
        <Card className="space-y-3">
          <p className="font-medium">Today&apos;s 10 questions are ready to be made.</p>
          <p className="text-sm text-muted">
            They come from your uploaded slides, notes and past questions first, topped up with standard textbook knowledge. Every question shows its
            reference in the corner: <b>Your material</b>, <b>Past question</b>, <b>MB question</b> or <b>Standard reference</b>. Courses with an
            exam or EOPT in the next two weeks get more questions. Finish the 10 to keep your streak going.
          </p>
          {isAIConfigured() ? (
            <StartQuiz />
          ) : (
            <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">The AI key isn&apos;t set up yet. Add GEMINI_API_KEY in Vercel, then redeploy.</p>
          )}
        </Card>
      )}
      <p className="mt-6 text-xs text-muted">
        Questions are written by Google Gemini (model: {aiConfig.model}) from your uploads first, then standard textbooks. Best streak: {streak.best} days. Choosing difficulty, essays, true/false and past-question mode come with the full quiz engine (Phase 5).
      </p>
    </>
  );
}
