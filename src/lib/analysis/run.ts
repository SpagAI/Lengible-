import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIError, generateJSON } from "@/lib/ai";
import type { ConceptKind, Database, LibraryFile } from "@/lib/supabase/types";
import { todayISO } from "@/lib/dates";

type DB = SupabaseClient<Database>;

// One AI call reads about this many characters, so big files go in several steps.
const BATCH_CHARS = 24_000;

export type StepResult = { status: "done" | "more" | "review" | "rate_limited" | "skipped" | "error"; message?: string };

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

export type Analysis = {
  kind: "timetable" | "topic_list" | "concepts";
  cursor: number; // last page read
  totalPages: number;
  block?: string | null;
  sessions?: TimetableSession[];
  topics?: TopicItem[];
  concepts?: FoundConcept[];
  suggestedTopic?: string | null;
  pendingReview?: boolean;
  importedAt?: string;
  skipped?: boolean;
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
    topic: { type: "string", description: "The single best matching topic from the list, copied exactly, or null" },
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
  required: ["concepts"],
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

// Optional fields may be left out by the model; keep the shape simple (plain strings) for the widest support.
// Runs one step of the AI pass for a file and reports whether more steps are needed.
// Files bigger than this (or textbooks) aren't scanned by the AI automatically: a 1,000-page book would use
// up a day's free AI allowance. They're still searchable and still appear on drug/disease pages.
export const AUTO_SCAN_PAGE_LIMIT = 150;

export async function analyzeStep(supabase: DB, file: LibraryFile, full = false): Promise<StepResult> {
  const { data: courseRows } = await supabase.from("courses").select("id, name, is_group").eq("archived", false);
  const courseNames = (courseRows ?? []).filter((c) => !c.is_group).map((c) => c.name);
  const kind: Analysis["kind"] = file.doc_type === "timetable" ? "timetable" : file.doc_type === "topic_list" ? "topic_list" : "concepts";

  const { count } = await supabase.from("chunks").select("id", { count: "exact", head: true }).eq("file_id", file.id);
  let state = file.analysis as Analysis | null;
  const started = !!state && state.kind === kind && !state.importedAt && state.cursor > 0;
  if (kind === "concepts" && !full && !started && ((count ?? 0) > AUTO_SCAN_PAGE_LIMIT || file.doc_type === "textbook")) {
    await supabase.from("files").update({ status: "extracted", analysis: { kind, cursor: 0, totalPages: count ?? 0, skipped: true } }).eq("id", file.id);
    return {
      status: "skipped",
      message: `Saved and searchable (${count} pages). Big files aren't scanned by the AI automatically, to save your free allowance; its drugs and diseases still show on their pages. Open it and tap “Scan fully” if you want.`,
    };
  }
  if (!state || state.kind !== kind || state.importedAt) {
    state = { kind, cursor: 0, totalPages: count ?? 0, sessions: [], topics: [], concepts: [] };
  }

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
        const { data: topics } = await supabase.from("topics").select("name").neq("session_type", "section").limit(400);
        const r = await generateJSON<{ topic?: string | null; concepts: FoundConcept[] }>(
          "From these pages of a medical student's course material, list the drugs, diseases/conditions, organisms and laboratory " +
            "investigations that are actually discussed, with the page numbers where each appears. Use standard names " +
            "(generic drug names, e.g. 'Omeprazole' not brand names). At most 60 items; skip passing mentions of very common words." +
            (state.cursor === 0 && topics?.length ? `\nAlso pick the best matching topic from this list: ${topics.map((t) => t.name).join(" | ")}` : "") +
            "\n\n" +
            text,
          conceptSchema,
          { system: SYSTEM, maxOutputTokens: 8_000 },
        );
        if (state.cursor === 0) state.suggestedTopic = r.topic ?? null;
        state.concepts ??= [];
        mergeConcepts(state.concepts, r.concepts ?? []);
      }
    } catch (e) {
      // Keep what's done so far; the next attempt continues from here.
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
    if (more) {
      await supabase.from("files").update({ analysis: state }).eq("id", file.id);
      return { status: "more", message: `read up to page ${state.cursor} of ${state.totalPages || "?"}` };
    }
  }

  // Finished reading.
  if (kind === "concepts") {
    await saveConcepts(supabase, file.id, state.concepts ?? []);
    const update: { analysis: Analysis; status: "analysed"; topic_id?: string } = { analysis: state, status: "analysed" };
    if (!file.topic_id && state.suggestedTopic) {
      const { data: t } = await supabase.from("topics").select("id").ilike("name", state.suggestedTopic).limit(1).maybeSingle();
      if (t) update.topic_id = t.id;
    }
    await supabase.from("files").update(update).eq("id", file.id);
    return { status: "done", message: `${state.concepts?.length ?? 0} drugs, diseases and other terms linked.` };
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
  await supabase.from("files").update({ analysis: state, status: "analysed" }).eq("id", file.id);
  const n = kind === "timetable" ? `${state.sessions?.length ?? 0} sessions` : `${state.topics?.length ?? 0} topics`;
  return { status: "review", message: `Found ${n}. Review them before they're added.` };
}
