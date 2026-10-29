import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIError, generateJSON } from "@/lib/ai";
import type { ConceptKind, Database, LibraryFile } from "@/lib/supabase/types";
import { todayISO } from "@/lib/dates";

type DB = SupabaseClient<Database>;

// One AI call reads about this many characters (roughly 40–60 slides), so big files go in several steps.
const BATCH_CHARS = 60_000;
// Bumped when the reading changes, so files read the old way are read again (in the background).
export const ANALYSIS_VERSION = 2;
// Only one device reads a file at a time; a step that dies leaves the file free again after this.
const LOCK_MS = 4 * 60 * 1000;

export type StepResult = { status: "done" | "more" | "review" | "rate_limited" | "skipped" | "error" | "busy"; message?: string; cursor?: number; total?: number };

// What the AI found in a timetable, kept on the file until you review it.
export type TimetableSession = {
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  course: string;
  type: "lecture" | "tutorial" | "practical" | "assessment" | "other";
  title: string;
  lecturer: string | null;
  venue: string | null;
  groups: string | null;
  assessment_kind: string | null;
};
export type TopicItem = { course: string; block: string | null; type: "lecture" | "tutorial" | "practical" | "other"; name: string };
export type FoundConcept = { name: string; kind: ConceptKind; pages: number[] };
// One lecture/topic inside a file.
export type Section = {
  title: string;
  course: string | null;
  start_page: number;
  end_page: number;
  subtopics: string[];
  key_points: string[];
  matches: string | null;
};

export type Analysis = {
  kind: "timetable" | "topic_list" | "concepts";
  cursor: number; // last page read
  totalPages: number;
  block?: string | null;
  sessions?: TimetableSession[];
  topics?: TopicItem[];
  concepts?: FoundConcept[];
  suggestedTopic?: string | null;
  sections?: Section[];
  pendingReview?: boolean;
  importedAt?: string;
  skipped?: boolean;
  v?: number;
  finished?: boolean;
  lockUntil?: string | null;
  failures?: number;
};

const SYSTEM =
  "You help a Nigerian 400-level medical student organise their course materials. Read only what is in the text. " +
  "Never invent sessions, dates, topics or names that are not written there.";

const timetableSchema = {
  type: "object",
  properties: {
    block: { type: "string", description: "Block / posting name if written, e.g. 'Block 2'" },
    sessions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD. If the year is not written anywhere, use 0000 as the year." },
          start_time: { type: "string", description: "As written, e.g. 9:00 AM" },
          end_time: { type: "string" },
          course: { type: "string", description: "Exactly one of the course names given, or 'Other'" },
          type: { type: "string", enum: ["lecture", "tutorial", "practical", "assessment", "other"] },
          title: { type: "string", description: "Topic or activity, without the course name" },
          lecturer: { type: "string" },
          venue: { type: "string" },
          groups: { type: "string" },
          assessment_kind: { type: "string", enum: ["eopt", "exam", "test", "mb", "none"] },
        },
        required: ["date", "course", "type", "title"],
      },
    },
  },
  required: ["sessions"],
};

const topicSchema = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          course: { type: "string", description: "Exactly one of the course names given, or 'Other'" },
          block: { type: "string", description: "e.g. 'Block 2' if the list is split by block" },
          type: { type: "string", enum: ["lecture", "tutorial", "practical", "other"] },
          name: { type: "string" },
        },
        required: ["course", "type", "name"],
      },
    },
  },
  required: ["topics"],
};

const conceptSchema = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      description: "The lectures/topics on these pages, in order",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Concise topic name as a syllabus would list it, e.g. 'Iron deficiency anaemia'" },
          course: { type: "string", description: "Exactly one of the course names given, or 'Other'" },
          start_page: { type: "integer" },
          end_page: { type: "integer" },
          subtopics: { type: "array", items: { type: "string" }, description: "Main headings within it, at most 8" },
          key_points: { type: "array", items: { type: "string" }, description: "Most exam-worthy facts stated on these pages, at most 6, one line each" },
          matches: { type: "string", description: "The existing syllabus topic this is about, copied exactly, or empty" },
        },
        required: ["title", "course", "start_page", "end_page", "subtopics", "key_points"],
      },
    },
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Standard name: generic drug name, standard disease/organism/test name" },
          kind: { type: "string", enum: ["drug", "disease", "organism", "investigation"] },
          pages: { type: "array", items: { type: "integer" } },
        },
        required: ["name", "kind", "pages"],
      },
    },
  },
  required: ["sections", "concepts"],
};

async function nextBatch(supabase: DB, fileId: string, afterPage: number) {
  const { data } = await supabase.from("chunks").select("page, content").eq("file_id", fileId).gt("page", afterPage).order("page").limit(200);
  const rows = data ?? [];
  const batch: typeof rows = [];
  let size = 0;
  for (const r of rows) {
    if (batch.length && size + r.content.length > BATCH_CHARS) break;
    batch.push(r);
    size += r.content.length;
  }
  return batch;
}

const pagesText = (batch: { page: number; content: string }[]) => batch.map((b) => `--- Page ${b.page} ---\n${b.content}`).join("\n\n");

function mergeConcepts(into: FoundConcept[], found: FoundConcept[]) {
  for (const c of found) {
    const name = c.name.trim();
    if (name.length < 3 || name.length > 80) continue;
    const hit = into.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (hit) hit.pages = [...new Set([...hit.pages, ...c.pages])].sort((a, b) => a - b);
    else into.push({ name, kind: c.kind, pages: [...new Set(c.pages)].sort((a, b) => a - b) });
  }
}

// Saves the drugs/diseases found in a file and links them to it.
async function saveConcepts(supabase: DB, fileId: string, found: FoundConcept[]) {
  await supabase.from("file_concepts").delete().eq("file_id", fileId);
  if (!found.length) return;
  const { data: existing } = await supabase.from("concepts").select("id, name, aliases");
  const index = new Map<string, string>();
  for (const c of existing ?? []) for (const n of [c.name, ...c.aliases]) index.set(n.toLowerCase(), c.id);
  const links: { file_id: string; concept_id: string; pages: number[] }[] = [];
  for (const c of found) {
    let id = index.get(c.name.toLowerCase());
    if (!id) {
      const { data } = await supabase.from("concepts").insert({ name: c.name, kind: c.kind }).select("id").maybeSingle();
      id = data?.id;
      if (!id) {
        // Created a moment ago by another file.
        const { data: again } = await supabase.from("concepts").select("id").ilike("name", c.name).maybeSingle();
        id = again?.id;
      }
      if (id) index.set(c.name.toLowerCase(), id);
    }
    if (id && !links.some((l) => l.concept_id === id)) links.push({ file_id: fileId, concept_id: id, pages: c.pages });
  }
  if (links.length) await supabase.from("file_concepts").insert(links);
}

// Adds one batch's sections, joining a section that carries on from the previous batch.
function mergeSections(into: Section[], found: Section[]) {
  for (const raw of found) {
    const title = raw.title?.trim();
    if (!title || title.length > 120) continue;
    const sec: Section = {
      title,
      course: raw.course && raw.course !== "Other" ? raw.course : null,
      start_page: Math.min(raw.start_page, raw.end_page),
      end_page: Math.max(raw.start_page, raw.end_page),
      subtopics: (raw.subtopics ?? []).filter(Boolean).slice(0, 8),
      key_points: (raw.key_points ?? []).filter(Boolean).slice(0, 6),
      matches: raw.matches?.trim() || null,
    };
    const last = into.at(-1);
    if (last && last.title.toLowerCase() === sec.title.toLowerCase()) {
      last.end_page = Math.max(last.end_page, sec.end_page);
      last.subtopics = [...new Set([...last.subtopics, ...sec.subtopics])].slice(0, 12);
      last.key_points = [...new Set([...last.key_points, ...sec.key_points])].slice(0, 10);
      last.matches ??= sec.matches;
    } else into.push(sec);
  }
}

// Turns a file's sections into course topics: each joins the syllabus topic it matches, or becomes a new
// topic marked "from your materials". Also records which pages of the file cover it.
async function saveSections(supabase: DB, file: LibraryFile, sections: Section[], courses: { id: string; name: string; is_group: boolean }[]) {
  await supabase.from("topic_files").delete().eq("file_id", file.id);
  const leaf = courses.filter((c) => !c.is_group);
  const fileCourse = leaf.find((c) => c.id === file.course_id);
  const byTopic = new Map<string, { start: number; end: number; subtopics: string[]; key_points: string[] }>();
  for (const sec of sections) {
    const course = fileCourse ?? leaf.find((c) => c.name.toLowerCase() === sec.course?.toLowerCase());
    if (!course) continue;
    let topicId: string | undefined;
    for (const name of [sec.matches, sec.title].filter(Boolean) as string[]) {
      const { data } = await supabase.from("topics").select("id").eq("course_id", course.id).ilike("name", name.replace(/[%_]/g, "")).limit(1);
      topicId = data?.[0]?.id;
      if (topicId) break;
    }
    if (!topicId) {
      const { data } = await supabase.from("topics").insert({ course_id: course.id, name: sec.title, session_type: "lecture", source: "material" }).select("id").maybeSingle();
      topicId = data?.id;
      if (!topicId) {
        // Made a moment ago (same name, different case).
        const { data: again } = await supabase.from("topics").select("id").eq("course_id", course.id).ilike("name", sec.title.replace(/[%_]/g, "")).limit(1);
        topicId = again?.[0]?.id;
      }
    }
    if (!topicId) continue;
    const e = byTopic.get(topicId);
    byTopic.set(topicId, {
      start: Math.min(e?.start ?? sec.start_page, sec.start_page),
      end: Math.max(e?.end ?? sec.end_page, sec.end_page),
      subtopics: [...new Set([...(e?.subtopics ?? []), ...sec.subtopics])].slice(0, 16),
      key_points: [...new Set([...(e?.key_points ?? []), ...sec.key_points])].slice(0, 12),
    });
  }
  const rows = [...byTopic.entries()].map(([topic_id, v]) => ({ topic_id, file_id: file.id, start_page: v.start, end_page: v.end, subtopics: v.subtopics, key_points: v.key_points }));
  if (rows.length) await supabase.from("topic_files").insert(rows);
  return { topics: rows.length, onlyTopic: rows.length === 1 ? rows[0].topic_id : null };
}

// Optional fields may be left out by the model; keep the shape simple (plain strings) for the widest support.
// Runs one step of the AI pass for a file and reports whether more steps are needed.
// Files bigger than this (and textbooks) aren't read by the AI automatically, to protect the free daily
// allowance. They're still searchable; "Scan fully" reads them.
export const AUTO_SCAN_PAGE_LIMIT = 2000;

export async function analyzeStep(supabase: DB, file: LibraryFile, full = false): Promise<StepResult> {
  const { data: courseRows } = await supabase.from("courses").select("id, name, is_group").eq("archived", false);
  const courseNames = (courseRows ?? []).filter((c) => !c.is_group).map((c) => c.name);
  const fileCourse = (courseRows ?? []).find((c) => c.id === file.course_id);
  const kind: Analysis["kind"] = file.doc_type === "timetable" ? "timetable" : file.doc_type === "topic_list" ? "topic_list" : "concepts";

  const { count } = await supabase.from("chunks").select("id", { count: "exact", head: true }).eq("file_id", file.id);
  let state = file.analysis as Analysis | null;
  // Another device (or tab) is reading this file right now.
  if (state?.lockUntil && new Date(state.lockUntil).getTime() > Date.now()) {
    return { status: "busy", message: "Being read on another device or tab.", cursor: state.cursor, total: state.totalPages };
  }
  const started = !!state && state.kind === kind && !state.importedAt && state.cursor > 0 && (kind !== "concepts" || state.v === ANALYSIS_VERSION) && !state.finished;
  if (kind === "concepts" && !full && !started && ((count ?? 0) > AUTO_SCAN_PAGE_LIMIT || file.doc_type === "textbook")) {
    await supabase.from("files").update({ status: "extracted", analysis: { kind, cursor: 0, totalPages: count ?? 0, skipped: true, v: ANALYSIS_VERSION } }).eq("id", file.id);
    return {
      status: "skipped",
      message:
        file.doc_type === "textbook"
          ? `Saved and searchable (${count} pages). Textbooks aren't read by the AI automatically, to save your free allowance. Open it and tap “Scan fully” if you want.`
          : `Saved and searchable (${count} pages). Files over ${AUTO_SCAN_PAGE_LIMIT} pages aren't read automatically. Open it and tap “Scan fully” if you want.`,
    };
  }
  if (!started && (!state || state.kind !== kind || state.importedAt || kind === "concepts")) {
    state = { kind, cursor: 0, totalPages: count ?? 0, sessions: [], topics: [], concepts: [], sections: [], v: ANALYSIS_VERSION };
  }
  state = state!;
  state.totalPages = count ?? state.totalPages;
  // Hold the file while this step runs. One conditional update, so if two devices start at the same
  // moment only one gets the file; the other is told it's busy.
  const nowIso = new Date().toISOString();
  const { data: held } = await supabase
    .from("files")
    .update({ analysis: { ...state, lockUntil: new Date(Date.now() + LOCK_MS).toISOString() } })
    .eq("id", file.id)
    .or(`analysis.is.null,analysis->>lockUntil.is.null,analysis->>lockUntil.lt.${nowIso}`)
    .select("id");
  if (!held?.length) return { status: "busy", message: "Being read on another device or tab.", cursor: state.cursor, total: state.totalPages };
  state.lockUntil = null;

  const batch = await nextBatch(supabase, file.id, state.cursor);
  if (batch.length) {
    const text = pagesText(batch);
    try {
      if (kind === "timetable") {
        const r = await generateJSON<{ block?: string | null; sessions: TimetableSession[] }>(
          `Courses: ${courseNames.join("; ")}.\nToday is ${todayISO()}.\n` +
            "Extract every scheduled session from this timetable. Map each to one of the courses " +
            "(e.g. 'Pathology (Histopathology)' → Histopathology). End-of-posting tests, CBTs and exams are type 'assessment'. " +
            "Skip breaks, holidays and notices.\n\n" +
            text,
          timetableSchema,
          { system: SYSTEM, maxOutputTokens: 32_000 },
        );
        state.block ??= r.block ?? null;
        state.sessions = [...(state.sessions ?? []), ...(r.sessions ?? [])];
      } else if (kind === "topic_list") {
        const r = await generateJSON<{ topics: TopicItem[] }>(
          `Courses: ${courseNames.join("; ")}.\n` +
            "List every topic in this syllabus/topic list. Map each to one of the courses, note which block it belongs to if the list is " +
            "split by block, and whether it is a lecture, tutorial or practical topic. Keep the wording of each topic; drop numbering.\n\n" +
            text,
          topicSchema,
          { system: SYSTEM, maxOutputTokens: 32_000 },
        );
        state.topics = [...(state.topics ?? []), ...(r.topics ?? [])];
      } else {
        // The syllabus topics this file might belong to, so sections can join them.
        let tq = supabase.from("topics").select("name").neq("session_type", "section").limit(250);
        if (file.course_id && !fileCourse?.is_group) tq = tq.eq("course_id", file.course_id);
        const { data: topics } = await tq;
        const last = state.sections?.at(-1);
        const r = await generateJSON<{ sections: Section[]; concepts: FoundConcept[] }>(
          `These are pages ${batch[0].page}–${batch[batch.length - 1].page} of "${file.name}" (${state.totalPages} pages in all), a medical student's ` +
            `${file.doc_type.replace("_", " ")} for ${fileCourse && !fileCourse.is_group ? fileCourse.name : "one of these courses: " + courseNames.join("; ")}.\n` +
            "1. Split the pages into sections, one per lecture or topic. A slide deck on one topic is ONE section; a compilation of lectures " +
            "has one section per lecture. Give each a concise topic name as a syllabus would list it (not 'Lecture 4' or a slide title), " +
            "its first and last page, its main headings (subtopics) and the most exam-worthy facts actually stated on those pages (key_points)." +
            (last ? ` The previous pages ended in the section "${last.title}"; if these pages carry on with it, use exactly that title.` : "") +
            (topics?.length ? `\nExisting syllabus topics (set matches to one of these, copied exactly, when a section is about it):\n${topics.map((t) => t.name).join(" | ")}` : "") +
            "\n2. List the drugs, diseases/conditions, organisms and laboratory investigations actually discussed, with the pages where each " +
            "appears. Use standard names (generic drug names, e.g. 'Omeprazole' not brand names). At most 60; skip passing mentions.\n" +
            "Pages marked 'Image:' are descriptions of pictures on the slides; use them too.\n\n" +
            text,
          conceptSchema,
          { system: SYSTEM, maxOutputTokens: 16_000, temperature: 0.2 },
        );
        state.sections ??= [];
        mergeSections(state.sections, r.sections ?? []);
        state.concepts ??= [];
        mergeConcepts(state.concepts, r.concepts ?? []);
      }
    } catch (e) {
      // Keep what's done so far; the next attempt continues from here.
      if (!(e instanceof AIError && (e.kind === "rate_limit" || e.kind === "busy"))) state.failures = (state.failures ?? 0) + 1;
      await supabase.from("files").update({ analysis: state }).eq("id", file.id);
      if (e instanceof AIError) {
        if (e.kind === "not_configured") {
          return { status: "skipped", message: "AI isn't set up yet (add GEMINI_API_KEY in Vercel). The file is saved and searchable." };
        }
        if (e.kind === "rate_limit" || e.kind === "busy") return { status: "rate_limited", message: e.message };
        return { status: "error", message: e.message };
      }
      return { status: "error", message: "Something went wrong while analysing." };
    }
    state.cursor = batch[batch.length - 1].page;
    const more = (await nextBatch(supabase, file.id, state.cursor)).length > 0;
    state.failures = 0;
    if (more) {
      await supabase.from("files").update({ analysis: state }).eq("id", file.id);
      return { status: "more", message: `read up to page ${state.cursor} of ${state.totalPages || "?"}`, cursor: state.cursor, total: state.totalPages };
    }
  }

  // Finished reading.
  if (kind === "concepts") {
    await saveConcepts(supabase, file.id, state.concepts ?? []);
    const saved = await saveSections(supabase, file, state.sections ?? [], courseRows ?? []);
    state.finished = true;
    const update: { analysis: Analysis; status: "analysed"; topic_id?: string } = { analysis: state, status: "analysed" };
    if (!file.topic_id && saved.onlyTopic) update.topic_id = saved.onlyTopic;
    await supabase.from("files").update(update).eq("id", file.id);
    return {
      status: "done",
      message: `${saved.topics} topic${saved.topics === 1 ? "" : "s"} and ${state.concepts?.length ?? 0} drugs, diseases and other terms found.`,
    };
  }

  const seen = new Set<string>();
  const unique = <T,>(list: T[] | undefined, key: (x: T) => string) =>
    (list ?? []).filter((x) => {
      const k = key(x).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  state.sessions = unique(state.sessions, (s) => `s|${s.date}|${s.start_time}|${s.course}|${s.title}`);
  state.topics = unique(state.topics, (t) => `t|${t.course}|${t.block}|${t.type}|${t.name}`);
  state.pendingReview = true;
  state.finished = true;
  await supabase.from("files").update({ analysis: state, status: "analysed" }).eq("id", file.id);
  const n = kind === "timetable" ? `${state.sessions?.length ?? 0} sessions` : `${state.topics?.length ?? 0} topics`;
  return { status: "review", message: `Found ${n}. Review them before they're added.` };
}
