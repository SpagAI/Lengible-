import Link from "next/link";
import { CalendarDays, ChevronRight, Flame, FolderOpen, ListChecks } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { courseTree, getCourses, upcomingExams, examKindLabel } from "@/lib/courses";
import { getStreak } from "@/lib/progress";
import { addDays, countdownLabel, formatDate, todayISO, TIME_ZONE } from "@/lib/dates";
import { Card, EmptyState, ButtonLink, colorFor, cx } from "@/components/ui";
import { CourseList } from "@/components/course-list";
import { ExamList } from "@/components/exam-list";

function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: TIME_ZONE }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function HomePage() {
  const { supabase } = await requireUser();
  const today = todayISO();
  const [courses, streak, { data: sessionsToday }, { data: sessionsTomorrow }, { count: reviewCount }] = await Promise.all([
    getCourses(supabase),
    getStreak(supabase),
    supabase.from("schedule_sessions").select("*").eq("session_date", today).order("start_time"),
    supabase.from("schedule_sessions").select("*").eq("session_date", addDays(today, 1)).order("start_time"),
    supabase.from("files").select("id", { count: "exact", head: true }).filter("analysis->>pendingReview", "eq", "true"),
  ]);
  const byId = Object.fromEntries(courses.map((c) => [c.id, c]));
  const exams = courses.flatMap((c) => c.course_exams);
  const upcoming = upcomingExams(exams).slice(0, 8);
  const unconfirmed = exams.filter((e) => !e.confirmed);
  const showTomorrow = !sessionsToday?.length && !!sessionsTomorrow?.length;
  const sessions = showTomorrow ? sessionsTomorrow! : (sessionsToday ?? []);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{greeting()}</h1>
      <p className="mb-5 text-sm text-muted">{formatDate(today, { weekday: "long", day: "numeric", month: "long" })}</p>

      {/* Countdown to every upcoming exam and EOPT */}
      {upcoming.length > 0 ? (
        <section className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <div className="flex gap-3">
            {upcoming.map((e, i) => {
              const c = byId[e.course_id];
              return (
                <Link
                  key={e.id}
                  href={`/courses/${e.course_id}`}
                  className={cx(
                    "w-44 shrink-0 rounded-2xl p-4",
                    i === 0 ? "bg-gradient-to-br from-nav to-brand text-white" : "border border-border bg-surface",
                  )}
                >
                  <p className={cx("text-xs font-semibold", i === 0 ? "text-white/80" : "text-brand")}>
                    {examKindLabel[e.kind]} · {c?.short_name || c?.name}
                  </p>
                  <p className="mt-1 text-3xl font-semibold">{countdownLabel(e.days)}</p>
                  <p className={cx("mt-1 text-xs", i === 0 ? "text-white/80" : "text-muted")}>
                    {formatDate(e.exam_date, { weekday: "short", day: "numeric", month: "short" })}
                    {e.start_time ? ` · ${e.start_time}` : ""}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      ) : (
        <Card className="mb-4 text-sm text-muted">
          No exam or EOPT dates yet. Upload your timetable in{" "}
          <Link href="/library/course/general" className="text-brand underline">
            Library → General
          </Link>{" "}
          and Lengible will find them, or add them on a course&apos;s Edit page.
        </Card>
      )}

      {unconfirmed.length > 0 && (
        <Card className="mb-4 border-warn/40">
          <p className="mb-2 text-sm font-medium">Dates found in your timetable. Confirm them to start the countdown.</p>
          <ExamList exams={unconfirmed} courseNames={Object.fromEntries(courses.map((c) => [c.id, c.short_name || c.name]))} />
        </Card>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-muted">
            <ListChecks size={16} /> Daily quiz
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn">
              <Flame size={13} /> {streak.current} day streak
            </span>
          </div>
          <p className="font-medium">{streak.doneToday ? "Done for today. Well done!" : "10 questions waiting for you."}</p>
          <ButtonLink href="/quiz" variant={streak.doneToday ? "secondary" : "primary"}>
            {streak.doneToday ? "Review today's answers" : "Start today's quiz"}
          </ButtonLink>
        </Card>

        <Card>
          <div className="mb-2 flex items-center gap-2 text-sm text-muted">
            <CalendarDays size={16} /> {showTomorrow ? "Tomorrow" : "Today"}
          </div>
          {sessions.length ? (
            <ul className="space-y-2 text-sm">
              {sessions.slice(0, 6).map((s) => (
                <li key={s.id} className="flex gap-3">
                  <span className="w-12 shrink-0 text-xs text-muted">{s.start_time ?? ""}</span>
                  <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", colorFor(byId[s.course_id]?.color ?? "blue").dot)} />
                  <span className="min-w-0">
                    <span className="block truncate">{s.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {[byId[s.course_id]?.short_name, s.session_type, s.lecturer].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing scheduled.</p>
          )}
        </Card>
      </section>

      {(reviewCount ?? 0) > 0 && (
        <Link href="/library" className="mt-3 block">
          <Card className="flex items-center gap-3 border-brand/40 hover:bg-surface-2">
            <FolderOpen size={20} className="text-brand" />
            <span className="flex-1 text-sm font-medium">{reviewCount} uploaded file(s) waiting for your review</span>
            <ChevronRight size={18} className="text-muted" />
          </Card>
        </Link>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-muted">Your courses</h2>
        {courses.length ? (
          <CourseList tree={courseTree(courses)} />
        ) : (
          <EmptyState title="No courses yet">
            <ButtonLink href="/courses/new" className="mt-3">
              Add a course
            </ButtonLink>
          </EmptyState>
        )}
      </section>
    </>
  );
}
