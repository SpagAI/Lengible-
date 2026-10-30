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

  const due = (sources as DriveSource[]).filter((s) => force || !s.last_checked_at || Date.now() - new Date(s.last_checked_at).getTime() > 3600_000);
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
  const auto = new Set((sources as DriveSource[]).filter((s) => s.auto_import).map((s) => s.id));
  const stale = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: items } = await supabase
    .from("drive_items")
    .select("id, name, course_id, status, source_id, claimed_at, path")
    .eq("include", true)
    .in("status", ["new", "changed"])
    .or(`claimed_at.is.null,claimed_at.lt.${stale}`)
    .limit(200);
  // Changed files you brought in before are always refreshed; new files only for links that bring them in by themselves.
  const todo = (items ?? []).filter((i) => i.status === "changed" || auto.has(i.source_id));
  // A new file lands in a folder whose files you've already processed: process it too.
  // (Changed files are processed again only if you had processed them; the import works that out.)
  const processedFolders = new Set<string>();
  const fresh = todo.filter((i) => i.status === "new");
  if (fresh.length) {
    const { data: brought } = await supabase
      .from("drive_items")
      .select("source_id, path, file_id")
      .in("source_id", [...new Set(fresh.map((i) => i.source_id))])
      .eq("status", "imported")
      .not("file_id", "is", null);
    const ids = [...new Set((brought ?? []).map((b) => b.file_id!))];
    const status = new Map<string, string>();
    for (let k = 0; k < ids.length; k += 200) {
      const { data } = await supabase.from("files").select("id, status").in("id", ids.slice(k, k + 200));
      for (const f of data ?? []) status.set(f.id, f.status);
    }
    const byFolder = new Map<string, string[]>();
    for (const b of brought ?? []) {
      const key = `${b.source_id}/${b.path}`;
      byFolder.set(key, [...(byFolder.get(key) ?? []), status.get(b.file_id!) ?? "uploaded"]);
    }
    for (const [key, list] of byFolder) if (list.every((st) => st !== "uploaded")) processedFolders.add(key);
  }
  return NextResponse.json({
    ...summary,
    items: todo.map((i) => ({
      id: i.id,
      name: i.name,
      courseId: i.course_id,
      changed: i.status === "changed",
      process: i.status === "new" && processedFolders.has(`${i.source_id}/${i.path}`),
    })),
  });
}
