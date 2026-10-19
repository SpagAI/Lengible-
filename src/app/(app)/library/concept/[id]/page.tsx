import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourses } from "@/lib/courses";
import { findMentions } from "@/lib/mentions";
import { updateConcept, deleteConcept } from "../actions";
import { PageHeader, Card, Field, Button, inputClass, colorFor, cx, EmptyState } from "@/components/ui";
import { Snippet } from "@/components/library/snippet";
import { ConfirmButton } from "@/components/confirm-button";
import type { Concept } from "@/lib/supabase/types";

export async function generateMetadata({ params }: PageProps<"/library/concept/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data } = await supabase.from("concepts").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Topic link" };
}

const kindLabel: Record<string, string> = { drug: "Drug", disease: "Disease", organism: "Organism", investigation: "Investigation", other: "Other" };

export default async function ConceptPage({ params }: PageProps<"/library/concept/[id]">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data } = await supabase.from("concepts").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const concept = data as Concept;

  const [courses, hits, { data: drugMatches }] = await Promise.all([
    getCourses(supabase),
    findMentions(supabase, [concept.name, ...concept.aliases]),
    concept.kind === "drug" || concept.kind === "other"
      ? supabase.from("drugs").select("id, name").or([concept.name, ...concept.aliases].map((n) => `name.ilike.${n.replace(/[,()]/g, " ").trim()}%`).join(","))
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const drugPage = drugMatches?.[0];
  const byCourse = new Map<string, typeof hits>();
  for (const h of hits) byCourse.set(h.course_id ?? "general", [...(byCourse.get(h.course_id ?? "general") ?? []), h]);
  const order = [...courses.map((c) => c.id), "general"].filter((k) => byCourse.has(k));
  const courseOf = (k: string) => courses.find((c) => c.id === k);

  return (
    <>
      <Link href="/library/index" className="mb-1 inline-block text-sm text-brand">
        ← Drugs, diseases & links
      </Link>
      <PageHeader
        title={concept.name}
        subtitle={`${kindLabel[concept.kind]} · mentioned in ${order.length} ${order.length === 1 ? "course" : "courses"}${concept.aliases.length ? ` · also called ${concept.aliases.join(", ")}` : ""}`}
      />

      {drugPage && (
        <Link href={`/drugs/${drugPage.id}`} className="mb-4 block">
          <Card className="flex items-center justify-between gap-3 border-brand/40 hover:bg-surface-2">
            <span className="text-sm">
              <b>{drugPage.name}</b> in your drug database: mechanism, uses, side effects, brands
            </span>
            <span className="text-brand">→</span>
          </Card>
        </Link>
      )}

      {order.length > 1 && (
        <Card className="mb-4 bg-brand-soft/40 text-sm">
          <b>Connection:</b> {concept.name} comes up in {order.map((k) => courseOf(k)?.name ?? "General").join(", ")}. Read them together to see how
          the courses link up.
        </Card>
      )}
      {concept.notes && <Card className="mb-4 text-sm whitespace-pre-wrap">{concept.notes}</Card>}

      {order.length ? (
        <div className="space-y-4">
          {order.map((k) => {
            const c = courseOf(k);
            return (
              <section key={k}>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <span className={cx("size-2.5 rounded-full", c ? colorFor(c.color).dot : "bg-muted")} />
                  {c?.name ?? "General"}
                </h2>
                <Card className="divide-y divide-border p-0">
                  {byCourse.get(k)!.map((h) => (
                    <Link key={h.chunk_id} href={`/library/file/${h.file_id}?page=${h.page}`} className="block px-4 py-3 hover:bg-surface-2">
                      <span className="block text-sm font-medium">
                        {h.file_name} <span className="font-normal text-muted">· page {h.page}</span>
                      </span>
                      <Snippet text={h.snippet} />
                    </Link>
                  ))}
                </Card>
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No mentions found">The files that mentioned it may have been deleted.</EmptyState>
      )}

      <details className="mt-6 rounded-2xl border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">Edit or correct this entry</summary>
        <form action={updateConcept} className="mt-4 space-y-4">
          <input type="hidden" name="id" value={concept.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input name="name" defaultValue={concept.name} required className={inputClass} />
            </Field>
            <Field label="Kind">
              <select name="kind" defaultValue={concept.kind} className={inputClass}>
                {Object.entries(kindLabel).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Other names" hint="Separate with commas, e.g. paracetamol, acetaminophen. Used to find more mentions.">
            <input name="aliases" defaultValue={concept.aliases.join(", ")} className={inputClass} />
          </Field>
          <Field label="Your notes">
            <textarea name="notes" rows={3} defaultValue={concept.notes ?? ""} className={cx(inputClass, "py-2")} />
          </Field>
          <Button type="submit">Save</Button>
        </form>
        <form action={deleteConcept} className="mt-4 border-t border-border pt-4">
          <input type="hidden" name="id" value={concept.id} />
          <ConfirmButton message={`Remove “${concept.name}” from the index?`} variant="danger">
            <Trash2 size={16} /> Remove from index
          </ConfirmButton>
        </form>
      </details>
    </>
  );
}
