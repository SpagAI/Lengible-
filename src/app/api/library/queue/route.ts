import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ANALYSIS_VERSION, type Analysis } from "@/lib/analysis/run";

// The next file the background reader should work on: files not yet read the current way,
// ones part-way through, and ones whose reading stopped (not textbooks or files you chose to skip).
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ file: null });
  const { data } = await supabase
    .from("files")
    .select("id, name, doc_type, status, analysis, page_count, created_at")
    .in("status", ["extracted", "analysed"])
    .not("doc_type", "in", "(timetable,topic_list,textbook)")
    .order("created_at", { ascending: false })
    .limit(500);
  const waiting = (data ?? []).filter((f) => {
    const a = f.analysis as Analysis | null;
    if (!a) return true;
    if (a.kind !== "concepts") return false;
    if ((a.failures ?? 0) >= 3) return false;
    if (a.v !== ANALYSIS_VERSION) return true;
    return !a.finished && !a.skipped;
  });
  // Carry on with a file already part-read before starting a new one.
  waiting.sort((x, y) => Number(((y.analysis as Analysis | null)?.cursor ?? 0) > 0) - Number(((x.analysis as Analysis | null)?.cursor ?? 0) > 0));
  const f = waiting[0];
  if (!f) return NextResponse.json({ file: null, left: 0 });
  const a = f.analysis as Analysis | null;
  return NextResponse.json({
    file: { id: f.id, name: f.name, cursor: a?.v === ANALYSIS_VERSION ? (a?.cursor ?? 0) : 0, total: a?.totalPages || f.page_count || 0 },
    left: waiting.length,
  });
}
