import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LibraryFile } from "@/lib/supabase/types";
import { canEmbed, embedTexts, toVector } from "@/lib/ai";

type DB = SupabaseClient<Database>;

// Indexes a file's pages for search by meaning, 50 pages per AI call; pages already indexed are skipped,
// so it carries on where it stopped.
export async function embedStep(supabase: DB, file: LibraryFile, deadline: number): Promise<{ finished: boolean; done: number; total: number }> {
  const { count: total } = await supabase.from("chunks").select("id", { count: "exact", head: true }).eq("file_id", file.id);
  // Without an embedding key, search by meaning is simply off (word search still works).
  if (!canEmbed()) return { finished: true, done: total ?? 0, total: total ?? 0 };
  for (;;) {
    const { data: todo } = await supabase.from("chunks").select("id, page, content").eq("file_id", file.id).is("embedding", null).order("page").limit(50);
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
