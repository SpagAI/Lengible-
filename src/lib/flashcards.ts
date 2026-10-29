import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Grade } from "ts-fsrs";
import type { Database, Drug, DrugClass, FlashCard } from "@/lib/supabase/types";
import { addDays, todayISO } from "@/lib/dates";
import { bestStreak, currentStreak } from "@/lib/streak";
import { fromFsrs, scheduler, toFsrs } from "@/lib/srs";
import { syllabusCoverage } from "@/lib/syllabus-coverage";

type DB = SupabaseClient<Database>;

// A day counts toward the flashcard streak after this many answers, or once nothing is left due.
export const DAILY_GOAL = 20;

export async function getNewCardsPerDay(supabase: DB) {
  const { data } = await supabase.from("profiles").select("new_cards_per_day").maybeSingle();
  return data?.new_cards_per_day ?? 20;
}

// New cards already started today (their first answer was today).
async function newStartedToday(supabase: DB) {
  const { count } = await supabase.from("card_reviews").select("id", { count: "exact", head: true }).eq("review_date", todayISO()).eq("state", 0);
  return count ?? 0;
}

export async function getFlashcardStreak(supabase: DB) {
  const { data } = await supabase.from("flashcard_days").select("day, reviews, done").order("day");
  const done = (data ?? []).filter((d) => d.done).map((d) => d.day);
  const today = todayISO();
  return {
    current: currentStreak(done, today),
    best: bestStreak(done),
    doneToday: done.includes(today),
    reviewsToday: (data ?? []).find((d) => d.day === today)?.reviews ?? 0,
  };
}

export type QueueCard = FlashCard & { image_url?: string | null; deck_name?: string };

// Today's study queue: cards due now (oldest first), then new cards up to your daily limit,
// syllabus cards before extras.
export async function getQueue(supabase: DB, deckId?: string) {
  const now = new Date().toISOString();
  const [perDay, started] = await Promise.all([getNewCardsPerDay(supabase), newStartedToday(supabase)]);
  const newLeft = Math.max(0, perDay - started);

  let due = supabase.from("cards").select("*").eq("suspended", false).neq("state", 0).lte("due", now).order("due").limit(300);
  let fresh = supabase.from("cards").select("*").eq("suspended", false).eq("state", 0).order("priority").order("created_at").order("id").limit(newLeft || 1);
  if (deckId) {
    due = due.eq("deck_id", deckId);
    fresh = fresh.eq("deck_id", deckId);
  }
  const [{ data: dueRows }, { data: newRows }] = await Promise.all([due, newLeft ? fresh : Promise.resolve({ data: [] })]);
  const rows = [...(dueRows ?? []), ...(newRows ?? [])] as FlashCard[];
  const deckIds = [...new Set(rows.map((c) => c.deck_id))];
  const { data: decks } = deckIds.length ? await supabase.from("decks").select("id, name").in("id", deckIds) : { data: [] };

  const withImages = rows.filter((c) => c.image_path);
  const { data: signed } = withImages.length
    ? await supabase.storage.from("library").createSignedUrls(withImages.map((c) => c.image_path!), 6 * 3600)
    : { data: [] as { signedUrl: string }[] };
  const cards: QueueCard[] = rows.map((c) => ({
    ...c,
    deck_name: decks?.find((d) => d.id === c.deck_id)?.name,
    image_url: c.image_path ? (signed?.[withImages.findIndex((w) => w.id === c.id)]?.signedUrl ?? null) : null,
  }));
  return { cards, dueCount: dueRows?.length ?? 0, newCount: newRows?.length ?? 0, newLeft };
}

// Schedules one answer and records it. Returns the card's new state.
export async function answerCard(supabase: DB, cardId: string, grade: Grade, durationMs?: number) {
  const { data: card } = await supabase.from("cards").select("*").eq("id", cardId).maybeSingle();
  if (!card) throw new Error("Card not found.");
  const now = new Date();
  const { card: next } = scheduler.next(toFsrs(card), now, grade);
  const fields = fromFsrs(next);
  const today = todayISO(now);

  const [{ error }] = await Promise.all([
    supabase.from("cards").update({ ...fields, updated_at: now.toISOString() }).eq("id", cardId),
    supabase.from("card_reviews").insert({
      card_id: cardId,
      rating: grade,
      state: card.state,
      scheduled_days: next.scheduled_days,
      review_date: today,
      duration_ms: durationMs ? Math.min(Math.round(durationMs), 3_600_000) : null,
    }),
  ]);
  if (error) throw new Error(error.message);

  // Streak: 20 answers today, or nothing left due right now.
  const [{ data: day }, { count: dueLeft }] = await Promise.all([
    supabase.from("flashcard_days").select("reviews, done").eq("day", today).maybeSingle(),
    supabase.from("cards").select("id", { count: "exact", head: true }).eq("suspended", false).neq("state", 0).lte("due", now.toISOString()),
  ]);
  const reviews = (day?.reviews ?? 0) + 1;
  const done = !!day?.done || reviews >= DAILY_GOAL || (dueLeft ?? 0) === 0;
  await supabase.from("flashcard_days").upsert({ day: today, reviews, done });
  return { fields, dayDone: done, reviewsToday: reviews };
}

// ——— Drug decks ———

type DeckRow = Database["public"]["Tables"]["cards"]["Insert"];
const bullets = (items: string[], max = 6) => items.slice(0, max).map((x) => `• ${x}`).join("\n");

function drugCards(d: Drug, groupPath: string, protoName: string | null, base: Omit<DeckRow, "front" | "back" | "source_ref">): DeckRow[] {
  const name = d.name;
  const ref = (k: string) => `drug:${d.id}:${k}`;
  const out: DeckRow[] = [];
  const extra = `Group: ${groupPath}`;
  if (d.mechanism) out.push({ ...base, source_ref: ref("moa"), front: `${name}: mechanism of action?`, back: d.mechanism, extra });
  if (d.indications.length) out.push({ ...base, source_ref: ref("uses"), front: `${name}: main uses?`, back: bullets(d.indications), extra });
  if (d.side_effects.length) out.push({ ...base, source_ref: ref("se"), front: `${name}: important side effects?`, back: bullets(d.side_effects), extra });
  if (d.contraindications.length)
    out.push({ ...base, source_ref: ref("ci"), front: `${name}: contraindications?`, back: bullets(d.contraindications, 5), extra });
  out.push({
    ...base,
    source_ref: ref("group"),
    front: `${name} belongs to which drug group?`,
    back: groupPath + (d.is_prototype ? "\n★ It is the prototype of this group." : protoName ? `\nPrototype: ${protoName}` : ""),
  });
  return out;
}

function classCards(c: DrugClass, protoName: string | null, base: Omit<DeckRow, "front" | "back" | "source_ref">): DeckRow[] {
  const ref = (k: string) => `class:${c.id}:${k}`;
  const out: DeckRow[] = [];
  if (protoName) out.push({ ...base, source_ref: ref("proto"), front: `Prototype drug of ${c.name}?`, back: protoName, extra: c.recognition_tip });
  if (c.recognition_tip) out.push({ ...base, source_ref: ref("spot"), front: `How do you recognise ${c.name} by name?`, back: c.recognition_tip });
  if (c.mnemonic) out.push({ ...base, source_ref: ref("mnemonic"), front: `Memory aid for ${c.name}?`, back: c.mnemonic });
  return out;
}

async function pharmCourseId(supabase: DB) {
  const { data } = await supabase.from("courses").select("id").eq("kind", "pharmacology").eq("is_group", false).order("sort_order").limit(1);
  return data?.[0]?.id ?? null;
}

// Makes (or refreshes) the deck for a drug group and its subgroups. Cards you have edited,
// and your progress on every card, are kept. A card already in another deck stays there.
export async function makeDrugDeck(supabase: DB, classId: string, ctx?: { covered: Record<string, string[]>; courseId: string | null; classes: DrugClass[] }) {
  const classes = ctx?.classes ?? ((await supabase.from("drug_classes").select("*")).data as DrugClass[] | null) ?? [];
  const covered = ctx?.covered ?? (await syllabusCoverage(supabase)).byClass;
  const courseId = ctx ? ctx.courseId : await pharmCourseId(supabase);
  const root = classes.find((c) => c.id === classId);
  if (!root) throw new Error("Drug group not found.");

  const ids = new Set([classId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of classes) {
      if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  const { data: drugRows } = await supabase.from("drugs").select("*").in("class_id", [...ids]).order("is_prototype", { ascending: false }).order("sort_order");
  const drugs = (drugRows ?? []) as Drug[];

  const { data: existingDeck } = await supabase.from("decks").select("id").eq("drug_class_id", classId).maybeSingle();
  let deckId = existingDeck?.id;
  if (!deckId) {
    const { data, error } = await supabase.from("decks").insert({ name: root.name, kind: "drugs", drug_class_id: classId, course_id: courseId }).select("id").single();
    if (error) throw new Error(error.message);
    deckId = data.id;
  }

  const byId = new Map(classes.map((c) => [c.id, c]));
  const pathOf = (id: string) => {
    const names: string[] = [];
    for (let c = byId.get(id); c; c = c.parent_id ? byId.get(c.parent_id) : undefined) names.unshift(c.name);
    return names.join(" › ");
  };
  const rows: DeckRow[] = [];
  for (const cid of ids) {
    const c = byId.get(cid)!;
    const inClass = drugs.filter((d) => d.class_id === cid);
    if (!inClass.length) continue;
    const proto = inClass.find((d) => d.is_prototype)?.name ?? null;
    const base = { deck_id: deckId, course_id: courseId, source: "drug" as const, priority: covered[cid] ? 0 : 1 };
    rows.push(...classCards(c, proto, base));
    for (const d of inClass) rows.push(...drugCards(d, pathOf(cid), proto, { ...base, drug_id: d.id }));
  }
  return { deckId, ...(await saveGenerated(supabase, deckId, rows)) };
}

// Inserts new generated cards and refreshes the wording of existing ones in this deck,
// without touching their schedule. Cards you edited (source "manual") are left alone.
export async function saveGenerated(supabase: DB, deckId: string, rows: DeckRow[]) {
  const refs = rows.map((r) => r.source_ref!);
  const existing = new Map<string, { id: string; deck_id: string; source: string }>();
  for (let i = 0; i < refs.length; i += 100) {
    const { data } = await supabase.from("cards").select("id, deck_id, source, source_ref").in("source_ref", refs.slice(i, i + 100));
    for (const r of data ?? []) existing.set(r.source_ref!, r);
  }
  // Spread creation times a millisecond apart so new cards are studied in the order they were made
  // (group cards first, prototype first).
  const t0 = Date.now();
  const fresh = rows.filter((r) => !existing.has(r.source_ref!)).map((r, i) => ({ ...r, created_at: new Date(t0 + i).toISOString() }));
  const refresh = rows
    .filter((r) => {
      const e = existing.get(r.source_ref!);
      return e && e.deck_id === deckId && e.source !== "manual";
    })
    .map((r) => ({ ...r, id: existing.get(r.source_ref!)!.id, updated_at: new Date().toISOString() }));
  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await supabase.from("cards").insert(fresh.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  for (let i = 0; i < refresh.length; i += 200) {
    const { error } = await supabase.from("cards").upsert(refresh.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  return { added: fresh.length, refreshed: refresh.length, elsewhere: rows.length - fresh.length - refresh.length };
}

// One deck per drug group on your syllabus (the highest covered group, so subgroups share its deck).
export async function makeSyllabusDecks(supabase: DB) {
  const [{ data: classRows }, coverage, courseId] = await Promise.all([
    supabase.from("drug_classes").select("*").order("sort_order"),
    syllabusCoverage(supabase),
    pharmCourseId(supabase),
  ]);
  const classes = (classRows ?? []) as DrugClass[];
  const covered = coverage.byClass;
  const tops = classes.filter((c) => covered[c.id] && !(c.parent_id && covered[c.parent_id]));
  let decks = 0;
  let added = 0;
  for (const c of tops) {
    const r = await makeDrugDeck(supabase, c.id, { covered, courseId, classes });
    decks++;
    added += r.added;
  }
  return { hasTopics: coverage.hasTopics, decks, added };
}

// Answers per day for the last n days (oldest first), for progress charts.
export async function reviewHistory(supabase: DB, days = 14) {
  const from = addDays(todayISO(), -(days - 1));
  const { data } = await supabase.from("flashcard_days").select("day, reviews").gte("day", from);
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i);
    return { day, reviews: data?.find((d) => d.day === day)?.reviews ?? 0 };
  });
}
