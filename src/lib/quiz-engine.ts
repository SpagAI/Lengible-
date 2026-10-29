import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIError, generateJSON } from "@/lib/ai";
import type { Database, Difficulty, EssayFeedback, MarkingPoint, Question, QuestionFormat, QuizSession, QuizSettings } from "@/lib/supabase/types";
import { PAST_TYPES } from "@/lib/quiz";
import { addDays, todayISO } from "@/lib/dates";

type DB = SupabaseClient<Database>;

export const FORMATS: { value: QuestionFormat; label: string; hint: string; seconds: number }[] = [
  { value: "mcq", label: "MCQ", hint: "Single best answer, 5 options", seconds: 75 },
  { value: "tf", label: "True/False", hint: "A stem with 5 true/false statements", seconds: 120 },
  { value: "quickfire", label: "Quick-fire", hint: "Short recall, answer in a word or line", seconds: 30 },
  { value: "short_essay", label: "Short essay", hint: "Typed answer, marked by AI (about 10 marks)", seconds: 8 * 60 },
  { value: "long_essay", label: "Long essay", hint: "Typed answer, marked by AI (about 20 marks)", seconds: 20 * 60 },
  { value: "picture", label: "Picture test", hint: "From your picture flashcards", seconds: 60 },
];
export const formatLabel = (f: string) => FORMATS.find((x) => x.value === f)?.label ?? f;

const DIFFICULTY_TEXT: Record<Difficulty, string> = {
  easy: "EASY: direct recall of one key fact; clear distractors.",
  medium: "MEDIUM: MB exam standard; understanding and application; plausible distractors.",
  hard: "HARD: clinical vignettes and multi-step reasoning; close distractors; distinctions examiners like to test.",
};

// Aim for this many questions per AI call (essays are long, so fewer).
const BATCH = 8;
const ESSAY_BATCH = 3;

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["drugs", "with", "from", "into", "their", "and", "other", "general", "introduction", "principles", "basic"].includes(w));
// A full-text query that matches any of the topic's main words.
const orQuery = (s: string) => [...new Set(words(s))].slice(0, 6).join(" or ");

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Splits the question count across the chosen formats (pictures first, as many as you have up to their share).
function planFormats(formats: QuestionFormat[], count: number) {
  const plan: Partial<Record<QuestionFormat, number>> = {};
  formats.forEach((f, i) => (plan[f] = Math.floor(count / formats.length) + (i < count % formats.length ? 1 : 0)));
  return plan;
}

// ——— Making a quiz ———

export async function createQuizSession(supabase: DB, input: QuizSettings, mode: "custom" | "past") {
  const settings: QuizSettings = {
    ...input,
    count: Math.max(1, Math.min(40, Math.round(input.count))),
    formats: input.formats.length ? input.formats : ["mcq"],
    source: mode === "past" ? "past" : input.source,
    notes: [],
  };
  const plan = planFormats(settings.formats, settings.count);
  const ids: string[] = [];

  // Picture questions come from your picture flashcards.
  if (plan.picture) {
    const pics = await pictureQuestions(supabase, settings.course_ids, plan.picture);
    ids.push(...pics);
    if (pics.length < plan.picture) {
      settings.notes!.push(
        pics.length
          ? `Only ${pics.length} picture card${pics.length === 1 ? "" : "s"} found, so the quiz has fewer picture questions.`
          : "No picture cards yet. Add picture cards in Flashcards (a slide, specimen or film with its answer) to get picture questions.",
      );
    }
    plan.picture = pics.length;
  }

  // Reuse questions already in your bank that match and that you haven't answered in the last 3 weeks.
  for (const f of settings.formats.filter((x) => x !== "picture")) {
    const reused = await fromBank(supabase, settings, f, plan[f] ?? 0, ids);
    ids.push(...reused);
  }

  const title =
    mode === "past"
      ? "Past-question style"
      : `${settings.formats.map(formatLabel).join(", ")} · ${settings.difficulty[0].toUpperCase()}${settings.difficulty.slice(1)}`;
  const timeLimit = settings.timed ? Object.entries(plan).reduce((t, [f, n]) => t + (FORMATS.find((x) => x.value === f)?.seconds ?? 60) * (n ?? 0), 0) : null;
  const { data, error } = await supabase
    .from("quiz_sessions")
    .insert({ mode, title, settings: { ...settings, plan } as QuizSettings, question_ids: shuffle(ids), time_limit: timeLimit })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, have: ids.length, want: Object.values(plan).reduce((a, b) => a + (b ?? 0), 0) };
}

async function fromBank(supabase: DB, s: QuizSettings, format: QuestionFormat, want: number, exclude: string[]) {
  if (!want) return [];
  let q = supabase.from("questions").select("id").eq("format", format).eq("difficulty", s.difficulty).eq("flagged", false).neq("source_kind", "drugs").limit(200);
  if (s.course_ids.length) q = q.in("course_id", s.course_ids);
  if (s.topics.length) q = q.in("topic_name", s.topics);
  if (s.source === "slides") q = q.not("source_file_id", "is", null);
  if (s.source === "past") q = q.in("source_kind", ["past", "mb"]);
  const { data } = await q;
  const candidates = (data ?? []).map((r) => r.id).filter((id) => !exclude.includes(id));
  if (!candidates.length) return [];
  const since = addDays(todayISO(), -21);
  const { data: recent } = await supabase.from("attempts").select("question_id").in("question_id", candidates.slice(0, 200)).gte("created_at", since);
  const { data: daily } = await supabase.from("daily_quizzes").select("question_ids").eq("quiz_date", todayISO()).maybeSingle();
  const skip = new Set([...(recent ?? []).map((r) => r.question_id), ...(daily?.question_ids ?? [])]);
  return shuffle(candidates.filter((id) => !skip.has(id))).slice(0, want);
}

async function pictureQuestions(supabase: DB, courseIds: string[], want: number) {
  let q = supabase.from("cards").select("id, front, back, image_path, course_id, deck_id").not("image_path", "is", null).eq("suspended", false).limit(300);
  if (courseIds.length) q = q.in("course_id", courseIds);
  const { data: cards } = await q;
  const picked = shuffle(cards ?? []).slice(0, want);
  if (!picked.length) return [];
  const { data: decks } = await supabase.from("decks").select("id, name").in("id", [...new Set(picked.map((c) => c.deck_id))]);
  const rows = picked.map((c) => ({
    card_id: c.id,
    format: "picture" as const,
    difficulty: "medium" as const,
    stem: c.front?.trim() || "Identify what is shown.",
    answer: c.back,
    image_path: c.image_path,
    course_id: c.course_id,
    source_kind: "picture" as const,
    source_label: "Your picture card",
    topic_name: decks?.find((d) => d.id === c.deck_id)?.name ?? null,
  }));
  const { data, error } = await supabase.from("questions").upsert(rows, { onConflict: "user_id,card_id" }).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id);
}

// ——— Generating with AI, a batch at a time ———

type Gen = {
  format: QuestionFormat;
  stem: string;
  options: string[];
  answer_index: number;
  tf_answers: boolean[];
  short_answer: string;
  model_answer: string;
  marking_points: MarkingPoint[];
  explanation: string;
  why_wrong: { option: number; reason: string }[];
  source: number;
  reference: string;
  course: string;
  topic: string;
};

const genSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["quickfire", "mcq", "tf", "short_essay", "long_essay"] },
          stem: { type: "string" },
          options: { type: "array", items: { type: "string" }, description: "mcq: 5 options without letters. tf: exactly 5 statements. Others: empty." },
          answer_index: { type: "integer", description: "mcq only: index 0-4 of the single best answer" },
          tf_answers: { type: "array", items: { type: "boolean" }, description: "tf only: true/false for each statement, in order" },
          short_answer: { type: "string", description: "quickfire only: the answer in a word or short line" },
          model_answer: { type: "string", description: "essays only: a model answer an examiner would accept" },
          marking_points: {
            type: "array",
            items: { type: "object", properties: { point: { type: "string" }, marks: { type: "integer" } }, required: ["point", "marks"] },
            description: "essays only: the marking scheme",
          },
          explanation: { type: "string", description: "Why the answer is right, 2-4 sentences (tf: explain each false statement)" },
          why_wrong: {
            type: "array",
            items: { type: "object", properties: { option: { type: "integer" }, reason: { type: "string" } }, required: ["option", "reason"] },
            description: "mcq only",
          },
          source: { type: "integer", description: "Number of the excerpt the question is based on, or 0 for standard reference knowledge" },
          reference: { type: "string", description: "When source is 0: the standard textbook and chapter title, e.g. 'Katzung — Antimycobacterial drugs'" },
          course: { type: "string" },
          topic: { type: "string" },
        },
        required: ["format", "stem", "explanation", "source", "reference", "course", "topic"],
      },
    },
  },
  required: ["questions"],
};

const FORMAT_RULES: Record<Exclude<QuestionFormat, "picture">, string> = {
  mcq: "mcq: single best answer, 5 plausible options, answer_index, and why_wrong for each wrong option.",
  tf: "tf: Nigerian MB multiple true/false: a short stem (e.g. 'Concerning isoniazid:') and exactly 5 statements in options, each independently true or false; tf_answers in order; mix trues and falses.",
  quickfire: "quickfire: a short direct question answered in a word or one line; give short_answer.",
  short_essay: "short_essay: a 10-mark question (e.g. 'Write short notes on…', 'List and explain…'); model_answer of about 150-250 words; marking_points adding up to 10.",
  long_essay: "long_essay: a 20-mark question needing a structured answer; model_answer of about 400-600 words following the standard structure (pathology: definition → aetiology → pathogenesis → morphology → clinical features → complications; pharmacology: class → mechanism → uses → side effects → contraindications); marking_points adding up to 20.",
};

export type StepResult = { status: "done" | "more" | "rate_limited" | "error"; message?: string; have?: number; want?: number };

export async function generateStep(supabase: DB, sessionId: string): Promise<StepResult> {
  const { data } = await supabase.from("quiz_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!data) return { status: "error", message: "Quiz not found." };
  const session = data as QuizSession;
  const s = session.settings as QuizSettings & { plan: Partial<Record<QuestionFormat, number>> };
  const want = Object.values(s.plan).reduce((a, b) => a + (b ?? 0), 0);

  // What each format still needs.
  const { data: have } = session.question_ids.length
    ? await supabase.from("questions").select("format").in("id", session.question_ids)
    : { data: [] as { format: QuestionFormat }[] };
  const need: Partial<Record<QuestionFormat, number>> = {};
  for (const [f, n] of Object.entries(s.plan) as [QuestionFormat, number][]) {
    if (f === "picture") continue;
    const left = n - (have ?? []).filter((h) => h.format === f).length;
    if (left > 0) need[f] = left;
  }
  if (!Object.keys(need).length) return { status: "done", have: session.question_ids.length, want };

  // This batch: essays are capped so one AI call doesn't run too long.
  const batch: Partial<Record<QuestionFormat, number>> = {};
  let room = BATCH;
  for (const [f, n] of Object.entries(need) as [QuestionFormat, number][]) {
    const take = Math.min(n, f.endsWith("essay") ? ESSAY_BATCH : room, room);
    if (take > 0) batch[f] = take;
    room -= take;
    if (room <= 0) break;
  }

  const [{ data: courseRows }, { data: topicRows }, { data: fileRows }] = await Promise.all([
    supabase.from("courses").select("id, name, is_group").eq("archived", false),
    supabase.from("topics").select("id, name, course_id").neq("session_type", "section").limit(1000),
    supabase.from("files").select("id, name, doc_type"),
  ]);
  const leaf = (courseRows ?? []).filter((c) => !c.is_group && (!s.course_ids.length || s.course_ids.includes(c.id)));
  const fileInfo = new Map((fileRows ?? []).map((f) => [f.id, f]));
  let topics = (topicRows ?? []).filter((t) => leaf.some((c) => c.id === t.course_id));
  if (s.topics.length) topics = topics.filter((t) => s.topics.includes(t.name));

  // Past-question mode: topics that show up most in your past/MB questions come up more often.
  const weight = new Map<string, number>();
  if (s.source === "past") {
    const pastFiles = (fileRows ?? []).filter((f) => PAST_TYPES.includes(f.doc_type)).map((f) => f.id);
    const { data: pastChunks } = pastFiles.length
      ? await supabase.from("chunks").select("content").in("file_id", pastFiles).limit(400)
      : { data: [] as { content: string }[] };
    const text = (pastChunks ?? []).map((c) => c.content.toLowerCase());
    for (const t of topics) {
      const w = words(t.name).slice(0, 3);
      weight.set(t.id, 1 + (w.length ? text.filter((c) => w.every((x) => c.includes(x))).length * 3 : 0));
    }
  }
  const sampled = topics
    .map((t) => ({ t, key: Math.random() ** (1 / (weight.get(t.id) ?? 1)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, 4)
    .map((x) => x.t);

  // Excerpts from your materials for those topics (past/MB question files first in past mode).
  const hits: { chunk_id: string; file_id: string; page: number; course_id: string | null }[] = [];
  for (const t of sampled) {
    const q = orQuery(t.name);
    if (!q) continue;
    const { data: found } = await supabase.rpc("search_chunks", { q, course: t.course_id, lim: 8 });
    const ranked = (found ?? []).filter((h) => fileInfo.get(h.file_id)?.doc_type !== "timetable" && fileInfo.get(h.file_id)?.doc_type !== "topic_list");
    const pastFirst = s.source === "past" ? [...ranked.filter((h) => PAST_TYPES.includes(fileInfo.get(h.file_id)?.doc_type ?? "")), ...ranked] : ranked;
    for (const h of pastFirst.slice(0, 2)) if (!hits.some((x) => x.chunk_id === h.chunk_id)) hits.push(h);
  }
  if (!hits.length && !s.topics.length) {
    // No topic list to search by: take random excerpts from the chosen courses.
    let q = supabase.from("chunks").select("id, file_id, page, course_id").limit(400);
    q = leaf.length ? q.in("course_id", leaf.map((c) => c.id)) : q.not("course_id", "is", null);
    const { data: any } = await q;
    for (const c of shuffle((any ?? []).filter((c) => !["timetable", "topic_list"].includes(fileInfo.get(c.file_id)?.doc_type ?? ""))).slice(0, 5))
      hits.push({ chunk_id: c.id, file_id: c.file_id, page: c.page, course_id: c.course_id });
  }
  if (!hits.length && s.source !== "mixed") {
    return {
      status: "error",
      message:
        s.source === "past"
          ? "No past or MB questions found for these courses/topics. Upload some (type: Past questions) or choose “Slides + standard references”."
          : "None of your uploaded material matches these courses/topics yet. Upload slides, or choose “Slides + standard references”.",
    };
  }
  const picked = hits.slice(0, 6);
  const { data: contents } = picked.length ? await supabase.from("chunks").select("id, content").in("id", picked.map((p) => p.chunk_id)) : { data: [] };
  const excerpts = picked.map((p) => {
    const f = fileInfo.get(p.file_id);
    return {
      ...p,
      fileName: f?.name ?? "Your material",
      kind: (f?.doc_type === "mb_questions" ? "mb" : f?.doc_type === "past_questions" ? "past" : "material") as "mb" | "past" | "material",
      content: (contents ?? []).find((c) => c.id === p.chunk_id)?.content.slice(0, 2200) ?? "",
    };
  });

  const courseName = (id: string | null) => leaf.find((c) => c.id === id)?.name ?? "";
  const askFor = (Object.entries(batch) as [Exclude<QuestionFormat, "picture">, number][]).map(([f, n]) => `${n} × ${f}`).join(", ");
  const sourceRule =
    s.source === "slides"
      ? "Use ONLY the numbered excerpts; every question must set source to its excerpt number."
      : s.source === "past"
        ? "Excerpts marked PAST QUESTIONS are real past exam questions: write questions in the same style and on the same themes (re-ask or close variants). Other excerpts and standard knowledge may supply the facts."
        : "Base questions on the numbered excerpts first (set source to that number). Then use established standard knowledge (Robbins pathology; Katzung / Rang & Dale pharmacology level) and set source to 0, naming the textbook and chapter title in reference.";
  const prompt =
    `Write exactly these questions for a Nigerian 400-level MBBS student: ${askFor}.\n` +
    `Difficulty — ${DIFFICULTY_TEXT[s.difficulty]}\n` +
    `Courses: ${leaf.map((c) => c.name).join("; ") || "Pathology and Pharmacology"}.\n` +
    (sampled.length ? `Focus on these topics (set topic to one of these names exactly): ${sampled.map((t) => t.name).join("; ")}.\n` : "") +
    `${sourceRule}\nFormat rules:\n${(Object.keys(batch) as Exclude<QuestionFormat, "picture">[]).map((f) => `- ${FORMAT_RULES[f]}`).join("\n")}\n` +
    "Be accurate. Do not invent facts, doses or drugs. Don't repeat the same fact twice.\n\n" +
    (excerpts.length
      ? `Excerpts:\n${excerpts.map((e, i) => `[${i + 1}] ${e.kind !== "material" ? "PAST QUESTIONS " : ""}(${courseName(e.course_id)} — ${e.fileName}, page ${e.page})\n${e.content}`).join("\n\n")}`
      : "");

  let result: { questions: Gen[] };
  try {
    result = await generateJSON<{ questions: Gen[] }>(prompt, genSchema, {
      system: "You are a careful Nigerian medical school examiner writing accurate questions for revision.",
      temperature: 0.7,
      maxOutputTokens: 16_000,
      cache: false,
    });
  } catch (e) {
    if (e instanceof AIError) return { status: e.kind === "rate_limit" || e.kind === "busy" ? "rate_limited" : "error", message: e.message };
    throw e;
  }

  const left = { ...batch };
  const rows = [];
  for (const g of result.questions ?? []) {
    const f = g.format;
    if (!left[f] || !g.stem?.trim()) continue;
    const ex = g.source > 0 ? excerpts[g.source - 1] : undefined;
    if (s.source === "slides" && !ex) continue;
    let answer: Question["answer"];
    let options: string[] = [];
    if (f === "mcq") {
      if ((g.options?.length ?? 0) < 4 || !(g.answer_index >= 0 && g.answer_index < g.options.length)) continue;
      options = g.options;
      answer = g.answer_index;
    } else if (f === "tf") {
      if ((g.options?.length ?? 0) < 3 || g.tf_answers?.length !== g.options.length) continue;
      options = g.options;
      answer = g.tf_answers;
    } else if (f === "quickfire") {
      if (!g.short_answer?.trim()) continue;
      answer = g.short_answer.trim();
    } else {
      if (!g.model_answer?.trim() || !g.marking_points?.length) continue;
      answer = "";
    }
    left[f]!--;
    const course = leaf.find((c) => c.name.toLowerCase() === g.course?.toLowerCase()) ?? leaf.find((c) => c.id === ex?.course_id);
    const topic = topics.find((t) => t.name.toLowerCase() === g.topic?.toLowerCase());
    rows.push({
      course_id: course?.id ?? ex?.course_id ?? null,
      topic_id: topic?.id ?? null,
      format: f,
      difficulty: s.difficulty,
      stem: g.stem.trim(),
      options,
      answer,
      model_answer: f.endsWith("essay") ? g.model_answer.trim() : null,
      marking_points: f.endsWith("essay") ? g.marking_points.filter((p) => p.point && p.marks > 0) : null,
      explanation: g.explanation,
      why_wrong: f === "mcq" ? Object.fromEntries((g.why_wrong ?? []).map((w) => [String(w.option), w.reason])) : null,
      source_kind: (ex?.kind ?? "standard") as Question["source_kind"],
      source_label: ex ? `${ex.fileName}, page ${ex.page}` : g.reference?.trim() || "Standard textbook knowledge",
      source_file_id: ex?.file_id ?? null,
      source_page: ex?.page ?? null,
      topic_name: topic?.name ?? (g.topic || null),
    });
  }
  if (!rows.length) return { status: "error", message: "The AI didn't return usable questions. Tap to try again." };
  const { data: saved, error } = await supabase.from("questions").insert(rows).select("id");
  if (error) return { status: "error", message: error.message };

  // Re-read before appending, in case another step ran at the same time.
  const { data: fresh } = await supabase.from("quiz_sessions").select("question_ids").eq("id", sessionId).single();
  const ids = [...(fresh?.question_ids ?? []), ...(saved ?? []).map((r) => r.id)];
  await supabase.from("quiz_sessions").update({ question_ids: ids }).eq("id", sessionId);
  const stillNeeded = Object.values(need).reduce((a, b) => a + (b ?? 0), 0) - rows.length;
  return { status: stillNeeded > 0 ? "more" : "done", have: ids.length, want };
}

// ——— Marking ———

export type AnswerPayload =
  | { kind: "mcq"; chosen: number }
  | { kind: "tf"; chosen: (boolean | null)[] }
  | { kind: "recall"; text: string; selfCorrect: boolean }
  | { kind: "essay"; text: string };

export async function markAnswer(q: Question, p: AnswerPayload, negativeMarking: boolean): Promise<{ score: number; correct: boolean; feedback?: EssayFeedback; chosen: unknown; text?: string }> {
  if (p.kind === "mcq") {
    const correct = p.chosen === Number(q.answer);
    return { score: correct ? 1 : 0, correct, chosen: p.chosen };
  }
  if (p.kind === "tf") {
    const key = q.answer as boolean[];
    let right = 0;
    let wrong = 0;
    key.forEach((k, i) => {
      if (p.chosen[i] === null || p.chosen[i] === undefined) return;
      if (p.chosen[i] === k) right++;
      else wrong++;
    });
    const score = negativeMarking ? Math.max(0, (right - wrong) / key.length) : right / key.length;
    return { score, correct: score >= 0.6, chosen: p.chosen };
  }
  if (p.kind === "recall") return { score: p.selfCorrect ? 1 : 0, correct: p.selfCorrect, chosen: null, text: p.text };

  const points = q.marking_points ?? [];
  const total = points.reduce((t, x) => t + x.marks, 0) || 10;
  if (!p.text.trim()) {
    return { score: 0, correct: false, chosen: null, text: "", feedback: { points: points.map((x) => ({ ...x, awarded: 0, comment: "Not answered" })), feedback: "No answer written.", missed: points.map((x) => x.point) } };
  }
  const result = await generateJSON<{ points: { point: string; awarded: number; comment: string }[]; feedback: string; missed: string[] }>(
    `Mark this student's answer like a fair but strict Nigerian MBBS examiner.
Question: ${q.stem}
Model answer: ${q.model_answer ?? ""}
Marking scheme (point — marks):
${points.map((x, i) => `${i + 1}. ${x.point} — ${x.marks}`).join("\n")}

Student's answer:
"""${p.text.slice(0, 12_000)}"""

For each marking point (same order), award 0 up to its marks: full marks only if the point is clearly and correctly made (synonyms and other wording are fine), part marks if partly made, 0 if missing or wrong. Comment in one short line. Then give 2-3 sentences of feedback on how to improve, and list the important things the student missed or got wrong.`,
    {
      type: "object",
      properties: {
        points: {
          type: "array",
          items: { type: "object", properties: { point: { type: "string" }, awarded: { type: "number" }, comment: { type: "string" } }, required: ["point", "awarded", "comment"] },
        },
        feedback: { type: "string" },
        missed: { type: "array", items: { type: "string" } },
      },
      required: ["points", "feedback", "missed"],
    },
    { temperature: 0.2, maxOutputTokens: 4000 },
  );
  const marked = points.map((x, i) => {
    const r = result.points?.[i];
    return { ...x, awarded: Math.max(0, Math.min(x.marks, Number(r?.awarded) || 0)), comment: r?.comment ?? "" };
  });
  const got = marked.reduce((t, x) => t + x.awarded, 0);
  const score = got / total;
  return { score, correct: score >= 0.5, chosen: null, text: p.text, feedback: { points: marked, feedback: result.feedback ?? "", missed: result.missed ?? [] } };
}

// ——— Performance ———

export type TopicStat = { course_id: string | null; topic: string; n: number; pct: number; last: string };

// Accuracy per topic over the last 90 days (all quizzes). Weak = at least 2 answers and under 60%.
export async function topicStats(supabase: DB) {
  const since = addDays(todayISO(), -90);
  const { data } = await supabase.from("attempts").select("course_id, topic_name, score, correct, created_at").gte("created_at", since).not("topic_name", "is", null).limit(5000);
  const by = new Map<string, { course_id: string | null; topic: string; sum: number; n: number; last: string }>();
  for (const a of data ?? []) {
    const key = `${a.course_id}|${a.topic_name!.toLowerCase()}`;
    const e = by.get(key) ?? { course_id: a.course_id, topic: a.topic_name!, sum: 0, n: 0, last: a.created_at };
    e.sum += a.score ?? (a.correct ? 1 : 0);
    e.n++;
    if (a.created_at > e.last) e.last = a.created_at;
    by.set(key, e);
  }
  const all: TopicStat[] = [...by.values()].map((e) => ({ course_id: e.course_id, topic: e.topic, n: e.n, pct: Math.round((100 * e.sum) / e.n), last: e.last }));
  return {
    weak: all.filter((t) => t.n >= 2 && t.pct < 60).sort((a, b) => a.pct - b.pct || b.n - a.n),
    strong: all.filter((t) => t.n >= 2 && t.pct >= 80).sort((a, b) => b.pct - a.pct),
    all,
  };
}
