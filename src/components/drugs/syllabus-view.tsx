import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { groupsForTopic, PRINCIPLES } from "@/data/drugs/syllabus";
import { Card, EmptyState, ButtonLink } from "@/components/ui";

// Your Pharmacology topics (from your imported topic list / timetable), each with the drug groups it covers.
export async function SyllabusView({ supabase }: { supabase: SupabaseClient<Database> }) {
  const { data: courses } = await supabase.from("courses").select("id").eq("kind", "pharmacology").eq("is_group", false);
  const ids = (courses ?? []).map((c) => c.id);
  const [{ data: topics }, { data: blocks }, { data: classes }, { data: drugs }] = await Promise.all([
    ids.length ? supabase.from("topics").select("id, name, block_id, session_type, sort_order").in("course_id", ids).neq("session_type", "section").order("sort_order") : Promise.resolve({ data: [] }),
    supabase.from("blocks").select("id, name").order("name"),
    supabase.from("drug_classes").select("id, seed_key, name, parent_id"),
    supabase.from("drugs").select("class_id"),
  ]);
  if (!topics?.length) {
    return (
      <EmptyState title="No Pharmacology topics yet">
        Import your topic list or timetable in the Library (General) and your Pharmacology topics will appear here with their drug groups.
        <div className="mt-3">
          <ButtonLink href="/library/course/general" variant="secondary">
            Go to Library → General
          </ButtonLink>
        </div>
      </EmptyState>
    );
  }
  const byKey = new Map((classes ?? []).filter((c) => c.seed_key).map((c) => [c.seed_key!, c]));
  // Drugs per group, including those in its subgroups.
  const count = new Map<string, number>();
  const parentOf = new Map((classes ?? []).map((c) => [c.id, c.parent_id]));
  for (const d of drugs ?? []) {
    for (let id: string | null | undefined = d.class_id; id; id = parentOf.get(id)) count.set(id, (count.get(id) ?? 0) + 1);
  }
  const blockName = (id: string | null) => (blocks ?? []).find((b) => b.id === id)?.name ?? "No block";
  const grouped = new Map<string, typeof topics>();
  for (const t of topics) grouped.set(blockName(t.block_id), [...(grouped.get(blockName(t.block_id)) ?? []), t]);
  const mapped = topics.filter((t) => groupsForTopic(t.name).length).length;
  const principles = topics.filter((t) => !groupsForTopic(t.name).length && PRINCIPLES.test(t.name.toLowerCase())).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {mapped} of {topics.length} topics are linked to drug groups{principles ? `; ${principles} are principles topics (no specific drugs)` : ""}. Tap a group to study it.
      </p>
      {[...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([block, list]) => (
          <section key={block}>
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">{block}</h2>
            <Card className="divide-y divide-border p-0">
              {list!.map((t) => {
                const groups = groupsForTopic(t.name)
                  .map((k) => byKey.get(k))
                  .filter(Boolean) as { id: string; name: string }[];
                return (
                  <div key={t.id} className="px-4 py-3">
                    <p className="text-sm font-medium">
                      {t.name} {t.session_type !== "lecture" && <span className="text-xs font-normal text-muted">· {t.session_type}</span>}
                    </p>
                    {groups.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {groups.map((g) => (
                          <Link key={g.id} href={`/drugs/class/${g.id}`} className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong">
                            {g.name} <span className="opacity-60">· {count.get(g.id) ?? 0}</span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted">
                        {PRINCIPLES.test(t.name.toLowerCase()) ? "Principles topic — no specific drug group." : "No drug group matched — browse All drugs or search."}
                      </p>
                    )}
                  </div>
                );
              })}
            </Card>
          </section>
        ))}
    </div>
  );
}
