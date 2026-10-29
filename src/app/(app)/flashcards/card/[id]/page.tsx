import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { stateLabel } from "@/lib/srs";
import { formatDate } from "@/lib/dates";
import { PageHeader, Card } from "@/components/ui";
import { CardForm } from "@/components/flashcards/card-form";
import { CardActions } from "@/components/flashcards/card-actions";

export const metadata: Metadata = { title: "Edit card" };

export default async function EditCardPage({ params, searchParams }: PageProps<"/flashcards/card/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const { data: card } = await supabase.from("cards").select("*").eq("id", id).maybeSingle();
  if (!card) notFound();
  const { data: signed } = card.image_path ? await supabase.storage.from("library").createSignedUrl(card.image_path, 3600) : { data: null };
  const { data: reviews } = await supabase.from("card_reviews").select("rating, review_date").eq("card_id", id).order("created_at", { ascending: false }).limit(10);
  const back = sp.back === "study" ? "/flashcards/study" : `/flashcards/deck/${card.deck_id}`;
  return (
    <div className="mx-auto max-w-2xl">
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-brand">
        <ChevronLeft size={16} /> Back
      </Link>
      <PageHeader title="Edit card" subtitle={card.source === "manual" ? "Your card" : card.source === "drug" ? "Made from your drug database" : "Made from your material"} />
      <Card className="mb-4">
        <CardForm deckId={card.deck_id} initial={{ ...card, image_url: signed?.signedUrl }} doneHref={back} />
      </Card>
      <Card className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted">
          {stateLabel(card.state)} · {card.reps} answers · {card.lapses} forgotten
          {card.state !== 0 && ` · next ${formatDate(card.due.slice(0, 10), { day: "numeric", month: "short", year: "numeric" })}`}
          {reviews?.length ? ` · last answers: ${reviews.map((r) => ["", "Again", "Hard", "Good", "Easy"][r.rating]).join(", ")}` : ""}
        </span>
        <span className="ml-auto">
          <CardActions id={card.id} suspended={card.suspended} deletedHref={back} />
        </span>
      </Card>
    </div>
  );
}
