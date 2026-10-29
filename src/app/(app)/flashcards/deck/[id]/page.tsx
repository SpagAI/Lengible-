import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ImageIcon } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourses, leafCourses } from "@/lib/courses";
import { clozeFront, stateLabel } from "@/lib/srs";
import { formatDate } from "@/lib/dates";
import { deleteDeck, renameDeck } from "../../actions";
import { PageHeader, Card, ButtonLink, Button, Field, inputClass, cx } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { CardForm } from "@/components/flashcards/card-form";
import { CardActions } from "@/components/flashcards/card-actions";
import { MaterialCardsButton, RefreshDrugDeckButton } from "@/components/flashcards/deck-buttons";
import type { FlashCard } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Deck" };
// Making more cards from a file or the drug database runs on this page.
export const maxDuration = 300;

const SHOW = 300;

export default async function DeckPage({ params }: PageProps<"/flashcards/deck/[id]">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: deck } = await supabase.from("decks").select("*").eq("id", id).maybeSingle();
  if (!deck) notFound();
  const [{ data: cardRows, count }, courses, { data: file }] = await Promise.all([
    supabase.from("cards").select("*", { count: "exact" }).eq("deck_id", id).order("priority").order("created_at").order("id").limit(SHOW),
    getCourses(supabase),
    deck.file_id ? supabase.from("files").select("id, name").eq("id", deck.file_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const cards = (cardRows ?? []) as FlashCard[];
  const now = new Date().toISOString();
  const active = cards.filter((c) => !c.suspended);
  const due = active.filter((c) => c.state !== 0 && c.due <= now).length;
  const fresh = active.filter((c) => c.state === 0).length;
  const course = courses.find((c) => c.id === deck.course_id);

  return (
    <>
      <Link href="/flashcards" className="mb-1 inline-flex items-center gap-1 text-sm text-brand">
        <ChevronLeft size={16} /> Flashcards
      </Link>
      <PageHeader
        title={deck.name}
        subtitle={`${course ? course.short_name || course.name : "General"} · ${count ?? 0} cards · ${due} due · ${fresh} new`}
        action={
          due + fresh > 0 ? (
            <ButtonLink href={`/flashcards/study?deck=${id}`}>Study this deck</ButtonLink>
          ) : (
            <span className="text-sm text-muted">Nothing due</span>
          )
        }
      />

      {deck.kind === "drugs" && deck.drug_class_id && (
        <Card className="mb-4 flex flex-wrap items-start justify-between gap-3 text-sm">
          <p className="text-muted">
            Made from your drug database.{" "}
            <Link href={`/drugs/class/${deck.drug_class_id}`} className="text-brand underline">
              Open the drug group
            </Link>
            . Edited a drug or added new ones? Update the deck. Your progress and your own edits to cards are kept.
          </p>
          <RefreshDrugDeckButton deckId={id} />
        </Card>
      )}
      {deck.kind === "material" && deck.file_id && (
        <Card className="mb-4 flex flex-wrap items-start justify-between gap-3 text-sm">
          <p className="text-muted">
            Made by AI from{" "}
            {file ? (
              <Link href={`/library/file/${file.id}`} className="text-brand underline">
                {file.name}
              </Link>
            ) : (
              "your file"
            )}{" "}
            (up to page {deck.next_offset}). Check the cards. Edit or delete anything wrong.
          </p>
          <MaterialCardsButton fileId={deck.file_id} label="Make more cards" />
        </Card>
      )}

      <Card className="mb-4">
        <h2 className="mb-3 font-semibold">Add a card</h2>
        <CardForm deckId={id} />
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-muted">
        Cards {count && count > SHOW ? `(first ${SHOW} of ${count})` : ""}
      </h2>
      {cards.length ? (
        <Card className="mb-6 divide-y divide-border p-0">
          {cards.map((c) => (
            <div key={c.id} className={cx("flex items-center gap-2 px-4 py-2.5", c.suspended && "opacity-50")}>
              <Link href={`/flashcards/card/${c.id}`} className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-sm">
                  {c.image_path && <ImageIcon size={14} className="shrink-0 text-brand" />}
                  <span className="truncate">{c.kind === "cloze" ? clozeFront(c.front) : c.front || "(picture card)"}</span>
                </span>
                <span className="block text-xs text-muted">
                  {c.suspended ? "Paused" : stateLabel(c.state)}
                  {c.state !== 0 && !c.suspended && ` · next ${formatDate(c.due.slice(0, 10), { day: "numeric", month: "short" })}`}
                  {c.priority === 0 && c.source === "drug" && " · syllabus"}
                  {c.page ? ` · p.${c.page}` : ""}
                </span>
              </Link>
              <CardActions id={c.id} suspended={c.suspended} />
            </div>
          ))}
        </Card>
      ) : (
        <p className="mb-6 text-sm text-muted">No cards yet. Add one above.</p>
      )}

      <Card className="space-y-3">
        <h2 className="font-semibold">Deck settings</h2>
        <form action={renameDeck} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <Field label="Name">
            <input name="name" defaultValue={deck.name} className={inputClass} />
          </Field>
          <Field label="Course">
            <select name="course_id" defaultValue={deck.course_id ?? ""} className={inputClass}>
              <option value="">General</option>
              {leafCourses(courses).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </form>
        <form action={deleteDeck}>
          <input type="hidden" name="id" value={id} />
          <ConfirmButton variant="danger" message={`Delete "${deck.name}" and all ${count ?? 0} cards in it? Your progress on them is lost.`}>
            Delete deck
          </ConfirmButton>
        </form>
      </Card>
    </>
  );
}
