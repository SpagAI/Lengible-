"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import type { Analysis } from "@/lib/analysis/run";
import { examKindFrom, normalizeBlock, normalizeTime, splitLecturers } from "@/lib/analysis/match";
import { resolveDate } from "@/lib/dates";
import type { SessionType } from "@/lib/supabase/types";

type DB = Awaited<ReturnType<typeof requireUser>>["supabase"];

// Dates the AI wrote with year 0000 had no year in the timetable; pick the nearest sensible year.
function fixDate(d: string | null | undefined) {
  if (!d) return null;
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return resolveDate(Number(m[3]), Number(m[2]), m[1] === "0000" ? null : Number(m[1]));
}

async function findOrCreateBlock(supabase: DB, name: string | null, start?: string | null, end?: string | null) {
  if (!name) return null;
  const { data: existing } = await supabase.from("blocks").select("id, start_date, end_date").ilike("name", name).maybeSingle();
  if (existing) {
    const s = [existing.start_date, start].filter(Boolean).sort()[0] ?? null;
    const e = [existing.end_date, end].filter(Boolean).sort().at(-1) ?? null;
    await supabase.from("blocks").update({ start_date: s, end_date: e }).eq("id", existing.id);
    return existing.id;
  }
  const { data } = await supabase.from("blocks").insert({ name, start_date: start ?? null, end_date: end ?? null }).select("id").single();
  return data?.id ?? null;
}

// Topics are unique per course, name and type; returns a lookup that creates missing ones.
async function topicFinder(supabase: DB) {
  const { data } = await supabase.from("topics").select("id, course_id, name, session_type, block_id, lecturer_id");
  const map = new Map((data ?? []).map((t) => [`${t.course_id}|${t.name.toLowerCase()}|${t.session_type}`, t]));
  return async (courseId: string, name: string, type: SessionType, blockId: string | null, lecturerId: string | null) => {
    const key = `${courseId}|${name.toLowerCase()}|${type}`;
    const hit = map.get(key);
    if (hit) {
      if ((!hit.block_id && blockId) || (!hit.lecturer_id && lecturerId)) {
        await supabase.from("topics").update({ block_id: hit.block_id ?? blockId, lecturer_id: hit.lecturer_id ?? lecturerId }).eq("id", hit.id);
      }
      return hit.id;
    }
    const { data: t } = await supabase
      .from("topics")
      .insert({ course_id: courseId, name, session_type: type, block_id: blockId, lecturer_id: lecturerId, sort_order: map.size })
      .select("id, course_id, name, session_type, block_id, lecturer_id")
      .single();
    if (t) map.set(key, t);
    return t?.id ?? null;
  };
}

const courseMap = (fd: FormData) => {
  const m = new Map<string, string>();
  for (const [k, v] of fd.entries()) if (k.startsWith("map:") && v) m.set(k.slice(4), String(v));
  return m;
};

export async function importTimetable(fd: FormData) {
  const { supabase } = await requireUser();
  const fileId = String(fd.get("file_id"));
  const { data: file } = await supabase.from("files").select("analysis").eq("id", fileId).single();
  const analysis = file?.analysis as Analysis | null;
  if (!analysis?.sessions) redirect(`/library/file/${fileId}`);

  const map = courseMap(fd);
  const included = new Set(fd.getAll("include").map(String));
  const sessions = analysis.sessions
    .map((s, i) => ({ ...s, i, courseId: map.get(s.course) ?? null, date: fixDate(s.date) }))
    .filter((s) => s.courseId && s.date && included.has(s.course));

  const dates = sessions.map((s) => s.date!).sort();
  const blockName = normalizeBlock(String(fd.get("block") ?? "")) ?? (String(fd.get("block") ?? "").trim() || null);
  const blockId = await findOrCreateBlock(supabase, blockName, dates[0], dates.at(-1));

  // Re-importing the same file replaces what it added before.
  await supabase.from("schedule_sessions").delete().eq("source_file_id", fileId);
  await supabase.from("course_exams").delete().eq("source_file_id", fileId);

  // Lecturers, from lectures only (practical cells list whole teams).
  const lecturerIds = new Map<string, string>();
  if (fd.get("opt_lecturers") === "on") {
    const { data: existing } = await supabase.from("lecturers").select("id, course_id, name");
    for (const l of existing ?? []) lecturerIds.set(`${l.course_id}|${l.name.toLowerCase()}`, l.id);
    for (const s of sessions.filter((x) => x.type === "lecture")) {
      for (const name of splitLecturers(s.lecturer)) {
        const key = `${s.courseId}|${name.toLowerCase()}`;
        if (lecturerIds.has(key)) continue;
        const { data } = await supabase.from("lecturers").insert({ course_id: s.courseId!, name }).select("id").single();
        if (data) lecturerIds.set(key, data.id);
      }
    }
  }

  const findTopic = await topicFinder(supabase);
  const rows = [];
  for (const s of sessions.filter((x) => x.type !== "assessment")) {
    const type: SessionType = s.type === "tutorial" || s.type === "practical" || s.type === "lecture" ? s.type : "other";
    let topicId: string | null = null;
    if (fd.get("opt_topics") === "on" && s.title.trim()) {
      const lecturer = splitLecturers(s.lecturer)[0];
      topicId = await findTopic(s.courseId!, s.title.trim(), type, blockId, lecturer ? (lecturerIds.get(`${s.courseId}|${lecturer.toLowerCase()}`) ?? null) : null);
    }
    rows.push({
      course_id: s.courseId!,
      block_id: blockId,
      topic_id: topicId,
      source_file_id: fileId,
      session_date: s.date!,
      start_time: normalizeTime(s.start_time),
      end_time: normalizeTime(s.end_time),
      session_type: type,
      title: s.title.trim() || "Session",
      lecturer: s.lecturer || null,
      venue: s.venue || null,
      groups: s.groups || null,
    });
  }
  for (let i = 0; i < rows.length; i += 200) await supabase.from("schedule_sessions").insert(rows.slice(i, i + 200));

  // Exams and EOPTs you ticked, with any date you corrected.
  const exams = [];
  for (const s of analysis.sessions.map((x, i) => ({ ...x, i }))) {
    if (s.type !== "assessment" || fd.get(`exam:${s.i}`) !== "on") continue;
    const courseId = map.get(s.course);
    const date = String(fd.get(`examdate:${s.i}`) || "") || fixDate(s.date);
    if (!courseId || !date) continue;
    exams.push({
      course_id: courseId,
      block_id: blockId,
      source_file_id: fileId,
      kind: examKindFrom(s.title, s.assessment_kind),
      label: s.title.trim() || "End of Posting Test",
      exam_date: date,
      start_time: normalizeTime(String(fd.get(`examtime:${s.i}`) || "") || s.start_time),
      venue: s.venue || null,
      confirmed: true,
    });
  }
  if (exams.length) await supabase.from("course_exams").insert(exams);

  await supabase.from("files").update({ analysis: { ...analysis, pendingReview: false, importedAt: new Date().toISOString() } }).eq("id", fileId);
  revalidatePath("/", "layout");
  redirect(`/library/file/${fileId}/review?done=${rows.length}-${exams.length}`);
}

export async function importTopics(fd: FormData) {
  const { supabase } = await requireUser();
  const fileId = String(fd.get("file_id"));
  const { data: file } = await supabase.from("files").select("analysis").eq("id", fileId).single();
  const analysis = file?.analysis as Analysis | null;
  if (!analysis?.topics) redirect(`/library/file/${fileId}`);

  const map = courseMap(fd);
  const findTopic = await topicFinder(supabase);
  const blocks = new Map<string, string | null>();
  let added = 0;
  for (const [i, t] of analysis.topics.entries()) {
    if (fd.get(`topic:${i}`) !== "on") continue;
    const courseId = map.get(t.course);
    if (!courseId || !t.name.trim()) continue;
    const blockName = normalizeBlock(t.block);
    if (blockName && !blocks.has(blockName)) blocks.set(blockName, await findOrCreateBlock(supabase, blockName));
    await findTopic(courseId, t.name.trim(), t.type === "other" ? "other" : t.type, blockName ? (blocks.get(blockName) ?? null) : null, null);
    added++;
  }
  await supabase.from("files").update({ analysis: { ...analysis, pendingReview: false, importedAt: new Date().toISOString() } }).eq("id", fileId);
  revalidatePath("/", "layout");
  redirect(`/library/file/${fileId}/review?done=${added}`);
}
