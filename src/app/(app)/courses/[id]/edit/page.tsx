import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { getCourse } from "@/lib/courses";
import { PageHeader } from "@/components/ui";
import { CourseForm } from "../../course-form";
import { deleteCourse } from "../../actions";
import { DeleteCourseButton } from "./delete-button";

export const metadata: Metadata = { title: "Edit course" };

export default async function EditCoursePage({ params }: PageProps<"/courses/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const course = await getCourse(supabase, id);
  if (!course) notFound();
  const { data: groups } = await supabase.from("courses").select("id, name").eq("is_group", true).order("sort_order");

  return (
    <>
      <PageHeader title={`Edit ${course.name}`} />
      <CourseForm course={course} groups={groups ?? []} />
      <form action={deleteCourse} className="mt-10 border-t border-border pt-5">
        <input type="hidden" name="id" value={course.id} />
        <p className="mb-2 text-sm text-muted">Deleting a course removes its exams, lecturers and topics. This can&apos;t be undone.</p>
        <DeleteCourseButton name={course.name} />
      </form>
    </>
  );
}
