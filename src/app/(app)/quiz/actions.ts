"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";

// Records one answer of the daily quiz; answering the same question twice keeps the first answer.
export async function answerQuestion(dailyQuizId: string, questionId: string, chosen: number) {
  const { supabase } = await requireUser();
  const { data: q } = await supabase.from("questions").select("answer, course_id").eq("id", questionId).single();
  if (!q) return { error: "Question not found." };
  const { data: already } = await supabase.from("attempts").select("id").eq("daily_quiz_id", dailyQuizId).eq("question_id", questionId).maybeSingle();
  const correct = Number(q.answer) === chosen;
  if (!already) {
    await supabase.from("attempts").insert({ daily_quiz_id: dailyQuizId, question_id: questionId, course_id: q.course_id, chosen, correct });
  }
  return { correct };
}

export async function finishDailyQuiz(dailyQuizId: string) {
  const { supabase } = await requireUser();
  const { data: attempts } = await supabase.from("attempts").select("correct").eq("daily_quiz_id", dailyQuizId);
  const score = (attempts ?? []).filter((a) => a.correct).length;
  await supabase.from("daily_quizzes").update({ score, completed_at: new Date().toISOString() }).eq("id", dailyQuizId).is("completed_at", null);
  revalidatePath("/", "layout");
  return { score };
}

export async function flagQuestion(questionId: string, note: string) {
  const { supabase } = await requireUser();
  await supabase.from("questions").update({ flagged: true, flag_note: note.slice(0, 500) || null }).eq("id", questionId);
}
