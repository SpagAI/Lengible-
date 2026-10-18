import { CalendarClock, Layers, ListChecks, Pill } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { getCourses, nextExam } from "@/lib/courses";
import { countdownLabel, formatDate } from "@/lib/dates";
import { Card, EmptyState, ButtonLink } from "@/components/ui";
import { CourseCard } from "@/components/course-card";

function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Lagos" }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function HomePage() {
  const { supabase } = await requireUser();
  const courses = await getCourses(supabase);

  const upcoming = courses
    .flatMap((c) => {
      const e = nextExam(c.course_exams);
      return e ? [{ course: c, exam: e }] : [];
    })
    .sort((a, b) => a.exam.days - b.exam.days);
  const soonest = upcoming[0];

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{greeting()}</h1>
      <p className="mb-5 text-sm text-muted">Here&apos;s your study plan for today.</p>

      <section className="grid gap-3 sm:grid-cols-2">
        <Card className="bg-brand text-on-brand border-transparent">
          <div className="flex items-center gap-2 text-sm opacity-90">
            <CalendarClock size={16} /> Next exam
          </div>
          {soonest ? (
            <>
              <p className="mt-2 text-3xl font-semibold">{countdownLabel(soonest.exam.days)}</p>
              <p className="mt-1 text-sm opacity-90">
                {soonest.course.name} · {soonest.exam.label} · {formatDate(soonest.exam.exam_date)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm opacity-90">
              No exam dates yet.{" "}
              <Link href="/courses" className="underline">
                Add them to a course
              </Link>
              .
            </p>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-2 text-sm text-muted">
            <Layers size={16} /> Today&apos;s flashcards
          </div>
          <p className="mt-2 text-3xl font-semibold">—</p>
          <p className="mt-1 text-sm text-muted">Daily decks start in Phase 4.</p>
        </Card>
      </section>

      {upcoming.length > 1 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-muted">All upcoming exams</h2>
          <Card className="divide-y divide-border p-0">
            {upcoming.map(({ course, exam }) => (
              <div key={exam.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 truncate">
                  {course.name} · {exam.label}
                </span>
                <span className="shrink-0 font-medium">{countdownLabel(exam.days)}</span>
              </div>
            ))}
          </Card>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-muted">Your courses</h2>
        {courses.length ? (
          <div className="space-y-2">
            {courses.map((c) => (
              <CourseCard key={c.id} course={c} />
            ))}
          </div>
        ) : (
          <EmptyState title="No courses yet">
            <ButtonLink href="/courses/new" className="mt-3">
              Add a course
            </ButtonLink>
          </EmptyState>
        )}
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3">
        <ButtonLink href="/quiz" variant="secondary">
          <ListChecks size={18} /> Quiz me
        </ButtonLink>
        <ButtonLink href="/drugs" variant="secondary">
          <Pill size={18} /> Drugs
        </ButtonLink>
      </section>
    </>
  );
}
