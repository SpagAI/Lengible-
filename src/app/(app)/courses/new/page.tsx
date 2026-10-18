import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { CourseForm } from "../course-form";

export const metadata: Metadata = { title: "New course" };

export default function NewCoursePage() {
  return (
    <>
      <PageHeader title="New course" />
      <CourseForm />
    </>
  );
}
