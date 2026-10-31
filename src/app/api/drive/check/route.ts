import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { driveKey, syncItems } from "@/lib/drive";
import type { DriveSource } from "@/lib/supabase/types";

// Google can be slow listing big folder trees.
export const maxDuration = 300;

// Looks at your Drive links again (each at most once an hour, or now with ?force=1) and returns
// the files to bring in: new ones (for links set to bring them in by themselves) and changed ones.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ items: [] });
  const force = req.nextUrl.searchParams.get("force") === "1";
  const { data: sources, error } = await supabase.from("drive_sources").select("*");
  if (error || !sources?.length || !driveKey()) return NextResponse.json({ items: [], checked: 0 });

  // Disconnected links aren't checked (their files stay in your Library).
  const live = (sources as DriveSource[]).filter((s) => !s.removed_at);
  const due = live.filter((s) => force || !s.last_checked_at || Date.now() - new Date(s.last_checked_at).getTime() > 3600_000);
  const summary = { checked: 0, added: 0, changed: 0, removed: 0, problems: [] as string[] };
  for (const s of due) {
    try {
      const r = await syncItems(supabase, s);
      summary.checked++;
      summary.added += r.added;
      summary.changed += r.changed;
      summary.removed += r.removed;
    } catch (e) {
      summary.problems.push(`${s.name}: ${e instanceof Error ? e.message : "couldn't check"}`);
    }
  }
  const auto = new Set(live.filter((s) => s.auto_import).map((s) => s.id));
  const stale = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: items } = await supabase
    .from("drive_items")
    .select("id, name, course_id, status, source_id, claimed_at, path")
    .eq("include", true)
    .in("status", ["new", "changed"])
    .or(`claimed_at.is.null,claimed_at.lt.${stale}`)
    .limit(200);
  // Changed files you brought in before are always refreshed; new files only for links kept up to date.
  // A new file comes in by itself only inside a folder you already brought in (ticking alone starts nothing).
  const sourcesWithNew = [...new Set((items ?? []).filter((i) => i.status === "new").map((i) => i.source_id))];
  const broughtIn = new Set<string>();
  for (const id of sourcesWithNew) {
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("drive_items").select("path").eq("source_id", id).eq("status", "imported").range(from, from + 999);
      for (const r of data ?? []) broughtIn.add(`${id}/${r.path}`);
      if (!data || data.length < 1000) break;
    }
  }
  const inBroughtInFolder = (sourceId: string, path: string) => {
    const parts = path.split("/").filter(Boolean);
    for (let k = parts.length; k >= 0; k--) if (broughtIn.has(`${sourceId}/${parts.slice(0, k).join("/")}`)) return true;
    return false;
  };
  const todo = (items ?? []).filter((i) =>
    i.status === "changed" ? live.some((s) => s.id === i.source_id) : auto.has(i.source_id) && inBroughtInFolder(i.source_id, i.path),
  );
  return NextResponse.json({
    ...summary,
    items: todo.map((i) => ({
      id: i.id,
      name: i.name,
      courseId: i.course_id,
      changed: i.status === "changed",
      // Everything brought in is processed too (changed files are always read again).
      process: true,
    })),
  });
}
