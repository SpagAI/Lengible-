import { fsrs, generatorParameters, Rating, State, type Card, type Grade } from "ts-fsrs";
import type { FlashCard } from "@/lib/supabase/types";

// Spaced repetition (FSRS). Used on the server to schedule answers and in the
// browser to show how long each button would push a card back.

export const scheduler = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 365, enable_fuzz: true }));

export const RATINGS = [
  { grade: Rating.Again as Grade, label: "Again", key: "1" },
  { grade: Rating.Hard as Grade, label: "Hard", key: "2" },
  { grade: Rating.Good as Grade, label: "Good", key: "3" },
  { grade: Rating.Easy as Grade, label: "Easy", key: "4" },
] as const;

export type SrsFields = Pick<
  FlashCard,
  "due" | "stability" | "difficulty" | "elapsed_days" | "scheduled_days" | "learning_steps" | "reps" | "lapses" | "state" | "last_review"
>;

export function toFsrs(c: SrsFields): Card {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as State,
    last_review: c.last_review ? new Date(c.last_review) : undefined,
  };
}

export function fromFsrs(c: Card): SrsFields {
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.toISOString() : null,
  };
}

// "1m", "10m", "3d", "2mo" — how long until the card comes back.
export function intervalLabel(from: Date, to: Date) {
  const mins = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d`;
  const months = days / 30;
  return months < 12 ? `${Math.round(months)}mo` : `${(days / 365).toFixed(1)}y`;
}

export function previewIntervals(c: SrsFields, now = new Date()) {
  const preview = scheduler.repeat(toFsrs(c), now);
  return Object.fromEntries(RATINGS.map((r) => [r.grade, intervalLabel(now, preview[r.grade].card.due)])) as Record<Grade, string>;
}

export const stateLabel = (s: number) => ["New", "Learning", "Review", "Relearning"][s] ?? "New";

// Cloze cards: "Caseous necrosis is typical of {{tuberculosis}}" hides the braces on the front.
export const clozeFront = (text: string) => text.replace(/\{\{(.+?)\}\}/g, "[ … ]");
export const clozeAnswers = (text: string) => [...text.matchAll(/\{\{(.+?)\}\}/g)].map((m) => m[1]);
export const clozeFull = (text: string) => text.replace(/\{\{(.+?)\}\}/g, "$1");
