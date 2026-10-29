import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { DAILY_GOAL, getQueue } from "@/lib/flashcards";
import { StudySession } from "@/components/flashcards/study-session";

export const metadata: Metadata = { title: "Study" };

export default async function StudyPage({ searchParams }: PageProps<"/flashcards/study">) {
  const sp = await searchParams;
  const deckId = typeof sp.deck === "string" ? sp.deck : undefined;
  const { supabase } = await requireUser();
  const { cards } = await getQueue(supabase, deckId);
  const back = deckId ? `/flashcards/deck/${deckId}` : "/flashcards";
  return (
    <div className="mx-auto max-w-2xl">
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-brand">
        <ChevronLeft size={16} /> {deckId ? "Deck" : "Flashcards"}
      </Link>
      {/* key: switching decks starts a fresh session; refreshes mid-session keep it */}
      <StudySession key={deckId ?? "all"} initial={cards} backHref={back} goal={DAILY_GOAL} />
    </div>
  );
}
