import { NextResponse, type NextRequest } from "next/server";
import { loadOwnFile } from "@/lib/api";
import { ANALYSIS_VERSION, type Analysis } from "@/lib/analysis/run";

export type FileProgress = {
  name: string;
  status: string;
  docType: string;
  sizeBytes: number | null;
  pageCount: number;
  textPages: number;
  picturePages: number;
  reading: { cursor: number; total: number; finished: boolean; skipped: boolean; pendingReview: boolean; failures: number; current: boolean } | null;
  sections: { title: string; start: number; end: number }[];
  concepts: number;
  topicsLinked: number;
};

// Where a file is in its processing: text saved, picture pages read, AI reading position,
// and what has been found so far. Used by the progress panel and the file page.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/files/[id]/progress">) {
  const { id } = await ctx.params;
  const loaded = await loadOwnFile(id);
  if ("error" in loaded) return loaded.error;
  const { supabase, file } = loaded;
  const [{ count: textPages }, { count: picturePages }, { count: topicsLinked }] = await Promise.all([
    supabase.from("chunks").select("id", { count: "exact", head: true }).eq("file_id", id),
    supabase.from("chunks").select("id", { count: "exact", head: true }).eq("file_id", id).ilike("content", "%Image:%"),
    supabase.from("topic_files").select("topic_id", { count: "exact", head: true }).eq("file_id", id),
  ]);
  const a = file.analysis as Analysis | null;
  const body: FileProgress = {
    name: file.name,
    status: file.status,
    docType: file.doc_type,
    sizeBytes: file.size_bytes,
    pageCount: file.page_count ?? 0,
    textPages: textPages ?? 0,
    picturePages: picturePages ?? 0,
    reading: a
      ? {
          cursor: a.cursor ?? 0,
          total: a.totalPages ?? 0,
          finished: !!a.finished || (!!a.importedAt && a.kind !== "concepts"),
          skipped: !!a.skipped,
          pendingReview: !!a.pendingReview,
          failures: a.failures ?? 0,
          current: a.kind !== "concepts" || a.v === ANALYSIS_VERSION,
        }
      : null,
    sections: (a?.sections ?? []).map((s) => ({ title: s.title, start: s.start_page, end: s.end_page })),
    concepts: a?.concepts?.length ?? 0,
    topicsLinked: topicsLinked ?? 0,
  };
  return NextResponse.json(body);
}
