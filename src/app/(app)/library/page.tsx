import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FolderOpen, Network } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { courseTree, getCourses } from "@/lib/courses";
import { PageHeader, Card, EmptyState, colorFor, cx } from "@/components/ui";
import { SearchBox } from "@/components/library/search-box";
import { FileRow } from "@/components/library/file-row";
import type { LibraryFile } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage() {
  const { supabase } = await requireUser();
  const [courses, { data: files }, { count: conceptCount }] = await Promise.all([
    getCourses(supabase),
    supabase.from("files").select("*").order("created_at", { ascending: false }),
    supabase.from("concepts").select("id", { count: "exact", head: true }),
  ]);
  const all = (files ?? []) as LibraryFile[];
  const count = (id: string | null) => all.filter((f) => f.course_id === id).length;
  const names = Object.fromEntries(courses.map((c) => [c.id, c.short_name || c.name]));
  const toReview = all.filter((f) => (f.analysis as { pendingReview?: boolean } | null)?.pendingReview);

  return (
    <>
      <PageHeader title="Library" subtitle="All your materials, organised by course. Open a course to upload." />
      <SearchBox />

      {toReview.length > 0 && (
        <Card className="mt-4 border-brand/40 bg-brand-soft/40">
          <p className="mb-2 text-sm font-medium">Waiting for your review</p>
          <ul className="space-y-1 text-sm">
            {toReview.map((f) => (
              <li key={f.id}>
                <Link href={`/library/file/${f.id}/review`} className="text-brand underline">
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-4 divide-y divide-border p-0">
        <Row href="/library/course/general" name="General (timetables, topic lists for all courses)" n={count(null)} />
        {courseTree(courses).map((c) => (
          <div key={c.id} className="divide-y divide-border">
            <Row href={`/library/course/${c.id}`} name={c.name} n={count(c.id) + c.children.reduce((s, k) => s + count(k.id), 0)} color={c.color} />
            {c.children.map((k) => (
              <Row key={k.id} href={`/library/course/${k.id}`} name={k.name} n={count(k.id)} color={k.color} nested />
            ))}
          </div>
        ))}
      </Card>

      <Link href="/library/index" className="mt-4 block">
        <Card className="flex items-center gap-3 hover:bg-surface-2">
          <Network size={22} className="text-brand" />
          <span className="flex-1">
            <span className="block font-medium">Drugs, diseases & links between courses</span>
            <span className="block text-sm text-muted">{conceptCount ?? 0} found in your materials so far</span>
          </span>
          <ChevronRight size={18} className="text-muted" />
        </Card>
      </Link>

      <h2 className="mt-6 mb-2 text-sm font-semibold text-muted">Recently added</h2>
      {all.length ? (
        <Card className="divide-y divide-border p-0">
          {all.slice(0, 8).map((f) => (
            <FileRow key={f.id} file={f} courseName={f.course_id ? names[f.course_id] : "General"} />
          ))}
        </Card>
      ) : (
        <EmptyState title="Nothing uploaded yet">
          Start with <b>General</b>: upload your master timetable and topic lists, so Lengible can set up your topics and EOPT dates.
        </EmptyState>
      )}
    </>
  );
}

function Row({ href, name, n, color, nested }: { href: string; name: string; n: number; color?: string; nested?: boolean }) {
  return (
    <Link href={href} className={cx("flex items-center gap-3 px-4 py-3 hover:bg-surface-2", nested && "pl-10")}>
      <FolderOpen size={20} className={cx("shrink-0", color ? "text-brand" : "text-muted")} />
      {color && <span className={cx("size-2.5 shrink-0 rounded-full", colorFor(color).dot)} />}
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      <span className="text-xs text-muted">{n} files</span>
      <ChevronRight size={16} className="text-muted" />
    </Link>
  );
}
