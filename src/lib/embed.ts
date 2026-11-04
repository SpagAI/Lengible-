import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LibraryFile } from "@/lib/supabase/types";
import { canEmbed, embedTexts, toVector } from "@/lib/ai";

type DB = SupabaseClient<Database>;

// Indexes a file's pages for search by meaning, 25 pages per AI call (smaller calls stay under Google's per-minute limits); pages already indexed are skipped,
// so it carries on where it stopped.
export async function embedStep(supabase: DB, file: LibraryFile, deadline: number): Promise<{ finished: boolean; done: number; total: number }> {
  const { count: total } = await supabase.from("chunks").select("id", { count: "exact", head: true }).eq("file_id", file.id);
  // Without an embedding key, search by meaning is simply off (word search still works).
  if (!canEmbed()) return { finished: true, done: total ?? 0, total: total ?? 0 };
  for (;;) {
    const { data: todo } = await supabase.from("chunks").select("id, page, content").eq("file_id", file.id).is("embedding", null).order("page").limit(25);
    if (!todo?.length) return { finished: true, done: total ?? 0, total: total ?? 0 };
    // The file's name and topics go with each page, so "warfarin slides" also finds pages that only say "INR".
    const header = `${file.name}${file.profile?.topics?.length ? ` — ${file.profile.topics.slice(0, 6).join(", ")}` : ""}`;
    const vectors = await embedTexts(
      todo.map((c) => `${header}\n${c.content}`),
      "RETRIEVAL_DOCUMENT",
    );
    if (!vectors || !vectors.some((v) => v?.length)) return { finished: true, done: total ?? 0, total: total ?? 0 };
    await Promise.all(todo.map((c, i) => (vectors[i]?.length ? supabase.from("chunks").update({ embedding: toVector(vectors[i]) }).eq("id", c.id) : null)));
    const { count: left } = await supabase.from("chunks").select("id", { count: "exact", head: true }).eq("file_id", file.id).is("embedding", null);
    if (!left) return { finished: true, done: total ?? 0, total: total ?? 0 };
    if (Date.now() > deadline - 40_000) return { finished: false, done: (total ?? 0) - left, total: total ?? 0 };
  }
}

// Background indexing: pages not yet indexed for search by meaning (because the AI's limit was reached while
// their file was processed), a few at a time while time allows. Not part of the queue, so files never wait for it.
// After the AI says "limit reached", this server leaves it alone for a few minutes.
let pausedUntil = 0;
export async function indexMissing(supabase: DB, deadline: number) {
  if (!canEmbed() || Date.now() < pausedUntil) return 0;
  let indexed = 0;
  while (Date.now() < deadline - 20_000) {
    const { data: todo } = await supabase.from("chunks").select("id, file_id, content").is("embedding", null).limit(25);
    if (!todo?.length) break;
    const ids = [...new Set(todo.map((c) => c.file_id))];
    const { data: files } = await supabase.from("files").select("id, name, profile").in("id", ids);
    const header = new Map((files ?? []).map((f) => [f.id, `${f.name}${(f.profile as LibraryFile["profile"])?.topics?.length ? ` — ${(f.profile as LibraryFile["profile"])!.topics.slice(0, 6).join(", ")}` : ""}`]));
    let vectors: number[][] | null;
    try {
      vectors = await embedTexts(
        todo.map((c) => `${header.get(c.file_id) ?? ""}\n${c.content}`),
        "RETRIEVAL_DOCUMENT",
      );
    } catch {
      pausedUntil = Date.now() + 3 * 60_000;
      break;
    }
    if (!vectors || !vectors.some((v) => v?.length)) break;
    await Promise.all(todo.map((c, i) => (vectors![i]?.length ? supabase.from("chunks").update({ embedding: toVector(vectors![i]) }).eq("id", c.id) : null)));
    indexed += todo.length;
  }
  return indexed;
}
