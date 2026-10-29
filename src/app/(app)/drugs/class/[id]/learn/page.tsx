import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getClassPath } from "@/lib/drugs";
import { syllabusCoverage } from "@/lib/syllabus-coverage";
import { PageHeader } from "@/components/ui";
import { LearnGroup, type LearnData, type LearnDrug } from "@/components/drugs/learn-group";
import type { Drug, DrugClass } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Learn a group" };

export default async function LearnGroupPage({ params }: PageProps<"/drugs/class/[id]/learn">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const path = await getClassPath(supabase, id);
  const cls = path.at(-1);
  if (!cls || cls.id !== id) notFound();

  const [{ data: classRows }, coverage, { data: decks }] = await Promise.all([
    supabase.from("drug_classes").select("*").order("sort_order"),
    syllabusCoverage(supabase),
    supabase.from("decks").select("id, drug_class_id").in("drug_class_id", path.map((c) => c.id)),
  ]);
  const classes = (classRows ?? []) as DrugClass[];
  const below = (cid: string): string[] => [cid, ...classes.filter((c) => c.parent_id === cid).flatMap((c) => below(c.id))];
  const ids = below(id);
  const { data: drugRows } = await supabase.from("drugs").select("*").in("class_id", ids).order("is_prototype", { ascending: false }).order("sort_order").order("name");
  const drugs = (drugRows ?? []) as Drug[];
  const nameOf = (cid: string) => classes.find((c) => c.id === cid)?.name ?? "";
  const toLearn = (d: Drug): LearnDrug => ({
    id: d.id,
    name: d.name,
    group: nameOf(d.class_id),
    is_prototype: d.is_prototype,
    mechanism: d.mechanism,
    indications: d.indications,
    side_effects: d.side_effects,
    contraindications: d.contraindications,
    brands: d.brands,
    nigerian_context: d.nigerian_context,
  });
  const subs = classes.filter((c) => c.parent_id === id);
  // The group's own prototype; for a parent group, each subgroup's prototype (at most 3).
  const ownProto = drugs.filter((d) => d.class_id === id && d.is_prototype);
  const prototypes = (ownProto.length ? ownProto : drugs.filter((d) => d.is_prototype)).slice(0, 3);
  const deck = [...path].reverse().map((c) => decks?.find((d) => d.drug_class_id === c.id)).find(Boolean);

  const data: LearnData = {
    id,
    name: cls.name,
    system: cls.system,
    path: path.map((c) => c.name).join(" › "),
    description: cls.description,
    tip: cls.recognition_tip,
    mnemonic: cls.mnemonic,
    syllabusTopics: coverage.byClass[id] ?? [],
    subgroups: subs.map((s) => {
      const inSub = drugs.filter((d) => below(s.id).includes(d.class_id));
      return { id: s.id, name: s.name, tip: s.recognition_tip, mnemonic: s.mnemonic, prototype: inSub.find((d) => d.is_prototype)?.name ?? null, count: inSub.length };
    }),
    prototypes: prototypes.map(toLearn),
    others: drugs.filter((d) => !prototypes.some((p) => p.id === d.id)).map(toLearn),
    deckId: deck?.id ?? null,
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/drugs/class/${id}`} className="mb-2 inline-flex items-center gap-1 text-sm text-brand">
        <ChevronLeft size={16} /> {cls.name}
      </Link>
      <PageHeader title={`Learn: ${cls.name}`} />
      <LearnGroup data={data} />
    </div>
  );
}
