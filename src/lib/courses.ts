import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Course, CourseExam, Database, Lecturer } from "@/lib/supabase/types";
import { courseModules, defaultCourses } from "@/modules/registry";
import { daysUntil } from "@/lib/dates";

type DB = SupabaseClient<Database>;

export type CourseWithDetails = Course & { course_exams: CourseExam[]; lecturers: Lecturer[] };

// On first sign-in, create the profile and the two starting courses with their topic sections.
// Keyed on the profile row, so deleting a course later won't bring it back.
export async function ensureSeeded(supabase: DB, user: User) {
  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (profile) return;

  const { error } = await supabase.from("profiles").insert({ id: user.id });
  // Another tab may have seeded at the same moment.
  if (error) return;

  const { data: courses } = await supabase
    .from("courses")
    .insert(defaultCourses.map((c, i) => ({ ...c, sort_order: i })))
    .select();
  for (const course of courses ?? []) {
    const sections = courseModules[course.kind].defaultSections;
    if (sections.length) {
      await supabase.from("topics").insert(sections.map((name, i) => ({ course_id: course.id, name, sort_order: i })));
    }
  }
}

export async function getCourses(supabase: DB) {
  const { data } = await supabase
    .from("courses")
    .select("*, course_exams(*), lecturers(*)")
    .eq("archived", false)
    .order("sort_order")
    .order("created_at");
  return (data ?? []) as CourseWithDetails[];
}

export async function getCourse(supabase: DB, id: string) {
  const { data } = await supabase.from("courses").select("*, course_exams(*), lecturers(*)").eq("id", id).maybeSingle();
  return data as CourseWithDetails | null;
}

// The soonest exam that hasn't happened yet, or null.
export function nextExam(exams: CourseExam[]) {
  return (
    exams
      .map((e) => ({ ...e, days: daysUntil(e.exam_date) }))
      .filter((e) => e.days >= 0)
      .sort((a, b) => a.days - b.days)[0] ?? null
  );
}
