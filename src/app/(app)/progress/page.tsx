import type { Metadata } from "next";
import Link from "next/link";
import { Flame, Layers, Target, Trophy, ListChecks } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourses, leafCourses } from "@/lib/courses";
import { getStreak } from "@/lib/progress";
import { getFlashcardStreak, reviewHistory } from "@/lib/flashcards";
import { topicStats } from "@/lib/quiz-engine";
import { addDays, formatDate, todayISO } from "@/lib/dates";
import { PageHeader, Card, colorFor, cx, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Progress" };

export default async function ProgressPage() {
  const { supabase } = await requireUser();
  const monthAgo = addDays(todayISO(), -29);
  const head = { count: "exact", head: true } as const;
  const [courses, streak, { data: attempts }, { data: files }, cardStreak, history, total_, learned, mature, reviewed, recalled, stats] = await Promise.all([
    getCourses(supabase),
    getStreak(supabase),
    supabase.from("attempts").select("course_id, correct, score, created_at").limit(5000),
    supabase.from("files").select("course_id"),
    getFlashcardStreak(supabase),
    reviewHistory(supabase),
    supabase.from("cards").select("id", head).eq("suspended", false),
    supabase.from("cards").select("id", head).eq("suspended", false).neq("state", 0),
    supabase.from("cards").select("id", head).eq("suspended", false).eq("state", 2).gte("scheduled_days", 21),
    // Memory check: answers to cards that were already learned, over the last 30 days.
    supabase.from("card_reviews").select("id", head).eq("state", 2).gte("review_date", monthAgo),
    supabase.from("card_reviews").select("id", head).eq("state", 2).gte("review_date", monthAgo).gt("rating", 1),
    topicStats(supabase),
  ]);
  const cards = { total: total_.count ?? 0, learned: learned.count ?? 0, mature: mature.count ?? 0 };
  const retention = reviewed.count ? Math.round((100 * (recalled.count ?? 0)) / reviewed.count) : null;
  const maxReviews = Math.max(1, ...history.map((h) => h.reviews));
  const all = attempts ?? [];
  const total = all.length;
  const correct = Math.round(all.reduce((t, a) => t + (a.score ?? (a.correct ? 1 : 0)), 0));
  const leaf = leafCourses(courses);

  const perCourse = leaf.map((c) => {
    const mine = all.filter((a) => a.course_id === c.id);
    const right = mine.reduce((t, a) => t + (a.score ?? (a.correct ? 1 : 0)), 0);
    return { c, n: mine.length, pct: mine.length ? Math.round((100 * right) / mine.length) : null, files: (files ?? []).filter((f) => f.course_id === c.id).length };
  });

  // Last 14 days of daily quiz scores.
  const today = todayISO();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const byDay = new Map(streak.history.map((q) => [q.quiz_date, q]));

  return (
    <>
      <PageHeader title="Progress" subtitle="How you're doing across your courses." />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Flame} label="Daily streak" value={`${streak.current}`} sub={streak.doneToday ? "Today's quiz done" : "Do today's quiz to keep it"} accent />
        <Tile icon={Trophy} label="Best streak" value={`${streak.best}`} sub="days in a row" />
        <Tile icon={Target} label="Accuracy" value={total ? `${Math.round((100 * correct) / total)}%` : "—"} sub={`${correct} of ${total} correct`} />
        <Tile icon={ListChecks} label="Quizzes done" value={`${streak.history.filter((q) => q.completed_at).length}`} sub="daily quizzes" />
      </section>

      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Daily quiz, last 14 days</h2>
        <div className="flex h-32 items-end gap-1.5">
          {days.map((d) => {
            const q = byDay.get(d);
            const pct = q?.completed_at && q.question_ids.length ? (100 * (q.score ?? 0)) / q.question_ids.length : 0;
            return (
              <div key={d} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${formatDate(d)}: ${q?.completed_at ? `${q.score}/${q.question_ids.length}` : "no quiz"}`}>
                <span className="text-[10px] text-muted">{q?.completed_at ? q.score : ""}</span>
                <div className={cx("w-full rounded-t-md", q?.completed_at ? "bg-brand" : "bg-surface-2")} style={{ height: `${Math.max(pct, 4)}%` }} />
                <span className="text-[10px] text-muted">{formatDate(d, { day: "numeric" })}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-1.5 font-semibold">
            <Layers size={16} /> Flashcards
          </h2>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn">
            <Flame size={13} /> {cardStreak.current} day streak · best {cardStreak.best}
          </span>
        </div>
        {cards.total === 0 ? (
          <p className="text-sm text-muted">
            No cards yet.{" "}
            <Link href="/flashcards" className="text-brand underline">
              Make your first decks
            </Link>
            .
          </p>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-2xl font-semibold">
                  {cards.learned}
                  <span className="text-sm font-normal text-muted">/{cards.total}</span>
                </p>
                <p className="text-xs text-muted">cards started</p>
              </div>
              <div>
                <p className="text-2xl font-semibold">{cards.mature}</p>
                <p className="text-xs text-muted">well learned (3+ weeks)</p>
              </div>
              <div>
                <p className="text-2xl font-semibold">{retention === null ? "—" : `${retention}%`}</p>
                <p className="text-xs text-muted">remembered (30 days)</p>
              </div>
            </div>
            <div className="flex h-24 items-end gap-1.5">
              {history.map((h) => (
                <div key={h.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${formatDate(h.day)}: ${h.reviews} answers`}>
                  <span className="text-[10px] text-muted">{h.reviews || ""}</span>
                  <div className={cx("w-full rounded-t-md", h.reviews ? "bg-brand" : "bg-surface-2")} style={{ height: `${Math.max((100 * h.reviews) / maxReviews, 4)}%` }} />
                  <span className="text-[10px] text-muted">{formatDate(h.day, { day: "numeric" })}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">Answers per day, last 14 days.</p>
          </>
        )}
      </Card>

      <Card className="mt-4">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="font-semibold">Weak topics</h2>
          <Link href="/quiz?tab=history" className="ml-auto text-xs text-brand underline">
            All results
          </Link>
        </div>
        {stats.weak.length ? (
          <ul className="space-y-2 text-sm">
            {stats.weak.slice(0, 6).map((t) => (
              <li key={`${t.course_id}${t.topic}`} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  {t.topic}
                  <span className="text-xs text-muted"> · {courses.find((c) => c.id === t.course_id)?.short_name ?? "General"}</span>
                </span>
                <span className="font-semibold text-danger">{t.pct}%</span>
                <Link href={`/quiz?tab=build&topic=${encodeURIComponent(t.topic)}${t.course_id ? `&course=${t.course_id}` : ""}`} className="text-xs text-brand underline">
                  Quiz me
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">None yet. Topics you score under 60% on (at least 2 answers) show up here with what to revise.</p>
        )}
      </Card>

      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">By course</h2>
        {total === 0 && <EmptyState title="No answers yet">Do the daily quiz and your accuracy per course appears here.</EmptyState>}
        <ul className="mt-2 space-y-4">
          {perCourse.map(({ c, n, pct, files: f }) => (
            <li key={c.id}>
              <div className="mb-1 flex items-center gap-2 text-sm">
                <span className={cx("size-2.5 rounded-full", colorFor(c.color).dot)} />
                <Link href={`/courses/${c.id}`} className="flex-1 font-medium">
                  {c.name}
                </Link>
                <span className="text-muted">{pct === null ? "—" : `${pct}%`}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                <div className={cx("h-full rounded-full", pct === null ? "" : pct >= 70 ? "bg-ok" : pct >= 50 ? "bg-brand" : "bg-danger")} style={{ width: `${pct ?? 0}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {n} answered · {f} files
                {pct !== null && pct < 50 ? " · needs revision" : ""}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Tile({ icon: Icon, label, value, sub, accent }: { icon: typeof Flame; label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <Card className={cx(accent && "border-transparent bg-gradient-to-br from-nav to-brand text-white")}>
      <div className={cx("flex items-center gap-1.5 text-xs", accent ? "text-white/80" : "text-muted")}>
        <Icon size={14} /> {label}
      </div>
      <p className="mt-1.5 text-3xl font-semibold">{value}</p>
      <p className={cx("truncate text-xs", accent ? "text-white/80" : "text-muted")}>{sub}</p>
    </Card>
  );
}
