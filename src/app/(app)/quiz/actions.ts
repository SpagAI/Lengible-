"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { AIError } from "@/lib/ai";
import { isMissingTable } from "@/lib/drugs";
import { createQuizSession, markAnswer, type AnswerPayload } from "@/lib/quiz-engine";
import { createDrugQuizSession, type DrugQuizType } from "@/lib/drug-quiz";
import type { Database, Difficulty, Question, QuizSettings } from "@/lib/supabase/types";

// Records one answer of the daily quiz; answering the same question twice keeps the first answer.
export async function answerQuestion(dailyQuizId: string, questionId: string, chosen: number) {
  const { supabase } = await requireUser();
  const { data: q } = await supabase.from("questions").select("answer, course_id, topic_name").eq("id", questionId).single();
  if (!q) return { error: "Question not found." };
  const { data: already } = await supabase.from("attempts").select("id").eq("daily_quiz_id", dailyQuizId).eq("question_id", questionId).maybeSingle();
  const correct = Number(q.answer) === chosen;
  if (!already) {
    await supabase.from("attempts").insert({
      daily_quiz_id: dailyQuizId,
      question_id: questionId,
      course_id: q.course_id,
      chosen,
      correct,
      score: correct ? 1 : 0,
      topic_name: q.topic_name,
    });
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

// ——— Phase 5: quiz engine ———

const errorText = (e: unknown) => {
  const message = (e as { message?: string } | null)?.message ?? "";
  return isMissingTable({ message })
    ? "The quiz tables aren't in your Supabase yet. Run supabase/migrations/0005_quiz_engine.sql in the Supabase SQL Editor, then try again."
    : message || "Something went wrong.";
};

export async function startQuiz(settings: QuizSettings, mode: "custom" | "past") {
  const { supabase } = await requireUser();
  try {
    return await createQuizSession(supabase, settings, mode);
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function startDrugQuiz(opts: { types: DrugQuizType[]; scope: string; count: number; difficulty: Difficulty }) {
  const { supabase } = await requireUser();
  let id: string;
  try {
    id = await createDrugQuizSession(supabase, { ...opts, count: Math.max(3, Math.min(40, opts.count)) });
  } catch (e) {
    return { error: errorText(e) };
  }
  redirect(`/quiz/session/${id}`);
}

// The mini-quiz at the end of "Learn a group".
export async function startGroupQuiz(classId: string) {
  const { supabase } = await requireUser();
  const { data: cls } = await supabase.from("drug_classes").select("name").eq("id", classId).maybeSingle();
  let id: string;
  try {
    id = await createDrugQuizSession(supabase, {
      types: ["class", "mechanism", "side_effects", "odd"],
      scope: classId,
      count: 6,
      difficulty: "medium",
      mode: "group",
      title: `Mini-quiz: ${cls?.name ?? "drug group"}`,
    });
  } catch (e) {
    return { error: errorText(e) };
  }
  redirect(`/quiz/session/${id}?from=learn&class=${classId}`);
}

// A new quiz from questions you got wrong.
export async function retryWrong(sessionId: string) {
  const { supabase } = await requireUser();
  const { data: s } = await supabase.from("quiz_sessions").select("*").eq("id", sessionId).single();
  const { data: atts } = await supabase.from("attempts").select("question_id, score").eq("quiz_session_id", sessionId);
  const ok = new Set((atts ?? []).filter((a) => (a.score ?? 0) >= 0.6).map((a) => a.question_id));
  const ids = (s?.question_ids ?? []).filter((id) => !ok.has(id));
  if (!s || !ids.length) return { error: "Nothing to redo. You got them all!" };
  const { data, error } = await supabase
    .from("quiz_sessions")
    // No "plan": a redo uses exactly these questions and never writes new ones.
    .insert({ mode: s.mode, title: `Redo: ${s.title}`, settings: { ...s.settings, count: ids.length, plan: undefined } as QuizSettings, question_ids: ids })
    .select("id")
    .single();
  if (error) return { error: errorText(error) };
  redirect(`/quiz/session/${data.id}`);
}

export async function startTimer(sessionId: string) {
  const { supabase } = await requireUser();
  await supabase.from("quiz_sessions").update({ started_at: new Date().toISOString() }).eq("id", sessionId).is("started_at", null);
}

// Marks one answer (essays are marked by AI) and saves it. Answering again keeps the first answer.
export async function submitAnswer(sessionId: string, questionId: string, payload: AnswerPayload) {
  const { supabase } = await requireUser();
  const [{ data: q }, { data: s }, { data: already }] = await Promise.all([
    supabase.from("questions").select("*").eq("id", questionId).single(),
    supabase.from("quiz_sessions").select("settings, started_at").eq("id", sessionId).single(),
    supabase.from("attempts").select("score, correct, chosen, answer_text, feedback").eq("quiz_session_id", sessionId).eq("question_id", questionId).maybeSingle(),
  ]);
  if (!q || !s) return { error: "Question not found." };
  if (already) return { ...already, score: already.score ?? (already.correct ? 1 : 0) };
  let r;
  try {
    r = await markAnswer(q as Question, payload, !!s.settings.negative_marking);
  } catch (e) {
    return { error: e instanceof AIError ? `${e.message} Your answer is still here; tap Submit again.` : errorText(e) };
  }
  const row = {
    quiz_session_id: sessionId,
    question_id: questionId,
    course_id: q.course_id,
    chosen: r.chosen as never,
    correct: r.correct,
    score: r.score,
    answer_text: r.text ?? null,
    feedback: r.feedback ?? null,
    topic_name: q.topic_name,
  };
  const { error } = await supabase.from("attempts").insert(row);
  if (error) return { error: errorText(error) };
  if (!s.started_at) await supabase.from("quiz_sessions").update({ started_at: new Date().toISOString() }).eq("id", sessionId);
  return { score: r.score, correct: r.correct, chosen: r.chosen, answer_text: r.text ?? null, feedback: r.feedback ?? null };
}

export async function finishQuiz(sessionId: string) {
  const { supabase } = await requireUser();
  const [{ data: s }, { data: atts }] = await Promise.all([
    supabase.from("quiz_sessions").select("question_ids").eq("id", sessionId).single(),
    supabase.from("attempts").select("score, correct").eq("quiz_session_id", sessionId),
  ]);
  const n = s?.question_ids.length || 1;
  const score = Math.round((100 * (atts ?? []).reduce((t, a) => t + (a.score ?? (a.correct ? 1 : 0)), 0)) / n);
  await supabase.from("quiz_sessions").update({ score, finished_at: new Date().toISOString() }).eq("id", sessionId).is("finished_at", null);
  revalidatePath("/quiz", "layout");
  revalidatePath("/progress");
  return { score };
}

export async function deleteQuizSession(fd: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("quiz_sessions").delete().eq("id", String(fd.get("id")));
  revalidatePath("/quiz", "layout");
}

// Editing a question you think is wrong.
export async function saveQuestion(fd: FormData) {
  const { supabase } = await requireUser();
  const id = String(fd.get("id"));
  const { data: q } = await supabase.from("questions").select("format").eq("id", id).single();
  if (!q) return;
  const text = (k: string) => String(fd.get(k) ?? "").trim();
  const lines = (k: string) =>
    text(k)
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  const update: Database["public"]["Tables"]["questions"]["Update"] = {
    stem: text("stem"),
    explanation: text("explanation") || null,
    topic_name: text("topic_name") || null,
    flagged: fd.get("flagged") === "on",
    edited: true,
    updated_at: new Date().toISOString(),
  };
  if (q.format === "mcq") {
    update.options = lines("options");
    update.answer = Math.max(0, Math.min(update.options.length - 1, Number(text("answer")) - 1));
  } else if (q.format === "tf") {
    // One statement per line, ending in "— T" or "— F".
    const rows = lines("options").map((l) => {
      const m = l.match(/^(.*?)[\s—–-]+\(?\s*(T|F|True|False)\s*\)?$/i);
      return m ? { s: m[1].trim(), v: /^t/i.test(m[2]) } : { s: l, v: false };
    });
    update.options = rows.map((r) => r.s);
    update.answer = rows.map((r) => r.v);
  } else if (q.format === "quickfire" || q.format === "picture") {
    update.answer = text("answer");
  } else {
    update.model_answer = text("model_answer");
    update.marking_points = lines("marking_points").map((l) => {
      const m = l.match(/^(.*?)[\s—–-]+(\d+)\s*(marks?)?$/i);
      return m ? { point: m[1].trim(), marks: Number(m[2]) } : { point: l, marks: 1 };
    });
  }
  await supabase.from("questions").update(update).eq("id", id);
  revalidatePath("/quiz", "layout");
  const back = text("back");
  redirect(back.startsWith("/") ? back : "/quiz?tab=history");
}

export async function deleteQuestion(fd: FormData) {
  const { supabase } = await requireUser();
  const id = String(fd.get("id"));
  // Take it out of any quiz it was in, then delete it.
  const { data: sessions } = await supabase.from("quiz_sessions").select("id, question_ids").contains("question_ids", [id]);
  for (const s of sessions ?? []) await supabase.from("quiz_sessions").update({ question_ids: s.question_ids.filter((x) => x !== id) }).eq("id", s.id);
  await supabase.from("questions").delete().eq("id", id);
  revalidatePath("/quiz", "layout");
  const back = String(fd.get("back") ?? "");
  redirect(back.startsWith("/") ? back : "/quiz?tab=history");
}

export async function unflagQuestion(id: string) {
  const { supabase } = await requireUser();
  await supabase.from("questions").update({ flagged: false, flag_note: null }).eq("id", id);
  revalidatePath("/quiz", "layout");
}
