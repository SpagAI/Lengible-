import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DocType, ExamQuestion, FileProfile, LibraryFile, PaperKind } from "@/lib/supabase/types";
import { embedTexts, generateJSON, toVector } from "@/lib/ai";
import { similarity } from "@/lib/analysis/diff";

type DB = SupabaseClient<Database>;

// ——— What a file is ———
// Worked out from where it lives (Drive/Library folders), its name and its first pages, and saved on the file.
// Your corrections are kept (profile.edited).

// "2k23", "2K 24", "2023 set" → "2K23".
export function findSet(...texts: (string | null | undefined)[]) {
  for (const t of texts) {
    const m = t?.match(/\b2\s?k\s?(\d{2})\b/i);
    if (m) return `2K${m[1]}`;
  }
  return null;
}

// MB / EOPT / resit / test from names like "MB 2023 Pathology", "EOPT Haematology", "Resit Pharm".
export function findExam(...texts: (string | null | undefined)[]): PaperKind | null {
  const s = texts.filter(Boolean).join(" ").toLowerCase();
  if (/\bre-?sit\b|supplementary/.test(s)) return "resit";
  if (/\bmb\b|m\.b\.|professional exam|\bmbbs (part|exam)/.test(s)) return "mb";
  if (/\beopt\b|end[- ]of[- ]posting/.test(s)) return "eopt";
  if (/\b(ca|cat|test|quiz)\b/.test(s)) return "test";
  if (/departmental/.test(s)) return "departmental";
  return null;
}

const KINDS: FileProfile["kind"][] = ["lecture", "practical", "tutorial", "past_questions", "notes", "textbook", "timetable", "topic_list", "other"];

const profileSchema = {
  type: "object",
  properties: {
    course: { type: "string", description: "One of the course names given, exactly; empty when none fits" },
    posting: { type: "string", description: "Clinical posting or block, if any (e.g. 'Haematology posting'); empty otherwise" },
    set: { type: "string", description: "The class set like 2K23 or 2K24 if shown anywhere; empty otherwise" },
    kind: { type: "string", enum: KINDS },
    exam: { type: "string", enum: ["mb", "eopt", "resit", "test", "departmental", "other", "none"], description: "For past-question papers: which exam. 'none' for teaching material" },
    exam_year: { type: "integer", description: "Year the exam was written (e.g. 2023); 0 if unknown or not an exam paper" },
    lecturer: { type: "string", description: "Lecturer's name if shown; empty otherwise" },
    topics: { type: "array", items: { type: "string" }, description: "Up to 8 main topics, short" },
    theory_or_practical: { type: "string", enum: ["theory", "practical", "both"] },
    summary: { type: "string", description: "One sentence: what this file is" },
  },
  required: ["course", "posting", "set", "kind", "exam", "exam_year", "lecturer", "topics", "theory_or_practical", "summary"],
};

export async function profileStep(supabase: DB, file: LibraryFile) {
  if (file.profile?.edited) return;
  const [{ data: courses }, { data: folders }, { data: item }, { data: pages }] = await Promise.all([
    supabase.from("courses").select("id, name, is_group").eq("archived", false),
    supabase.from("folders").select("id, name, parent_id"),
    supabase.from("drive_items").select("path, name").eq("file_id", file.id).limit(1).maybeSingle(),
    supabase.from("chunks").select("page, content").eq("file_id", file.id).order("page").limit(4),
  ]);
  const folderPath: string[] = [];
  for (let f = folders?.find((x) => x.id === file.folder_id), guard = 0; f && guard < 20; f = folders?.find((x) => x.id === f!.parent_id), guard++) folderPath.unshift(f.name);
  const where = [item?.path, folderPath.join("/")].filter(Boolean).join(" | ");
  const leaf = (courses ?? []).filter((c) => !c.is_group);
  const start = (pages ?? []).map((p) => `[page ${p.page}] ${p.content.slice(0, 900)}`).join("\n").slice(0, 3600);

  const r = await generateJSON<Omit<FileProfile, "exam" | "exam_year"> & { exam: string; exam_year: number }>(
    `Courses: ${leaf.map((c) => c.name).join("; ")}.\n` +
      `File name: ${item?.name ?? file.name}\nWhere it is: ${where || "(top level)"}\nLengible type: ${file.doc_type}\n\nFirst pages:\n${start || "(no text)"}\n\n` +
      "Say what this file is for a Nigerian MBBS student's study app. Folder names and file names are strong clues (e.g. '2K23', 'MB 2022', 'EOPT', 'Resit', 'Practical').",
    profileSchema,
    { system: "You classify medical school study files accurately. Prefer evidence from names and folders; don't guess years.", temperature: 0, maxOutputTokens: 1500 },
  );
  const set = findSet(item?.name, file.name, where, r.set) ?? null;
  const exam = r.exam && r.exam !== "none" ? (r.exam as PaperKind) : findExam(item?.name, file.name, where);
  const profile: FileProfile = {
    course: r.course || null,
    posting: r.posting || null,
    set,
    kind: KINDS.includes(r.kind) ? r.kind : "other",
    exam: r.kind === "past_questions" || exam ? exam : null,
    exam_year: r.exam_year && r.exam_year > 1980 && r.exam_year < 2100 ? r.exam_year : null,
    lecturer: r.lecturer || null,
    topics: (r.topics ?? []).slice(0, 8),
    theory_or_practical: r.theory_or_practical ?? null,
    summary: r.summary ?? "",
  };
  // Fill in what's missing on the file (never overriding your own choices).
  const patch: Partial<LibraryFile> = { profile };
  const course = leaf.find((c) => c.name.toLowerCase() === (profile.course ?? "").toLowerCase());
  if (!file.course_id && course) patch.course_id = course.id;
  if (profile.kind === "past_questions" && ["other", "notes", "slides"].includes(file.doc_type)) patch.doc_type = (profile.exam === "mb" ? "mb_questions" : "past_questions") as DocType;
  await supabase.from("files").update(patch).eq("id", file.id);
}

export const needsQuestions = (file: Pick<LibraryFile, "doc_type" | "profile">) =>
  file.doc_type === "past_questions" || file.doc_type === "mb_questions" || file.profile?.kind === "past_questions";

// ——— The question bank ———

const questionsSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "integer" },
          number: { type: "string", description: "The question's number as printed (e.g. '3b'); empty if none" },
          question: { type: "string", description: "The full question, exactly as written (include its parts for essays)" },
          format: { type: "string", enum: ["essay", "short_note", "mcq", "tf", "osce", "practical", "other"] },
          marks: { type: "integer", description: "Marks if shown; 0 otherwise" },
          topic: { type: "string", description: "The topic in a few words (e.g. 'Sickle cell disease')" },
          exam: { type: "string", enum: ["mb", "eopt", "resit", "test", "departmental", "other", "same"], description: "'same' unless this part of the file is from a different exam" },
          exam_year: { type: "integer", description: "Year if this part shows a different year than the file; 0 otherwise" },
          set: { type: "string", description: "Class set like 2K23 if this part shows one; empty otherwise" },
        },
        required: ["page", "number", "question", "format", "marks", "topic", "exam", "exam_year", "set"],
      },
    },
  },
  required: ["questions"],
};

const PAGES_PER_CALL = 6;

// Pulls every question out of a past-question file, a few pages per AI call (the place is saved after each),
// and groups each one with the same question asked in other years (by meaning when possible).
export async function questionsStep(supabase: DB, file: LibraryFile, cursor: number, deadline: number): Promise<{ finished: boolean; cursor: number; total: number }> {
  const { data: pages } = await supabase.from("chunks").select("page, content").eq("file_id", file.id).order("page");
  const all = pages ?? [];
  const p = file.profile;
  let at = cursor;
  if (at === 0) await supabase.from("exam_questions").delete().eq("file_id", file.id);
  while (at < all.length && Date.now() < deadline - 45_000) {
    const batch = all.slice(at, at + PAGES_PER_CALL);
    const r = await generateJSON<{
      questions: { page: number; number: string; question: string; format: ExamQuestion["format"]; marks: number; topic: string; exam: string; exam_year: number; set: string }[];
    }>(
      `These are pages ${batch[0].page}–${batch.at(-1)!.page} of "${file.name}", ${p?.exam ? `a ${p.exam.toUpperCase()} ` : "a "}past-question paper` +
        `${p?.exam_year ? ` (${p.exam_year})` : ""}${p?.set ? `, set ${p.set}` : ""}${p?.course ? `, ${p.course}` : ""}.\n` +
        "List every exam question on them. Keep each question's full wording; keep essay sub-parts together with their question. " +
        "Skip instructions, headers and answer keys.\n\n" +
        batch.map((b) => `--- Page ${b.page} ---\n${b.content}`).join("\n\n"),
      questionsSchema,
      { system: "You extract exam questions from Nigerian medical school past papers, exactly as written.", temperature: 0, maxOutputTokens: 16_000 },
    );
    const rows = (r.questions ?? [])
      .filter((q) => q.question?.trim().length > 8)
      .map((q) => ({
        file_id: file.id,
        course_id: file.course_id,
        page: q.page || batch[0].page,
        exam: (q.exam && q.exam !== "same" ? q.exam : p?.exam ?? "other") as PaperKind,
        class_set: findSet(q.set) ?? p?.set ?? null,
        exam_year: q.exam_year > 1980 ? q.exam_year : p?.exam_year ?? null,
        format: q.format ?? "other",
        number: q.number || null,
        question: q.question.trim(),
        marks: q.marks > 0 ? q.marks : null,
        topic: q.topic || null,
      }));
    if (rows.length) await saveWithClusters(supabase, rows);
    at += batch.length;
  }
  return { finished: at >= all.length, cursor: at, total: all.length };
}

// Saves questions, giving each the cluster of an earlier question that asks the same thing.
async function saveWithClusters(supabase: DB, rows: Omit<ExamQuestion, "id" | "user_id" | "cluster_id" | "created_at">[]) {
  const vectors = await embedTexts(rows.map((r) => r.question), "SEMANTIC_SIMILARITY").catch(() => null);
  const { data: earlier } = vectors ? { data: null } : await supabase.from("exam_questions").select("id, question, cluster_id, course_id").limit(5000);
  const placed: { question: string; cluster: string; vector?: number[]; course: string | null }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let cluster: string | null = null;
    if (vectors?.[i]?.length) {
      const { data: near } = await supabase.rpc("match_questions", { query_embedding: toVector(vectors[i]), match_count: 3, in_course: row.course_id });
      const best = (near ?? []).find((n) => n.similarity >= 0.88 && n.cluster_id);
      if (best) cluster = best.cluster_id;
      // Also the same question earlier in this same batch.
      cluster ??= placed.find((pl) => pl.vector && cosine(pl.vector, vectors[i]) >= 0.88 && pl.course === row.course_id)?.cluster ?? null;
    } else {
      const same = (earlier ?? []).find((e) => e.course_id === row.course_id && e.cluster_id && similarity(e.question, row.question) >= 0.62);
      cluster = same?.cluster_id ?? placed.find((pl) => pl.course === row.course_id && similarity(pl.question, row.question) >= 0.62)?.cluster ?? null;
    }
    cluster ??= crypto.randomUUID();
    placed.push({ question: row.question, cluster, vector: vectors?.[i], course: row.course_id });
  }
  const { error } = await supabase.from("exam_questions").insert(
    rows.map((r, i) => ({ ...r, cluster_id: placed[i].cluster, ...(vectors?.[i]?.length ? { embedding: toVector(vectors[i]) } : {}) })),
  );
  if (error) throw new Error(`Couldn't save the questions: ${error.message}`);
  // Two papers read at the same moment can't see each other's questions before saving: look again now,
  // and join the earlier group when the same question is already there.
  if (vectors) {
    for (let i = 0; i < rows.length; i++) {
      if (!vectors[i]?.length) continue;
      const { data: near } = await supabase.rpc("match_questions", { query_embedding: toVector(vectors[i]), match_count: 6, in_course: rows[i].course_id });
      const other = (near ?? []).filter((n) => n.similarity >= 0.88 && n.cluster_id && n.cluster_id !== placed[i].cluster);
      if (!other.length) continue;
      // The oldest group wins, so everyone converges on the same one.
      const { data: groups } = await supabase.from("exam_questions").select("cluster_id, created_at").in("cluster_id", [...new Set([placed[i].cluster, ...other.map((o) => o.cluster_id!)])]).order("created_at").limit(1);
      const keep = groups?.[0]?.cluster_id;
      if (keep && keep !== placed[i].cluster) {
        await supabase.from("exam_questions").update({ cluster_id: keep }).eq("cluster_id", placed[i].cluster);
        placed[i].cluster = keep;
      }
    }
  }
}

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
