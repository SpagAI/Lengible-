import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJSON } from "@/lib/ai";
import type { Database, Question } from "@/lib/supabase/types";
import { daysUntil, todayISO } from "@/lib/dates";

type DB = SupabaseClient<Database>;

export const DAILY_COUNT = 10;

export type SourceKind = "material" | "past" | "mb" | "standard";

type GeneratedQuestion = {
  stem: string;
  options: string[];
  answer: number;
  explanation: string;
  why_wrong: { option: number; reason: string }[];
  source: number;
  reference: string;
  course: string;
  topic: string;
};

const schema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stem: { type: "string" },
          options: { type: "array", items: { type: "string" }, description: "Exactly 5 options, without letters" },
          answer: { type: "integer", description: "Index 0-4 of the single best answer" },
          explanation: { type: "string", description: "Why the answer is right, 2-4 sentences" },
          why_wrong: {
            type: "array",
            items: { type: "object", properties: { option: { type: "integer" }, reason: { type: "string" } }, required: ["option", "reason"] },
          },
          source: { type: "integer", description: "Number of the excerpt the question is based on, or 0 for standard reference knowledge" },
          reference: {
            type: "string",
            description: "When source is 0: the standard textbook and chapter title it comes from, e.g. 'Robbins Basic Pathology — Cell injury and cell death'. No page or chapter numbers.",
          },
          course: { type: "string", description: "Exactly one of the course names given" },
          topic: { type: "string", description: "Short topic name" },
        },
        required: ["stem", "options", "answer", "explanation", "why_wrong", "source", "reference", "course", "topic"],
      },
    },
  },
  required: ["questions"],
};

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const PAST_TYPES = ["past_questions", "mb_questions"];

// Picks excerpts from your materials, favouring past/MB questions and courses with an exam or EOPT in the next two weeks.
async function pickSources(supabase: DB) {
  const [{ data: courses }, { data: exams }, { data: chunkRefs }, { data: topics }, { data: fileRows }] = await Promise.all([
    supabase.from("courses").select("id, name, is_group").eq("archived", false),
    supabase.from("course_exams").select("course_id, exam_date").eq("confirmed", true),
    supabase.from("chunks").select("id, course_id, file_id, page").not("course_id", "is", null).limit(3000),
    supabase.from("topics").select("course_id, name").neq("session_type", "section").limit(1000),
    supabase.from("files").select("id, name, doc_type"),
  ]);
  const fileInfo = new Map((fileRows ?? []).map((f) => [f.id, f]));
  const isPast = (fileId: string) => PAST_TYPES.includes(fileInfo.get(fileId)?.doc_type ?? "");
  const leaf = (courses ?? []).filter((c) => !c.is_group);
  const soon = new Set((exams ?? []).filter((e) => daysUntil(e.exam_date) >= 0 && daysUntil(e.exam_date) <= 14).map((e) => e.course_id));
  const weight = (courseId: string | null) => (courseId && soon.has(courseId) ? 3 : 1);

  // Weighted sample of up to 7 excerpts, at most 2 per course so every course gets a turn.
  // Weighted random order: each excerpt gets a key random^(1/weight), highest first.
  const pool = (chunkRefs ?? [])
    .map((c) => ({ c, key: Math.random() ** (1 / weight(c.course_id)) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.c);
  const perCourse = new Map<string, number>();
  // Up to 3 past/MB question excerpts first, so the quiz feels like the real exam.
  const picked: typeof pool = pool.filter((c) => isPast(c.file_id)).slice(0, 3);
  for (const c of picked) perCourse.set(c.course_id!, (perCourse.get(c.course_id!) ?? 0) + 1);
  for (const c of pool) {
    if (picked.includes(c)) continue;
    const n = perCourse.get(c.course_id!) ?? 0;
    if (n >= 2) continue;
    perCourse.set(c.course_id!, n + 1);
    picked.push(c);
    if (picked.length >= 7) break;
  }

  const { data: contents } = picked.length
    ? await supabase.from("chunks").select("id, content").in("id", picked.map((p) => p.id))
    : { data: [] as { id: string; content: string }[] };
  const excerpts = picked.map((p) => ({
    ...p,
    content: (contents ?? []).find((c) => c.id === p.id)?.content.slice(0, 2500) ?? "",
    fileName: fileInfo.get(p.file_id)?.name ?? "Your material",
    past: isPast(p.file_id),
  }));
  // Topics from courses with no material yet, so the quiz still covers them.
  const covered = new Set(picked.map((p) => p.course_id));
  const extraTopics = shuffle((topics ?? []).filter((t) => !covered.has(t.course_id) || soon.has(t.course_id))).slice(0, 12);
  return { leaf, excerpts, extraTopics };
}

export async function generateDailyQuiz(supabase: DB) {
  const today = todayISO();
  const { leaf, excerpts, extraTopics } = await pickSources(supabase);
  const courseName = (id: string | null) => leaf.find((c) => c.id === id)?.name ?? "";

  const excerptText = excerpts
    .map((e, i) => `[${i + 1}] ${e.past ? "PAST QUESTIONS " : ""}(${courseName(e.course_id)} — ${e.fileName}, page ${e.page})\n${e.content}`)
    .join("\n\n");
  const prompt =
    `Today is ${today}. Write exactly ${DAILY_COUNT} single-best-answer MCQs for a Nigerian 400-level MBBS student (MB exam standard, medium difficulty).\n` +
    `Courses: ${leaf.map((c) => c.name).join("; ")}.\n` +
    "Base as many questions as possible on the numbered excerpts from the student's own materials (set source to that number). " +
    "If excerpts run out, use established standard knowledge (Robbins pathology, Katzung / Rang & Dale pharmacology level) on the listed topics " +
    "and set source to 0, naming the textbook and chapter title in reference. Excerpts marked PAST QUESTIONS are real past exam questions: " +
    "re-ask them (or close variants) in the same style. Mix the courses. Each question has 5 plausible options and exactly one best answer; explain the answer and say briefly " +
    "why each wrong option is wrong. Do not invent facts, doses or drugs.\n\n" +
    (excerptText ? `Excerpts:\n${excerptText}\n\n` : "") +
    (extraTopics.length ? `Other topics to draw on: ${extraTopics.map((t) => `${courseName(t.course_id)}: ${t.name}`).join("; ")}\n` : "");

  const result = await generateJSON<{ questions: GeneratedQuestion[] }>(prompt, schema, {
    system: "You are a careful medical examiner writing accurate exam questions for revision.",
    temperature: 0.7,
    maxOutputTokens: 16_000,
    cache: false,
  });

  const rows = (result.questions ?? [])
    .filter((q) => q.stem && q.options?.length >= 4 && q.answer >= 0 && q.answer < q.options.length)
    .slice(0, DAILY_COUNT)
    .map((q) => {
      const ex = q.source > 0 ? excerpts[q.source - 1] : undefined;
      const course = leaf.find((c) => c.name.toLowerCase() === q.course?.toLowerCase()) ?? (ex ? leaf.find((c) => c.id === ex.course_id) : undefined);
      return {
        course_id: course?.id ?? null,
        format: "mcq",
        difficulty: "medium",
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation,
        why_wrong: Object.fromEntries((q.why_wrong ?? []).map((w) => [String(w.option), w.reason])),
        source_label: ex ? `${ex.fileName}, page ${ex.page}` : q.reference?.trim() || "Standard textbook knowledge",
        source_file_id: ex?.file_id ?? null,
        source_page: ex?.page ?? null,
        topic_name: q.topic || null,
      };
    });
  if (!rows.length) throw new Error("The AI didn't return usable questions.");

  const { data: saved } = await supabase.from("questions").insert(rows).select("id");
  const ids = (saved ?? []).map((q) => q.id);
  const { error } = await supabase.from("daily_quizzes").insert({ quiz_date: today, question_ids: ids });
  if (error) {
    // Another tab made today's quiz first; drop ours.
    await supabase.from("questions").delete().in("id", ids);
  }
}

export async function getTodayQuiz(supabase: DB) {
  const { data: quiz } = await supabase.from("daily_quizzes").select("*").eq("quiz_date", todayISO()).maybeSingle();
  if (!quiz) return null;
  const [{ data: questions }, { data: attempts }] = await Promise.all([
    supabase.from("questions").select("*").in("id", quiz.question_ids),
    supabase.from("attempts").select("question_id, chosen, correct").eq("daily_quiz_id", quiz.id),
  ]);
  const ordered = quiz.question_ids.map((id) => (questions ?? []).find((q) => q.id === id)).filter(Boolean) as Question[];
  // What kind of source each question came from, for the reference tag on the card.
  const fileIds = [...new Set(ordered.flatMap((q) => (q.source_file_id ? [q.source_file_id] : [])))];
  const { data: files } = fileIds.length ? await supabase.from("files").select("id, doc_type").in("id", fileIds) : { data: [] };
  const docType = new Map((files ?? []).map((f) => [f.id, f.doc_type]));
  const sourceKinds: Record<string, SourceKind> = {};
  for (const q of ordered) {
    const t = q.source_file_id ? docType.get(q.source_file_id) : null;
    sourceKinds[q.id] = !q.source_file_id ? "standard" : t === "mb_questions" ? "mb" : t === "past_questions" ? "past" : "material";
  }
  return { quiz, questions: ordered, attempts: attempts ?? [], sourceKinds };
}
