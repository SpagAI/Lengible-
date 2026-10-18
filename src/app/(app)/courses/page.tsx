import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourses } from "@/lib/courses";
import { PageHeader, ButtonLink, EmptyState } from "@/components/ui";
import { CourseCard } from "@/components/course-card";

export const metadata: Metadata = { title: "Courses" };

export default async function CoursesPage() {
  const { supabase } = await requireUser();
  const courses = await getCourses(supabase);
  return (
    <>
      <PageHeader
        title="Courses"
        action={
          <ButtonLink href="/courses/new" variant="secondary">
            <Plus size={16} /> New
          </ButtonLink>
        }
      />
      {courses.length ? (
        <div className="space-y-2">
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </div>
      ) : (
        <EmptyState title="No courses yet">Add your first course to get started.</EmptyState>
      )}
    </>
  );
}
