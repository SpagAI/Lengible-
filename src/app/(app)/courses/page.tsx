import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { courseTree, getCourses } from "@/lib/courses";
import { PageHeader, ButtonLink, EmptyState } from "@/components/ui";
import { CourseList } from "@/components/course-list";

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
      {courses.length ? <CourseList tree={courseTree(courses)} /> : <EmptyState title="No courses yet">Add your first course to get started.</EmptyState>}
    </>
  );
}
