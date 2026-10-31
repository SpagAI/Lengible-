import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, QuizMaterials } from "@/lib/supabase/types";
import { AIError, generateJSON } from "@/lib/ai";

type DB = SupabaseClient<Database>;

// Ask Ally: answers a question from your own materials, citing the exact file and slide/page.
// 1. The AI looks at how your files are grouped (folders, file names) and the question, and plans the search:
//    search words (with synonyms, drug and disease names), the files that clearly fit, and any slides you named.
// 2. Lengible searches the text of those files (and everything else in scope) and ranks the pages.
// 3. The AI answers from the best pages, with [n] marks pointing at them, and says when your slides don't cover it.

export type AskScope = { courseId?: string | null; folderId?: string | null; fileId?: string | null };
export type AskTurn = { q: string; a: string };
export type AskSource = { n: number; file_id: string; file_name: string; path: string; page: number; text: string };
export type AskResult = {
  answer: string;
  sources: AskSource[];
  // Sources the AI says are most worth reading.
  best: number[];
  follow_ups: string[];
  intent: "answer" | "find" | "quiz";
  // Ready-made quiz scope from the slides found (or that you named).
  quiz: { materials: QuizMaterials; count: number } | null;
  // Files in scope that are stored but not processed yet (their text can't be searched).
  unread: number;
  scopeLabel: string;
};

type FileRow = { id: string; name: string; folder_id: string | null; course_id: string | null; doc_type: string; page_count: number | null; status: string };
type Chunk = { id: string; file_id: string; page: number; content: string };

const READ = ["extracted", "analysed"];
const MAX_CATALOG = 1500;
const MAX_EXCERPTS = 14;

// Supabase hands back at most 1,000 rows per request.
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set("what which when where why how does do did is are was were the a an of in on for to and or with from about my me slides slide notes lecture lectures explain tell give list show".split(" "));

// The files (and their folder paths) the question is about.
async function scopeFiles(supabase: DB, scope: AskScope) {
  const [courses, folders] = await Promise.all([
    supabase.from("courses").select("id, name, parent_id").then((r) => r.data ?? []),
    all<{ id: string; name: string; parent_id: string | null; course_id: string | null }>((a, b) => supabase.from("folders").select("id, name, parent_id, course_id").order("id").range(a, b)),
  ]);
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (id: string | null) => {
    const parts: string[] = [];
    for (let cur = id ? byId.get(id) : undefined, guard = 0; cur && guard < 30; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined, guard++) parts.unshift(cur.name);
    return parts.join("/");
  };
  const cols = "id, name, folder_id, course_id, doc_type, page_count, status";
  let files: FileRow[];
  let label = "All your materials";
  if (scope.fileId) {
    const { data } = await supabase.from("files").select(cols).eq("id", scope.fileId);
    files = (data ?? []) as FileRow[];
    label = files[0]?.name ?? "This file";
  } else if (scope.folderId) {
    const inside = new Set([scope.folderId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of folders) {
        if (f.parent_id && inside.has(f.parent_id) && !inside.has(f.id)) {
          inside.add(f.id);
          grew = true;
        }
      }
    }
    const ids = [...inside];
    files = [];
    for (let k = 0; k < ids.length; k += 100) {
      const chunk = ids.slice(k, k + 100);
      files.push(...(await all<FileRow>((a, b) => supabase.from("files").select(cols).in("folder_id", chunk).order("id").range(a, b))));
    }
    label = pathOf(scope.folderId) || "This folder";
  } else if (scope.courseId) {
    const ids = [scope.courseId, ...courses.filter((c) => c.parent_id === scope.courseId).map((c) => c.id)];
    files = await all<FileRow>((a, b) => supabase.from("files").select(cols).in("course_id", ids).order("id").range(a, b));
    label = courses.find((c) => c.id === scope.courseId)?.name ?? "This course";
  } else {
    files = await all<FileRow>((a, b) => supabase.from("files").select(cols).order("id").range(a, b));
  }
  const courseName = new Map(courses.map((c) => [c.id, c.name]));
  return { files, pathOf, courseName, label };
}

type Plan = {
  intent: "answer" | "find" | "quiz";
  keywords: string[];
  files: number[];
  pages: { file: number; from: number; to: number }[];
  quiz_count: number;
};

const planSchema = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["answer", "find", "quiz"], description: "answer = explain/answer; find = which files or slides cover something; quiz = the student wants to be quizzed" },
    keywords: {
      type: "array",
      items: { type: "string" },
      description:
        "6–16 search terms likely to appear on the relevant slides: key terms from the question plus synonyms, abbreviations and specific names (drug names for a drug class, diseases for a topic, e.g. 'TB drugs' → antimycobacterial, isoniazid, rifampicin). One to three words each.",
    },
    files: { type: "array", items: { type: "integer" }, description: "Catalog numbers of files whose name/folder clearly fits the question (at most 8). Empty when none clearly fits." },
    pages: {
      type: "array",
      items: { type: "object", properties: { file: { type: "integer" }, from: { type: "integer" }, to: { type: "integer" } }, required: ["file", "from", "to"] },
      description: "Only when the student names specific slides/pages of a file (e.g. 'slides 10-20 of the anaemia lecture').",
    },
    quiz_count: { type: "integer", description: "Questions wanted when intent is quiz (default 10)." },
  },
  required: ["intent", "keywords", "files", "pages", "quiz_count"],
};

const answerSchema = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "The answer. Short paragraphs and '- ' bullet points; **bold** key terms. Put [n] right after each fact taken from excerpt n. If the excerpts don't cover something, say so plainly, and add standard textbook knowledge only in a final paragraph starting 'Beyond your slides:'.",
    },
    best: { type: "array", items: { type: "integer" }, description: "Excerpt numbers most worth reading for this question, best first (at most 5)." },
    follow_ups: { type: "array", items: { type: "string" }, description: "2–3 short follow-up questions the student might ask next." },
  },
  required: ["answer", "best", "follow_ups"],
};

export async function ask(supabase: DB, question: string, scope: AskScope, history: AskTurn[] = []): Promise<AskResult> {
  const { files, pathOf, courseName, label } = await scopeFiles(supabase, scope);
  const readable = files.filter((f) => READ.includes(f.status));
  const unread = files.filter((f) => f.status === "uploaded").length;
  if (!readable.length) {
    return {
      answer: files.length
        ? "None of the files here have been processed yet, so their text can't be searched. Tap **Process** on the folder or files you want (in Library or on the Drive page), then ask again."
        : "There are no files here yet. Bring them in from Google Drive or upload them in Library first.",
      sources: [],
      best: [],
      follow_ups: [],
      intent: "answer",
      quiz: null,
      unread,
      scopeLabel: label,
    };
  }

  // 1. Plan the search from the question and how your files are grouped.
  const catalog = readable
    .map((f) => ({ f, line: `${[courseName.get(f.course_id ?? "") ?? "General", pathOf(f.folder_id), f.name].filter(Boolean).join(" / ")} (${f.doc_type.replace("_", " ")}${f.page_count ? `, ${f.page_count} pages` : ""})` }))
    .sort((a, b) => a.line.localeCompare(b.line))
    .slice(0, MAX_CATALOG);
  const recent = history.slice(-2).map((t) => `Q: ${t.q}\nA: ${t.a.slice(0, 600)}`).join("\n\n");
  let plan: Plan;
  try {
    plan = await generateJSON<Plan>(
      `A medical student asks about their own course materials.\n` +
        (recent ? `Earlier in this conversation:\n${recent}\n\n` : "") +
        `Question: ${question}\n\nTheir files (numbered; course / folder path / file name):\n${catalog.map((c, i) => `${i + 1}. ${c.line}`).join("\n")}\n\n` +
        "Plan how to find the answer in these files.",
      planSchema,
      { system: "You plan searches over a Nigerian MBBS student's lecture slides (Pathology and Pharmacology).", temperature: 0.2, purpose: "ally" },
    );
  } catch (e) {
    if (e instanceof AIError) throw e;
    plan = { intent: "answer", keywords: [], files: [], pages: [], quiz_count: 10 };
  }
  const pickedFiles = new Set((plan.files ?? []).map((n) => catalog[n - 1]?.f.id).filter(Boolean) as string[]);
  const namedPages = (plan.pages ?? []).flatMap((p) => (catalog[p.file - 1] ? [{ id: catalog[p.file - 1].f.id, from: Math.max(1, Math.min(p.from, p.to)), to: Math.max(p.from, p.to) }] : []));

  // 2. Search the text.
  const terms = [...new Set([...(plan.keywords ?? []), ...norm(question).split(" ").filter((w) => w.length > 3 && !STOP.has(w))].map(norm).filter((t) => t.length > 2))].slice(0, 20);
  const tsQuery = terms.map((t) => (t.includes(" ") ? `"${t}"` : t)).join(" or ");
  const readableIds = new Set(readable.map((f) => f.id));
  const found = new Map<string, Chunk>();
  const add = (rows: Chunk[] | null) => rows?.forEach((r) => readableIds.has(r.file_id) && found.set(r.id, r));
  const cols = "id, file_id, page, content";
  // Pages you named.
  for (const p of namedPages.slice(0, 4)) {
    const { data } = await supabase.from("chunks").select(cols).eq("file_id", p.id).gte("page", p.from).lte("page", p.to).order("page").limit(60);
    add(data);
  }
  if (tsQuery) {
    // The files that fit by name, then everything in scope.
    const picked = [...pickedFiles];
    if (picked.length) {
      const { data } = await supabase.from("chunks").select(cols).in("file_id", picked).textSearch("tsv", tsQuery, { config: "english", type: "websearch" }).limit(200);
      add(data);
    }
    if (scope.courseId || (!scope.fileId && !scope.folderId)) {
      const courseIds = [...new Set(readable.map((f) => f.course_id).filter(Boolean))] as string[];
      let q = supabase.from("chunks").select(cols).textSearch("tsv", tsQuery, { config: "english", type: "websearch" });
      if (scope.courseId) q = q.in("course_id", courseIds);
      const { data } = await q.limit(400);
      add(data);
    } else {
      const ids = [...readableIds];
      for (let k = 0; k < ids.length && k < 600; k += 120) {
        const { data } = await supabase.from("chunks").select(cols).in("file_id", ids.slice(k, k + 120)).textSearch("tsv", tsQuery, { config: "english", type: "websearch" }).limit(300);
        add(data);
      }
    }
  }
  // Files picked by name but with no word matches (e.g. "summarise lecture 3"): take pages spread through them.
  for (const id of [...pickedFiles].slice(0, 3)) {
    if ([...found.values()].some((c) => c.file_id === id)) continue;
    const { data } = await supabase.from("chunks").select(cols).eq("file_id", id).order("page").limit(80);
    const rows = data ?? [];
    add(rows.filter((_, i) => i % Math.max(1, Math.ceil(rows.length / 6)) === 0));
  }
  if (!found.size && scope.fileId) {
    const { data } = await supabase.from("chunks").select(cols).eq("file_id", scope.fileId).order("page").limit(80);
    const rows = data ?? [];
    add(rows.filter((_, i) => i % Math.max(1, Math.ceil(rows.length / 8)) === 0));
  }

  // Rank: rarer search words count more; files that fit by name and pages you named come first.
  const chunks = [...found.values()];
  const lower = new Map(chunks.map((c) => [c.id, norm(c.content)]));
  const df = new Map(terms.map((t) => [t, chunks.filter((c) => lower.get(c.id)!.includes(t)).length]));
  const docType = new Map(files.map((f) => [f.id, f.doc_type]));
  const named = (c: Chunk) => namedPages.some((p) => p.id === c.file_id && c.page >= p.from && c.page <= p.to);
  const score = (c: Chunk) => {
    const text = lower.get(c.id)!;
    let s = 0;
    for (const t of terms) if (text.includes(t)) s += Math.log(1 + chunks.length / (df.get(t) || 1)) * (t.includes(" ") ? 1.5 : 1);
    if (pickedFiles.has(c.file_id)) s += 3;
    if (named(c)) s += 100;
    if (c.content.length < 80) s -= 1;
    // Timetables and topic lists name topics but don't teach them.
    if (["timetable", "topic_list"].includes(docType.get(c.file_id) ?? "")) s -= 2;
    return s;
  };
  const ranked = chunks.map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s);
  // At most 4 pages from one file, so several sources can be cited (unless you named pages).
  const perFile = new Map<string, number>();
  const chosen: Chunk[] = [];
  for (const { c } of ranked) {
    const n = perFile.get(c.file_id) ?? 0;
    if (n >= (named(c) ? 20 : 4)) continue;
    perFile.set(c.file_id, n + 1);
    chosen.push(c);
    if (chosen.length >= MAX_EXCERPTS) break;
  }
  const fileById = new Map(files.map((f) => [f.id, f]));
  const sources: AskSource[] = chosen.map((c, i) => {
    const f = fileById.get(c.file_id)!;
    return { n: i + 1, file_id: c.file_id, file_name: f.name, path: pathOf(f.folder_id), page: c.page, text: c.content.replace(/\s+/g, " ").trim() };
  });

  // Slides for a quiz: the ones you named, else the pages found (grouped into ranges per file).
  const quizFiles: QuizMaterials["files"] = namedPages.length
    ? namedPages.map((p) => ({ id: p.id, from: p.from, to: p.to }))
    : [...new Set(sources.filter((s) => !["timetable", "topic_list"].includes(docType.get(s.file_id) ?? "")).map((s) => s.file_id))].map((id) => {
        const pages = sources.filter((s) => s.file_id === id).map((s) => s.page);
        return { id, from: Math.max(1, Math.min(...pages) - 2), to: Math.max(...pages) + 2 };
      });
  // Named after the slides, e.g. "Antimycobacterial drugs (slides 3–9), Anaemia lecture (slides 12–15)".
  const quizLabel = quizFiles.map((f) => `${fileById.get(f.id)?.name ?? "file"} (slides ${f.from}–${f.to})`).join(", ");
  const quiz = quizFiles.length ? { materials: { label: quizLabel, files: quizFiles, folder_ids: [] }, count: Math.max(3, Math.min(30, plan.quiz_count || 10)) } : null;

  if (!sources.length) {
    return {
      answer: `I couldn't find this in your processed files${label === "All your materials" ? "" : ` in ${label}`}. Try other words (e.g. a drug or disease name), ask in a wider scope, or process more files.`,
      sources,
      best: [],
      follow_ups: [],
      intent: plan.intent,
      quiz: null,
      unread,
      scopeLabel: label,
    };
  }
  if (plan.intent === "quiz") {
    return {
      answer: `I found ${sources.length} slide${sources.length === 1 ? "" : "s"} for this in ${new Set(sources.map((s) => s.file_id)).size} file${new Set(sources.map((s) => s.file_id)).size === 1 ? "" : "s"}. Tap **Start quiz** for ${quiz!.count} questions written only from them, or check the slides below first.`,
      sources,
      best: sources.slice(0, 5).map((s) => s.n),
      follow_ups: [],
      intent: "quiz",
      quiz,
      unread,
      scopeLabel: label,
    };
  }

  // 3. Answer from the best pages, citing them.
  const out = await generateJSON<{ answer: string; best: number[]; follow_ups: string[] }>(
    (recent ? `Earlier in this conversation:\n${recent}\n\n` : "") +
      `Question: ${question}\n\n` +
      (plan.intent === "find"
        ? "The student wants to know WHERE this is covered: name the files and slides (with [n]) and say in a line what each covers.\n\n"
        : "Answer for exam revision: accurate, clear and to the point, using the excerpts.\n\n") +
      `Excerpts from the student's own slides and notes:\n${sources.map((s) => `[${s.n}] ${[s.path, s.file_name].filter(Boolean).join(" / ")}, page ${s.page}\n${s.text.slice(0, 1800)}`).join("\n\n")}`,
    answerSchema,
    {
      system:
        "You are a careful medical tutor for a Nigerian 400-level MBBS student (Pathology and Pharmacology). Answer from the student's own slides first and cite them with [n]. Never invent citations. Be accurate about drugs, doses and mechanisms.",
      temperature: 0.3,
      maxOutputTokens: 4000,
      purpose: "ally",
    },
  );
  const valid = (n: number) => n >= 1 && n <= sources.length;
  return {
    answer: (out.answer ?? "").replace(/\[(\d+)\]/g, (m, n) => (valid(Number(n)) ? m : "")),
    sources,
    best: (out.best ?? []).filter(valid).slice(0, 5),
    follow_ups: (out.follow_ups ?? []).slice(0, 3),
    intent: plan.intent,
    quiz,
    unread,
    scopeLabel: label,
  };
}
