import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { courseTree, getCourses } from "@/lib/courses";
import { PageHeader } from "@/components/ui";
import { AskPanel } from "@/components/ask/ask-panel";
import type { AskScope } from "@/lib/ask";

export const metadata: Metadata = { title: "Ask AI" };

export default async function AskPage({ searchParams }: PageProps<"/ask">) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const courses = await getCourses(supabase);
  // Courses (and groups like Pathology, which search all their courses) in your order; ?course= picks one first.
  const scopes: { label: string; scope: AskScope }[] = [{ label: "All my materials", scope: {} }];
  for (const c of courseTree(courses)) {
    scopes.push({ label: c.children.length ? `${c.name} (all)` : c.name, scope: { courseId: c.id } });
    for (const k of c.children) scopes.push({ label: `— ${k.name}`, scope: { courseId: k.id } });
  }
  const want = typeof sp.course === "string" ? sp.course : null;
  const at = want ? scopes.findIndex((s) => s.scope.courseId === want) : -1;
  if (at > 0) scopes.unshift(...scopes.splice(at, 1));
  return (
    <>
      <PageHeader title="Ask AI" subtitle="Smart search across your slides and notes: answers with the exact file and slide, and quizzes from them." />
      <AskPanel scopes={scopes} />
    </>
  );
}
