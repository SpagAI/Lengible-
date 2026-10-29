import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileText, Flame, Pill, Plus, Settings2, SquarePen } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourses, leafCourses } from "@/lib/courses";
import { isMissingTable } from "@/lib/drugs";
import { DAILY_GOAL, getFlashcardStreak, getNewCardsPerDay } from "@/lib/flashcards";
import { todayISO } from "@/lib/dates";
import { createDeck, setNewPerDay } from "./actions";
import { PageHeader, Card, ButtonLink, Button, Field, inputClass, cx } from "@/components/ui";
import { SyllabusDecksButton } from "@/components/flashcards/deck-buttons";
import type { Deck, DeckCount } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Flashcards" };
// Making syllabus decks (a server action on this page) can take a while.
export const maxDuration = 300;

const kindIcon = { drugs: Pill, material: FileText, custom: SquarePen };

export default async function FlashcardsPage() {
  const { supabase } = await requireUser();
  const [{ data: decks, error }, { data: counts }, courses, streak, perDay, { count: startedToday }] = await Promise.all([
    supabase.from("decks").select("*").order("created_at"),
    supabase.rpc("deck_counts"),
    getCourses(supabase),
    getFlashcardStreak(supabase),
    getNewCardsPerDay(supabase),
    supabase.from("card_reviews").select("id", { count: "exact", head: true }).eq("review_date", todayISO()).eq("state", 0),
  ]);

  if (isMissingTable(error)) {
    return (
      <>
        <PageHeader title="Flashcards" />
        <Card className="space-y-3 text-sm">
          <p className="font-medium">One setup step: add the flashcard tables to your Supabase</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Open your project at supabase.com → <b>SQL Editor</b> → <b>New query</b>.
            </li>
            <li>
              Open <b>supabase/migrations/0004_flashcards.sql</b> in your Lengible GitHub repo, tap <b>Raw</b>, copy everything, paste it in and
              click <b>Run</b>.
            </li>
            <li>Come back here and refresh.</li>
          </ol>
        </Card>
      </>
    );
  }

  const byDeck = new Map(((counts ?? []) as DeckCount[]).map((c) => [c.deck_id, c]));
  const list = (decks ?? []) as Deck[];
  const due = list.reduce((n, d) => n + Number(byDeck.get(d.id)?.due_now ?? 0), 0);
  const newTotal = list.reduce((n, d) => n + Number(byDeck.get(d.id)?.new_count ?? 0), 0);
  const newToday = Math.min(newTotal, Math.max(0, perDay - (startedToday ?? 0)));
  const courseName = (id: string | null) => {
    const c = courses.find((x) => x.id === id);
    return c ? c.short_name || c.name : "General";
  };
  const groups = new Map<string, Deck[]>();
  for (const d of list) groups.set(courseName(d.course_id), [...(groups.get(courseName(d.course_id)) ?? []), d]);

  return (
    <>
      <PageHeader
        title="Flashcards"
        subtitle={
          <span className="inline-flex items-center gap-1">
            <Flame size={14} className="text-warn" /> {streak.current} day streak · best {streak.best}
          </span>
        }
      />

      <Card className="mb-5 flex flex-wrap items-center gap-4 bg-gradient-to-br from-nav to-brand text-white">
        <div className="flex gap-6">
          <div>
            <p className="text-3xl font-semibold">{due}</p>
            <p className="text-xs text-white/80">due now</p>
          </div>
          <div>
            <p className="text-3xl font-semibold">{newToday}</p>
            <p className="text-xs text-white/80">new today</p>
          </div>
          <div>
            <p className="text-3xl font-semibold">{streak.reviewsToday}</p>
            <p className="text-xs text-white/80">answered today</p>
          </div>
        </div>
        <div className="ml-auto flex flex-col items-end gap-1">
          {due + newToday > 0 ? (
            <ButtonLink href="/flashcards/study" className="bg-white text-[#1238a8] hover:bg-white/90">
              Study now
            </ButtonLink>
          ) : (
            <span className="text-sm font-medium">{list.length ? "All caught up 🎉" : ""}</span>
          )}
          <span className="text-xs text-white/80">
            {streak.doneToday ? "Today counts toward your streak" : `${DAILY_GOAL} answers (or clearing what's due) keeps the streak`}
          </span>
        </div>
      </Card>

      {list.length === 0 ? (
        <Card className="mb-5 space-y-3">
          <p className="font-medium">Start with your Pharmacology syllabus</p>
          <p className="text-sm text-muted">
            Lengible makes cards from your drug database (mechanism, uses, side effects, contraindications, group and prototype), one deck per
            syllabus group. New cards from your syllabus come first. You can also make cards from any uploaded file (open it in the Library → Make
            flashcards), from any drug group page, or write your own.
          </p>
          <SyllabusDecksButton variant="primary" />
        </Card>
      ) : (
        [...groups.entries()].map(([course, ds]) => (
          <section key={course} className="mb-5">
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">{course}</h2>
            <Card className="divide-y divide-border p-0">
              {ds.map((d) => {
                const c = byDeck.get(d.id);
                const Icon = kindIcon[d.kind];
                return (
                  <Link key={d.id} href={`/flashcards/deck/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <Icon size={18} className="shrink-0 text-brand" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block leading-snug font-medium">{d.name}</span>
                      <span className="block text-xs text-muted">{Number(c?.total ?? 0)} cards</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1 text-xs font-semibold sm:flex-row">
                      <span className={cx("rounded-full px-2 py-0.5", Number(c?.due_now) ? "bg-warn/15 text-warn" : "bg-surface-2 text-muted")}>
                        {Number(c?.due_now ?? 0)} due
                      </span>
                      <span className={cx("rounded-full px-2 py-0.5", Number(c?.new_count) ? "bg-brand-soft text-brand-strong" : "bg-surface-2 text-muted")}>
                        {Number(c?.new_count ?? 0)} new
                      </span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-muted" />
                  </Link>
                );
              })}
            </Card>
          </section>
        ))
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-1.5 font-semibold">
            <Plus size={16} /> New deck of your own
          </h2>
          <form action={createDeck} className="space-y-3">
            <Field label="Name">
              <input name="name" required placeholder="e.g. Histo slides, Haem numbers" className={inputClass} />
            </Field>
            <Field label="Course">
              <select name="course_id" className={inputClass} defaultValue="">
                <option value="">General</option>
                {leafCourses(courses).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" variant="secondary">
              Create deck
            </Button>
          </form>
        </Card>
        <Card className="space-y-4">
          <div>
            <h2 className="mb-3 flex items-center gap-1.5 font-semibold">
              <Settings2 size={16} /> Settings
            </h2>
            <form action={setNewPerDay}>
              <label htmlFor="new-per-day" className="mb-1.5 block text-sm font-medium">
                New cards per day
              </label>
              <div className="flex gap-2">
                <input id="new-per-day" name="n" type="number" min={0} max={200} defaultValue={perDay} className={cx(inputClass, "w-28")} />
                <Button type="submit" variant="secondary">
                  Save
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted">Reviews of cards you&apos;ve already seen are never limited.</p>
            </form>
          </div>
          {list.length > 0 && (
            <div>
              <p className="mb-2 text-sm text-muted">Imported new Pharmacology topics, or loaded new drugs? Update your syllabus decks:</p>
              <SyllabusDecksButton />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
