import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Course, CourseExam, Database, Lecturer } from "@/lib/supabase/types";
import { defaultCourses, STRUCTURE_VERSION, type StarterCourse } from "@/modules/registry";
import { daysUntil } from "@/lib/dates";

type DB = SupabaseClient<Database>;

export type CourseWithDetails = Course & { course_exams: CourseExam[]; lecturers: Lecturer[] };
export type CourseNode = CourseWithDetails & { children: CourseWithDetails[] };

export type SeedResult = "ok" | "changed" | "needs_migration";

async function createStarter(supabase: DB, c: StarterCourse, sortOrder: number, parentId: string | null = null) {
  const { data } = await supabase
    .from("courses")
    .insert({ name: c.name, short_name: c.short, kind: c.kind, color: c.color, sort_order: sortOrder, parent_id: parentId, is_group: !!c.children })
    .select("id")
    .single();
  if (data && c.children) {
    for (const [i, child] of c.children.entries()) await createStarter(supabase, child, i, data.id);
  }
}

// Phase 1 accounts had a single "Pathology" and "Pharmacology" course. Turn Pathology into a group
// holding its four departments and rename Pharmacology, keeping everything already entered.
async function upgradeToV2(supabase: DB) {
  const { data: courses } = await supabase.from("courses").select("id, name, kind, is_group, parent_id");
  const all = courses ?? [];
  for (const [i, starter] of defaultCourses.entries()) {
    const existing = all.find((c) => c.kind === starter.kind && !c.parent_id && (c.name === starter.name || starter.name.startsWith(c.name)));
    if (!existing) {
      await createStarter(supabase, starter, i);
      continue;
    }
    await supabase
      .from("courses")
      .update({ name: starter.name, short_name: starter.short, is_group: !!starter.children })
      .eq("id", existing.id);
    for (const [j, child] of (starter.children ?? []).entries()) {
      if (!all.some((c) => c.parent_id === existing.id && c.name === child.name)) await createStarter(supabase, child, j, existing.id);
    }
  }
}

// On first sign-in, create the profile and the starting courses. Keyed on the profile row,
// so deleting a course later won't bring it back.
export async function ensureSeeded(supabase: DB, user: User): Promise<SeedResult> {
  const { data: profile, error } = await supabase.from("profiles").select("id, structure_version").eq("id", user.id).maybeSingle();
  // The Phase 2 database update hasn't been run yet.
  if (error) return "needs_migration";

  if (!profile) {
    const { error: insertError } = await supabase.from("profiles").insert({ id: user.id, structure_version: STRUCTURE_VERSION });
    if (insertError) return "ok"; // another tab seeded at the same moment
    for (const [i, c] of defaultCourses.entries()) await createStarter(supabase, c, i);
    return "changed";
  }

  if (profile.structure_version < STRUCTURE_VERSION) {
    // Claim the upgrade first so two tabs don't both run it.
    const { data: claimed } = await supabase
      .from("profiles")
      .update({ structure_version: STRUCTURE_VERSION })
      .eq("id", user.id)
      .lt("structure_version", STRUCTURE_VERSION)
      .select("id");
    if (claimed?.length) {
      await upgradeToV2(supabase);
      return "changed";
    }
  }
  return "ok";
}

export async function getCourses(supabase: DB) {
  const { data } = await supabase
    .from("courses")
    .select("*, course_exams(*), lecturers(*)")
    .eq("archived", false)
    .order("sort_order")
    .order("created_at");
  return (data ?? []) as unknown as CourseWithDetails[];
}

// Top-level courses with their sub-courses (e.g. Pathology → Histopathology, ...).
export function courseTree(courses: CourseWithDetails[]): CourseNode[] {
  return courses
    .filter((c) => !c.parent_id)
    .map((c) => ({ ...c, children: courses.filter((k) => k.parent_id === c.id) }));
}

// Courses that hold material directly (sub-courses and stand-alone courses, not groups).
export function leafCourses(courses: CourseWithDetails[]) {
  return courses.filter((c) => !c.is_group);
}

export async function getCourse(supabase: DB, id: string) {
  const { data } = await supabase.from("courses").select("*, course_exams(*), lecturers(*)").eq("id", id).maybeSingle();
  return data as unknown as CourseWithDetails | null;
}

export type UpcomingExam = CourseExam & { days: number };

// Exams that haven't happened yet, soonest first. Only confirmed dates count down.
export function upcomingExams(exams: CourseExam[], includeUnconfirmed = false): UpcomingExam[] {
  return exams
    .filter((e) => includeUnconfirmed || e.confirmed)
    .map((e) => ({ ...e, days: daysUntil(e.exam_date) }))
    .filter((e) => e.days >= 0)
    .sort((a, b) => a.days - b.days || (a.start_time ?? "").localeCompare(b.start_time ?? ""));
}

export function nextExam(exams: CourseExam[]) {
  return upcomingExams(exams)[0] ?? null;
}

export const examKindLabel: Record<string, string> = { eopt: "EOPT", exam: "Exam", test: "Test", mb: "MB", other: "Other" };
