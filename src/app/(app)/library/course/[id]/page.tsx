import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Folder as FolderIcon } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourses } from "@/lib/courses";
import { courseFromParam, folderPath } from "@/lib/library";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { SelectableFiles } from "@/components/library/selectable-files";
import { ProcessBar } from "@/components/library/process-bar";
import { SearchBox } from "@/components/library/search-box";
import { LibraryToolbar } from "@/components/library/toolbar";
import { AskPanel } from "@/components/ask/ask-panel";
import { MaterialQuiz } from "@/components/quiz/material-quiz";
import type { Folder, LibraryFile } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Library" };

export default async function CourseLibraryPage({ params, searchParams }: PageProps<"/library/course/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const folderId = typeof sp.folder === "string" ? sp.folder : null;
  const courseId = courseFromParam(id);
  const { supabase } = await requireUser();

  const courses = await getCourses(supabase);
  const course = courseId ? courses.find((c) => c.id === courseId) : null;
  if (courseId && !course) notFound();
  const children = course ? courses.filter((c) => c.parent_id === course.id) : [];

  const folderQuery = supabase.from("folders").select("*").order("name");
  const fileQuery = supabase.from("files").select("*").order("name");
  const storedQuery = supabase.from("files").select("id, name, folder_id").eq("status", "uploaded").order("name").limit(1000);
  const [{ data: folders }, { data: files }, { data: topics }, { data: stored }] = await Promise.all([
    courseId ? folderQuery.eq("course_id", courseId) : folderQuery.is("course_id", null),
    (courseId ? fileQuery.eq("course_id", courseId) : fileQuery.is("course_id", null)).filter(
      "folder_id",
      folderId ? "eq" : "is",
      folderId ?? null,
    ),
    courseId
      ? supabase.from("topics").select("id, name").in("course_id", [courseId, ...children.map((c) => c.id)]).neq("session_type", "section").order("name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    // Stored but not processed yet, anywhere in this course.
    courseId ? storedQuery.eq("course_id", courseId) : storedQuery.is("course_id", null),
  ]);

  const allFolders = (folders ?? []) as Folder[];
  const current = folderId ? allFolders.find((f) => f.id === folderId) : null;
  if (folderId && !current) notFound();
  const path = folderPath(allFolders, folderId);
  const subfolders = allFolders.filter((f) => f.parent_id === folderId);
  // Not-yet-processed files in this folder and its subfolders (or the whole course at the top).
  const inside = new Set<string | null>([folderId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of allFolders) {
      if (f.parent_id && inside.has(f.parent_id) && !inside.has(f.id)) {
        inside.add(f.id);
        grew = true;
      }
    }
  }
  const waiting = (stored ?? []).filter((f) => !folderId || inside.has(f.folder_id)).map((f) => ({ id: f.id, name: f.name }));
  const title = course?.name ?? "General";
  const base = `/library/course/${id}`;

  return (
    <>
      <nav className="mb-1 flex flex-wrap items-center gap-1 text-sm text-brand">
        <Link href="/library">Library</Link>
        {course?.parent_id && (
          <>
            <ChevronRight size={14} className="text-muted" />
            <Link href={`/library/course/${course.parent_id}`}>{courses.find((c) => c.id === course.parent_id)?.name}</Link>
          </>
        )}
        {path.length > 0 && (
          <>
            <ChevronRight size={14} className="text-muted" />
            <Link href={base}>{title}</Link>
          </>
        )}
        {path.slice(0, -1).map((f) => (
          <span key={f.id} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-muted" />
            <Link href={`${base}?folder=${f.id}`}>{f.name}</Link>
          </span>
        ))}
      </nav>
      <PageHeader
        title={current?.name ?? title}
        subtitle={
          courseId ? undefined : "Timetables, topic lists and anything that covers every course. Lengible can read timetables and topic lists into your courses."
        }
      />
      <LibraryToolbar
        courseId={courseId}
        folder={current ? { id: current.id, name: current.name } : null}
        topics={topics ?? []}
      />
      {current && (
        <div className="mt-3">
          <MaterialQuiz label={current.name} folderId={current.id} buttonLabel="Quiz me on this folder" />
        </div>
      )}
      {current || courseId ? (
        <div className="mt-4">
          <AskPanel scope={current ? { folderId: current.id } : { courseId }} scopeLabel={current ? path.map((f) => f.name).join(" / ") : title} compact />
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs text-muted">Exact word search instead</summary>
            <div className="mt-2">
              <SearchBox course={courseId ?? undefined} />
            </div>
          </details>
        </div>
      ) : (
        <div className="mt-4">
          <SearchBox course={courseId ?? undefined} />
        </div>
      )}

      {!folderId && children.length > 0 && (
        <Card className="mt-4 divide-y divide-border p-0">
          {children.map((k) => (
            <Link key={k.id} href={`/library/course/${k.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <FolderIcon size={20} className="text-brand" />
              <span className="flex-1 font-medium">{k.name}</span>
              <ChevronRight size={16} className="text-muted" />
            </Link>
          ))}
        </Card>
      )}

      {subfolders.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {subfolders.map((f) => (
            <Link key={f.id} href={`${base}?folder=${f.id}`}>
              <Card className="flex items-center gap-2 p-3 hover:bg-surface-2">
                <FolderIcon size={20} className="shrink-0 text-brand" />
                <span className="truncate text-sm font-medium">{f.name}</span>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-4">
        <ProcessBar files={waiting} />
        {files?.length ? (
          <SelectableFiles files={files as LibraryFile[]} label={current?.name ?? title} />
        ) : (
          !subfolders.length && !children.length && <EmptyState title="Empty">Tap Upload to add files, or New folder to organise them.</EmptyState>
        )}
      </div>
    </>
  );
}
