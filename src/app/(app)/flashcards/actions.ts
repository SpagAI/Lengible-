"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Grade } from "ts-fsrs";
import { requireUser } from "@/lib/supabase/server";
import { answerCard, makeDrugDeck, makeSyllabusDecks } from "@/lib/flashcards";
import { isMissingTable } from "@/lib/drugs";
import type { CardKind } from "@/lib/supabase/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const SETUP_MESSAGE = "The flashcard tables aren't in your Supabase yet. Run supabase/migrations/0004_flashcards.sql in the Supabase SQL Editor, then try again.";
const errorText = (e: unknown) => {
  const message = (e as { message?: string } | null)?.message ?? "";
  return isMissingTable({ message }) ? SETUP_MESSAGE : message || "Something went wrong.";
};

export async function answer(cardId: string, grade: Grade, durationMs?: number) {
  const { supabase } = await requireUser();
  try {
    return await answerCard(supabase, cardId, grade, durationMs);
  } catch (e) {
    return { error: errorText(e) };
  }
}

// Called when a study session ends, so the overview shows fresh counts.
export async function finishSession() {
  revalidatePath("/flashcards", "layout");
  revalidatePath("/");
}

export async function createSyllabusDecks() {
  const { supabase } = await requireUser();
  try {
    const r = await makeSyllabusDecks(supabase);
    revalidatePath("/flashcards", "layout");
    if (!r.hasTopics) return { error: "No Pharmacology topics yet. Import your topic list or timetable in Library → General first." };
    return { message: `${r.decks} decks ready · ${r.added} new cards.` };
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function createDrugDeck(classId: string) {
  const { supabase } = await requireUser();
  let deckId: string;
  try {
    deckId = (await makeDrugDeck(supabase, classId)).deckId;
  } catch (e) {
    return { error: errorText(e) };
  }
  revalidatePath("/flashcards", "layout");
  redirect(`/flashcards/deck/${deckId}`);
}

export async function refreshDrugDeck(deckId: string) {
  const { supabase } = await requireUser();
  const { data: deck } = await supabase.from("decks").select("drug_class_id").eq("id", deckId).maybeSingle();
  if (!deck?.drug_class_id) return { error: "This deck isn't linked to a drug group." };
  try {
    const r = await makeDrugDeck(supabase, deck.drug_class_id);
    revalidatePath("/flashcards", "layout");
    return { message: `${r.added} new cards, ${r.refreshed} updated from your drug database.` };
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function createDeck(fd: FormData) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("decks")
    .insert({ name: str(fd, "name") || "My cards", kind: "custom", course_id: str(fd, "course_id") || null })
    .select("id")
    .single();
  if (error) throw new Error(errorText(error));
  revalidatePath("/flashcards", "layout");
  redirect(`/flashcards/deck/${data.id}`);
}

export async function renameDeck(fd: FormData) {
  const { supabase } = await requireUser();
  const id = str(fd, "id");
  await supabase.from("decks").update({ name: str(fd, "name") || "My cards", course_id: str(fd, "course_id") || null }).eq("id", id);
  revalidatePath("/flashcards", "layout");
}

export async function deleteDeck(fd: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("decks").delete().eq("id", str(fd, "id"));
  revalidatePath("/flashcards", "layout");
  redirect("/flashcards");
}

const kinds: CardKind[] = ["basic", "cloze", "image"];

// Adding or editing a card by hand. Editing a generated card makes it yours,
// so remaking the deck won't overwrite your wording.
export async function saveCard(fd: FormData) {
  const { supabase } = await requireUser();
  const id = str(fd, "id");
  const deckId = str(fd, "deck_id");
  const kindValue = str(fd, "kind") as CardKind;
  const kind = kinds.includes(kindValue) ? kindValue : "basic";
  const imagePath = str(fd, "image_path") || null;
  const fields = {
    kind: imagePath && kind === "basic" ? ("image" as const) : kind,
    front: str(fd, "front"),
    back: str(fd, "back"),
    extra: str(fd, "extra") || null,
    image_path: imagePath,
  };
  if (!fields.front && !fields.image_path) return { error: "Write something on the front, or add a picture." };
  if (fields.kind === "cloze" && !/\{\{.+?\}\}/.test(fields.front)) return { error: "For a fill-in card, wrap the hidden word in double braces: {{word}}." };
  if (id) {
    const { error } = await supabase.from("cards").update({ ...fields, source: "manual", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return { error: errorText(error) };
  } else {
    const { data: deck } = await supabase.from("decks").select("course_id").eq("id", deckId).maybeSingle();
    const { error } = await supabase.from("cards").insert({ ...fields, deck_id: deckId, course_id: deck?.course_id ?? null, source: "manual", priority: 0 });
    if (error) return { error: errorText(error) };
  }
  revalidatePath("/flashcards", "layout");
  return { ok: true };
}

export async function deleteCard(id: string) {
  const { supabase } = await requireUser();
  await supabase.from("cards").delete().eq("id", id);
  revalidatePath("/flashcards", "layout");
}

export async function setSuspended(id: string, suspended: boolean) {
  const { supabase } = await requireUser();
  await supabase.from("cards").update({ suspended }).eq("id", id);
  revalidatePath("/flashcards", "layout");
}

// Start a card again as if new (keeps its review history).
export async function resetCard(id: string) {
  const { supabase } = await requireUser();
  await supabase
    .from("cards")
    .update({ state: 0, due: new Date().toISOString(), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, last_review: null })
    .eq("id", id);
  revalidatePath("/flashcards", "layout");
}

export async function setNewPerDay(fd: FormData) {
  const { supabase, user } = await requireUser();
  const n = Math.max(0, Math.min(200, Math.round(Number(str(fd, "n")) || 0)));
  await supabase.from("profiles").update({ new_cards_per_day: n }).eq("id", user.id);
  revalidatePath("/flashcards", "layout");
}
