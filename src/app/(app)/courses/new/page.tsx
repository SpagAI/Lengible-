import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/supabase/server";
import { CourseForm } from "../course-form";

export const metadata: Metadata = { title: "New course" };

export default async function NewCoursePage() {
  const { supabase } = await requireUser();
  const { data: groups } = await supabase.from("courses").select("id, name").eq("is_group", true).order("sort_order");
  return (
    <>
      <PageHeader title="New course" />
      <CourseForm groups={groups ?? []} />
    </>
  );
}
