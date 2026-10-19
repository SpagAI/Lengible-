import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { getCourses } from "@/lib/courses";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { SearchBox } from "@/components/library/search-box";
import { Snippet } from "@/components/library/snippet";
import type { SearchHit } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: PageProps<"/library/search">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const course = typeof sp.course === "string" ? sp.course : null;
  const { supabase } = await requireUser();
  const courses = await getCourses(supabase);
  const names = Object.fromEntries(courses.map((c) => [c.id, c.name]));
  // Searching a group (Pathology) searches its courses too.
  const scope = course ? [course, ...courses.filter((c) => c.parent_id === course).map((c) => c.id)] : null;

  let hits: SearchHit[] = [];
  let fileHits: { id: string; name: string; course_id: string | null }[] = [];
  let conceptHits: { id: string; name: string; kind: string }[] = [];
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const [{ data: h }, { data: f }, { data: c }] = await Promise.all([
      supabase.rpc("search_chunks", { q, lim: 60 }),
      supabase.from("files").select("id, name, course_id").ilike("name", like).limit(10),
      supabase.from("concepts").select("id, name, kind").ilike("name", like).limit(12),
    ]);
    hits = ((h ?? []) as SearchHit[]).filter((x) => !scope || (x.course_id && scope.includes(x.course_id)));
    fileHits = (f ?? []).filter((x) => !scope || (x.course_id && scope.includes(x.course_id)));
    conceptHits = c ?? [];
  }

  return (
    <>
      <PageHeader title="Search" subtitle={course ? `In ${names[course]}` : "Across all your materials"} />
      <SearchBox defaultValue={q} course={course ?? undefined} />

      {q && conceptHits.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {conceptHits.map((c) => (
            <Link key={c.id} href={`/library/concept/${c.id}`} className="rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand-strong">
              {c.name} <span className="text-xs font-normal opacity-70">· {c.kind}</span>
            </Link>
          ))}
        </div>
      )}

      {q && fileHits.length > 0 && (
        <Card className="mt-4 divide-y divide-border p-0">
          {fileHits.map((f) => (
            <Link key={f.id} href={`/library/file/${f.id}`} className="block px-4 py-3 hover:bg-surface-2">
              <span className="font-medium">{f.name}</span>
              <span className="block text-xs text-muted">{f.course_id ? names[f.course_id] : "General"} · file name match</span>
            </Link>
          ))}
        </Card>
      )}

      <div className="mt-4">
        {!q ? null : hits.length ? (
          <Card className="divide-y divide-border p-0">
            {hits.map((h) => (
              <Link key={h.chunk_id} href={`/library/file/${h.file_id}?page=${h.page}`} className="block px-4 py-3 hover:bg-surface-2">
                <span className="block font-medium">{h.file_name}</span>
                <span className="block text-xs text-muted">
                  {h.course_id ? names[h.course_id] : "General"} · page {h.page}
                </span>
                <Snippet text={h.snippet} />
              </Link>
            ))}
          </Card>
        ) : (
          <EmptyState title="No matches">Try fewer or different words. Only files whose text was read can be searched.</EmptyState>
        )}
      </div>
    </>
  );
}
