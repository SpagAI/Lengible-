import type { Metadata } from "next";
import Link from "next/link";
import { Flame, Target, Trophy, ListChecks } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourses, leafCourses } from "@/lib/courses";
import { getStreak } from "@/lib/progress";
import { addDays, formatDate, todayISO } from "@/lib/dates";
import { PageHeader, Card, colorFor, cx, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Progress" };

export default async function ProgressPage() {
  const { supabase } = await requireUser();
  const [courses, streak, { data: attempts }, { data: files }] = await Promise.all([
    getCourses(supabase),
    getStreak(supabase),
    supabase.from("attempts").select("course_id, correct, created_at"),
    supabase.from("files").select("course_id"),
  ]);
  const all = attempts ?? [];
  const total = all.length;
  const correct = all.filter((a) => a.correct).length;
  const leaf = leafCourses(courses);

  const perCourse = leaf.map((c) => {
    const mine = all.filter((a) => a.course_id === c.id);
    const right = mine.filter((a) => a.correct).length;
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
        <h2 className="mb-3 font-semibold">Last 14 days</h2>
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
