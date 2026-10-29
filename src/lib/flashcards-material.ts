import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LibraryFile } from "@/lib/supabase/types";
import { AIError, generateJSON } from "@/lib/ai";
import { saveGenerated } from "@/lib/flashcards";

type DB = SupabaseClient<Database>;

// About this much text per AI call; each call makes up to CARDS_PER_STEP cards.
const STEP_CHARS = 14_000;
const CARDS_PER_STEP = 15;

const schema = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["basic", "cloze"] },
          front: { type: "string" },
          back: { type: "string" },
          page: { type: "integer" },
        },
        required: ["kind", "front", "back", "page"],
      },
    },
  },
  required: ["cards"],
};

type AICard = { kind: "basic" | "cloze"; front: string; back: string; page: number };

export type MaterialResult = { status: "done" | "more" | "rate_limited" | "error"; message: string; added?: number; deckId?: string };

// Makes the next batch of cards from a file, continuing where the last batch stopped.
export async function makeMaterialCards(supabase: DB, file: LibraryFile): Promise<MaterialResult> {
  const { data: existing } = await supabase.from("decks").select("id, next_offset").eq("file_id", file.id).maybeSingle();
  let deck = existing;
  if (!deck) {
    const { data, error } = await supabase
      .from("decks")
      .insert({ name: file.name.replace(/\.[a-z0-9]+$/i, ""), kind: "material", file_id: file.id, course_id: file.course_id })
      .select("id, next_offset")
      .single();
    if (error) return { status: "error", message: error.message };
    deck = data;
  }

  // next_offset is the last page already turned into cards.
  const { data: chunks } = await supabase.from("chunks").select("page, content").eq("file_id", file.id).gt("page", deck.next_offset).order("page").limit(60);
  if (!chunks?.length) {
    return deck.next_offset
      ? { status: "done", message: "Every page of this file already has cards.", deckId: deck.id, added: 0 }
      : { status: "error", message: "This file has no text yet. Use “Read with AI” on the file first, then make cards." };
  }
  let text = "";
  let lastPage = deck.next_offset;
  for (const c of chunks) {
    if (text && text.length + c.content.length > STEP_CHARS) break;
    text += `\n[Page ${c.page}]\n${c.content.slice(0, STEP_CHARS)}`;
    lastPage = c.page;
  }

  let result: { cards: AICard[] };
  try {
    result = await generateJSON<{ cards: AICard[] }>(
      `Make up to ${CARDS_PER_STEP} high-yield flashcards for a Nigerian medical student from the study material below (file: "${file.name}").
Rules:
- Use only facts stated in the material. Do not add outside knowledge.
- One fact per card. Focus on what exams ask: definitions, causes, mechanisms, key features, investigations, treatment, drug facts, classic numbers.
- "basic": front is a short question; back is a short answer (bullets "• " allowed, at most 5).
- "cloze": front is one sentence with the key term wrapped in double braces, e.g. "Caseous necrosis is typical of {{tuberculosis}}"; back repeats the hidden term(s).
- Mix both kinds. Skip headings, lecturer names, dates and timetable details.
- "page" is the [Page N] the fact came from.

MATERIAL:
${text}`,
      schema,
      { temperature: 0.3, maxOutputTokens: 6000 },
    );
  } catch (e) {
    if (e instanceof AIError) {
      if (e.kind === "rate_limit" || e.kind === "busy") return { status: "rate_limited", message: e.message, deckId: deck.id };
      return { status: "error", message: e.message, deckId: deck.id };
    }
    return { status: "error", message: "Something went wrong while making cards.", deckId: deck.id };
  }

  const rows = (result.cards ?? [])
    .filter((c) => c.front?.trim() && (c.kind === "cloze" ? /\{\{.+?\}\}/.test(c.front) : c.back?.trim()))
    .map((c) => ({
      deck_id: deck.id,
      course_id: file.course_id,
      kind: c.kind,
      front: c.front.trim(),
      back: c.back.trim(),
      source: "material" as const,
      source_ref: `file:${file.id}:${createHash("sha1").update(c.front.trim().toLowerCase()).digest("hex").slice(0, 16)}`,
      file_id: file.id,
      page: c.page || null,
      priority: 0,
    }));
  const saved = await saveGenerated(supabase, deck.id, rows);
  await supabase.from("decks").update({ next_offset: lastPage }).eq("id", deck.id);

  const { count: remaining } = await supabase.from("chunks").select("id", { count: "exact", head: true }).eq("file_id", file.id).gt("page", lastPage);
  return {
    status: remaining ? "more" : "done",
    message: `${saved.added} cards made from pages ${chunks[0].page}–${lastPage}.${remaining ? " Tap again for the next pages." : " That was the last page."}`,
    added: saved.added,
    deckId: deck.id,
  };
}
