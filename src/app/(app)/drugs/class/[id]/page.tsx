import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Lightbulb, Plus, Star, BadgeCheck } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getClassPath } from "@/lib/drugs";
import { syllabusCoverage } from "@/lib/syllabus-coverage";
import { SyllabusNote } from "@/components/drugs/syllabus-note";
import { DrugDeckButton } from "@/components/flashcards/deck-buttons";
import { saveClass } from "../../actions";
import { PageHeader, Card, Field, Button, ButtonLink, inputClass, cx } from "@/components/ui";
import type { Drug, DrugClass } from "@/lib/supabase/types";

export async function generateMetadata({ params }: PageProps<"/drugs/class/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data } = await supabase.from("drug_classes").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Drug group" };
}

// Making a flashcard deck (a server action on this page) can take a while.
export const maxDuration = 300;

export default async function DrugClassPage({ params }: PageProps<"/drugs/class/[id]">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const path = await getClassPath(supabase, id);
  const cls = path.at(-1);
  if (!cls || cls.id !== id) notFound();
  const [{ data: subclasses }, { data: drugs }, coverage, { data: decks }] = await Promise.all([
    supabase.from("drug_classes").select("*").eq("parent_id", id).order("sort_order"),
    supabase.from("drugs").select("*").eq("class_id", id).order("is_prototype", { ascending: false }).order("sort_order").order("name"),
    syllabusCoverage(supabase),
    // This group's deck, or the deck of a parent group that already holds its cards.
    supabase.from("decks").select("id, name, drug_class_id").in("drug_class_id", path.map((c) => c.id)),
  ]);
  const subs = (subclasses ?? []) as DrugClass[];
  const deck = [...path].reverse().map((c) => decks?.find((d) => d.drug_class_id === c.id)).find(Boolean);
  const { data: subDrugs } = subs.length
    ? await supabase.from("drugs").select("id, name, class_id, is_prototype, verified").in("class_id", subs.map((s) => s.id)).order("is_prototype", { ascending: false }).order("name")
    : { data: [] as Pick<Drug, "id" | "name" | "class_id" | "is_prototype" | "verified">[] };
  const list = (drugs ?? []) as Drug[];
  const ids = [...list.map((d) => d.id), ...(subDrugs ?? []).map((d) => d.id)].slice(0, 4);

  return (
    <>
      <nav className="mb-1 flex flex-wrap items-center gap-1 text-sm text-brand">
        <Link href="/drugs">Drugs</Link>
        {path.slice(0, -1).map((c) => (
          <span key={c.id} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-muted" />
            <Link href={`/drugs/class/${c.id}`}>{c.name}</Link>
          </span>
        ))}
      </nav>
      <PageHeader
        title={cls.name}
        subtitle={cls.system}
        action={
          <ButtonLink href={`/drugs/new?class=${id}`} variant="secondary" aria-label="Add drug to this group">
            <Plus size={16} /> <span className="hidden sm:inline">Add drug</span>
          </ButtonLink>
        }
      />
      {coverage.hasTopics && <SyllabusNote topics={coverage.byClass[id] ?? []} what="group" partly={subs.some((k) => coverage.byClass[k.id])} />}
      {cls.description && <p className="mb-4 text-sm leading-relaxed">{cls.description}</p>}

      {(cls.recognition_tip || cls.mnemonic) && (
        <Card className="mb-4 space-y-2 bg-brand-soft/40 text-sm">
          <h2 className="flex items-center gap-1.5 font-semibold text-brand-strong">
            <Lightbulb size={15} /> Remember it
          </h2>
          {cls.recognition_tip && (
            <p>
              <b>Spot it:</b> {cls.recognition_tip}
            </p>
          )}
          {cls.mnemonic && (
            <p>
              <b>Memory aid:</b> {cls.mnemonic}
            </p>
          )}
        </Card>
      )}

      {list.length > 0 && (
        <Card className="mb-4 divide-y divide-border p-0">
          {list.map((d) => (
            <Link key={d.id} href={`/drugs/${d.id}`} className="block px-4 py-3 hover:bg-surface-2">
              <span className="flex items-center gap-1.5 font-medium">
                {d.is_prototype && <Star size={14} className="fill-current text-brand" />}
                {d.name}
                {d.verified && <BadgeCheck size={14} className="text-ok" />}
                {d.is_prototype && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] text-brand-strong">Prototype</span>}
              </span>
              {d.mechanism && <span className="line-clamp-2 text-sm text-muted">{d.mechanism}</span>}
            </Link>
          ))}
        </Card>
      )}

      {subs.map((s) => (
        <Card key={s.id} className="mb-3">
          <Link href={`/drugs/class/${s.id}`} className="font-semibold text-brand">
            {s.name} →
          </Link>
          {s.description && <p className="mt-1 text-sm text-muted">{s.description}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(subDrugs ?? [])
              .filter((d) => d.class_id === s.id)
              .map((d) => (
                <Link
                  key={d.id}
                  href={`/drugs/${d.id}`}
                  className={cx("rounded-full border px-3 py-1 text-sm", d.is_prototype ? "border-brand bg-brand-soft text-brand-strong" : "border-border")}
                >
                  {d.is_prototype ? "★ " : ""}
                  {d.name}
                </Link>
              ))}
          </div>
        </Card>
      ))}

      <div className="mb-4 flex flex-wrap items-start gap-2">
        <ButtonLink href={`/drugs/class/${id}/learn`}>Learn this group</ButtonLink>
        <ButtonLink href={`/quiz?tab=drugs`} variant="secondary">
          Drug quizzes
        </ButtonLink>
        {ids.length > 1 && (
          <ButtonLink href={`/drugs/compare?ids=${ids.join(",")}`} variant="secondary">
            Compare drugs in this group
          </ButtonLink>
        )}
        {deck ? (
          <ButtonLink href={`/flashcards/deck/${deck.id}`} variant="secondary">
            {deck.drug_class_id === id ? "Flashcards for this group" : `Flashcards (in “${deck.name}”)`}
          </ButtonLink>
        ) : (
          <DrugDeckButton classId={id} />
        )}
      </div>

      <details className="mt-2 rounded-2xl border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">Edit this group (name, description, memory aid)</summary>
        <form action={saveClass} className="mt-4 space-y-4">
          <input type="hidden" name="id" value={cls.id} />
          <Field label="Name">
            <input name="name" defaultValue={cls.name} required className={inputClass} />
          </Field>
          <Field label="Description">
            <textarea name="description" rows={3} defaultValue={cls.description ?? ""} className={cx(inputClass, "py-2")} />
          </Field>
          <Field label="How to recognise the class">
            <input name="recognition_tip" defaultValue={cls.recognition_tip ?? ""} className={inputClass} />
          </Field>
          <Field label="Mnemonic / memory aid">
            <textarea name="mnemonic" rows={3} defaultValue={cls.mnemonic ?? ""} className={cx(inputClass, "py-2")} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="verified" defaultChecked={cls.verified} className="size-4 accent-[var(--brand)]" /> I have verified this group
          </label>
          <Button type="submit">Save</Button>
        </form>
      </details>
    </>
  );
}
