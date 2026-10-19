import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SearchHit } from "@/lib/supabase/types";

// Every place in your materials that mentions any of these terms, best matches first.
export async function findMentions(supabase: SupabaseClient<Database>, terms: string[], limit = 60) {
  const q = terms
    .map((t) => t.replace(/["]/g, "").trim())
    .filter(Boolean)
    .map((t) => `"${t}"`)
    .join(" or ");
  if (!q) return [] as SearchHit[];
  const { data } = await supabase.rpc("search_chunks", { q, lim: limit });
  return (data ?? []) as SearchHit[];
}
