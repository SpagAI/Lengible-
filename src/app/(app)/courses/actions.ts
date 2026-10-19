"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import type { CourseKind, ExamKind } from "@/lib/supabase/types";
import { courseModules } from "@/modules/registry";
import { courseColors } from "@/components/ui";

export type CourseFormState = { error?: string };

const all = (fd: FormData, key: string) => fd.getAll(key).map((v) => String(v).trim());

export async function saveCourse(_prev: CourseFormState, fd: FormData): Promise<CourseFormState> {
  const { supabase } = await requireUser();

  const id = String(fd.get("id") ?? "") || null;
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Give the course a name." };
  const kindInput = String(fd.get("kind") ?? "general");
  const kind = (kindInput in courseModules ? kindInput : "general") as CourseKind;
  const colorInput = String(fd.get("color") ?? "teal");
  const parentId = String(fd.get("parent_id") ?? "") || null;
  const fields = {
    parent_id: parentId === id ? null : parentId,
    is_group: fd.get("is_group") === "on",
    short_name: String(fd.get("short_name") ?? "").trim() || null,
    name,
    code: String(fd.get("code") ?? "").trim() || null,
    kind,
    color: colorInput in courseColors ? colorInput : "teal",
    notes: String(fd.get("notes") ?? "").trim() || null,
  };

  let courseId = id;
  if (courseId) {
    const { error } = await supabase.from("courses").update(fields).eq("id", courseId);
    if (error) return { error: "Couldn't save the course. Please try again." };
  } else {
    const { data, error } = await supabase.from("courses").insert(fields).select("id").single();
    if (error || !data) return { error: "Couldn't create the course. Please try again." };
    courseId = data.id;
    const sections = courseModules[kind].defaultSections;
    if (sections.length) {
      await supabase.from("topics").insert(sections.map((n, i) => ({ course_id: courseId!, name: n, sort_order: i })));
    }
  }

  // Exams keep their ids (they may have come from a timetable). Saving them here confirms them.
  const examIds = all(fd, "exam_id");
  const examKinds = all(fd, "exam_kind");
  const examLabels = all(fd, "exam_label");
  const examDates = all(fd, "exam_date");
  const examTimes = all(fd, "exam_time");
  const exams = examDates
    .map((exam_date, i) => ({
      id: examIds[i] || null,
      exam_date,
      kind: (["eopt", "exam", "test", "mb", "other"].includes(examKinds[i]) ? examKinds[i] : "exam") as ExamKind,
      label: examLabels[i] || (examKinds[i] === "eopt" ? "End of Posting Test" : "Exam"),
      start_time: examTimes[i] || null,
      confirmed: true,
    }))
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.exam_date));
  const keepExamIds = exams.flatMap((e) => (e.id ? [e.id] : []));
  const { data: existingExams } = await supabase.from("course_exams").select("id").eq("course_id", courseId);
  const removedExams = (existingExams ?? []).map((e) => e.id).filter((x) => !keepExamIds.includes(x));
  if (removedExams.length) await supabase.from("course_exams").delete().in("id", removedExams);
  for (const { id: examId, ...e } of exams) {
    if (examId) await supabase.from("course_exams").update(e).eq("id", examId);
    else await supabase.from("course_exams").insert({ ...e, course_id: courseId! });
  }

  // Lecturers keep their ids, because topics get linked to them later.
  const lecIds = all(fd, "lecturer_id");
  const lecNames = all(fd, "lecturer_name");
  const lecNotes = all(fd, "lecturer_notes");
  const lecturers = lecNames.map((n, i) => ({ id: lecIds[i] || null, name: n, notes: lecNotes[i] || null })).filter((l) => l.name);
  const keepIds = lecturers.flatMap((l) => (l.id ? [l.id] : []));
  const { data: existing } = await supabase.from("lecturers").select("id").eq("course_id", courseId);
  const removed = (existing ?? []).map((l) => l.id).filter((x) => !keepIds.includes(x));
  if (removed.length) await supabase.from("lecturers").delete().in("id", removed);
  for (const l of lecturers) {
    if (l.id) await supabase.from("lecturers").update({ name: l.name, notes: l.notes }).eq("id", l.id);
    else await supabase.from("lecturers").insert({ course_id: courseId!, name: l.name, notes: l.notes });
  }

  revalidatePath("/", "layout");
  redirect(`/courses/${courseId}`);
}

export async function deleteCourse(fd: FormData) {
  const { supabase } = await requireUser();
  const id = String(fd.get("id") ?? "");
  if (id) await supabase.from("courses").delete().eq("id", id);
  revalidatePath("/", "layout");
  redirect("/courses");
}

// Confirms or removes an exam date that was detected from a timetable.
export async function confirmExam(fd: FormData) {
  const { supabase } = await requireUser();
  const id = String(fd.get("id") ?? "");
  if (fd.get("decision") === "remove") await supabase.from("course_exams").delete().eq("id", id);
  else await supabase.from("course_exams").update({ confirmed: true }).eq("id", id);
  revalidatePath("/", "layout");
}
