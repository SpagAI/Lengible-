import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { groupsForTopic } from "@/data/drugs/syllabus";

// Which drug groups your Pharmacology topics cover: class id → topic names.
// A topic that covers a group also covers all of its subgroups.
export async function syllabusCoverage(supabase: SupabaseClient<Database>): Promise<{ hasTopics: boolean; byClass: Record<string, string[]> }> {
  const { data: courses } = await supabase.from("courses").select("id").eq("kind", "pharmacology").eq("is_group", false);
  const ids = (courses ?? []).map((c) => c.id);
  if (!ids.length) return { hasTopics: false, byClass: {} };
  const [{ data: topics }, { data: classes }] = await Promise.all([
    supabase.from("topics").select("name").in("course_id", ids).neq("session_type", "section"),
    supabase.from("drug_classes").select("id, seed_key, parent_id"),
  ]);
  const byKey = new Map((classes ?? []).filter((c) => c.seed_key).map((c) => [c.seed_key!, c.id]));
  const childrenOf = new Map<string, string[]>();
  for (const c of classes ?? []) if (c.parent_id) childrenOf.set(c.parent_id, [...(childrenOf.get(c.parent_id) ?? []), c.id]);

  const byClass: Record<string, string[]> = {};
  const mark = (id: string, topic: string) => {
    const list = (byClass[id] ??= []);
    if (!list.includes(topic)) list.push(topic);
    for (const k of childrenOf.get(id) ?? []) mark(k, topic);
  };
  for (const t of topics ?? []) {
    for (const key of groupsForTopic(t.name)) {
      const id = byKey.get(key);
      if (id) mark(id, t.name);
    }
  }
  return { hasTopics: !!topics?.length, byClass };
}
