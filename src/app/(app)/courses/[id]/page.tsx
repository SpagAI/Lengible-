import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Layers, Pencil, TrendingDown, UserRound } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourse, nextExam } from "@/lib/courses";
import { countdownLabel, daysUntil, formatDate } from "@/lib/dates";
import { courseModules } from "@/modules/registry";
import { PageHeader, Card, ButtonLink, colorFor, cx } from "@/components/ui";

export async function generateMetadata({ params }: PageProps<"/courses/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { supabase } = await requireUser();
  const course = await getCourse(supabase, id);
  return { title: course?.name ?? "Course" };
}

export default async function CoursePage({ params }: PageProps<"/courses/[id]">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const course = await getCourse(supabase, id);
  if (!course) notFound();

  const { data: topics } = await supabase.from("topics").select("id, name, parent_id").eq("course_id", id).order("sort_order");
  const exam = nextExam(course.course_exams);
  const courseModule = courseModules[course.kind];
  const color = colorFor(course.color);
  const exams = [...course.course_exams].sort((a, b) => a.exam_date.localeCompare(b.exam_date));

  return (
    <>
      <PageHeader
        title={course.name}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <span className={cx("size-2.5 rounded-full", color.dot)} />
            {[course.code, courseModule.label].filter(Boolean).join(" · ")}
          </span>
        }
        action={
          <ButtonLink href={`/courses/${course.id}/edit`} variant="secondary" aria-label="Edit course">
            <Pencil size={16} /> <span className="hidden sm:inline">Edit</span>
          </ButtonLink>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <CalendarClock size={14} /> Days to exam
          </div>
          <p className="mt-1.5 text-2xl font-semibold">{exam ? countdownLabel(exam.days) : "—"}</p>
          <p className="truncate text-xs text-muted">{exam ? exam.label : "No date set"}</p>
        </Card>
        <Card>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Layers size={14} /> Cards due today
          </div>
          <p className="mt-1.5 text-2xl font-semibold">—</p>
          <p className="text-xs text-muted">Phase 4</p>
        </Card>
        <Card>
          <div className="text-xs text-muted">Progress</div>
          <p className="mt-1.5 text-2xl font-semibold">—</p>
          <p className="text-xs text-muted">From quizzes, Phase 5</p>
        </Card>
        <Card>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <TrendingDown size={14} /> Weak topics
          </div>
          <p className="mt-1.5 text-2xl font-semibold">—</p>
          <p className="text-xs text-muted">From quizzes, Phase 5</p>
        </Card>
      </section>

      {courseModule.features.length > 0 && (
        <section className="mt-6 flex flex-wrap gap-2">
          {courseModule.features.map((f) => (
            <Link key={f.href} href={f.href} className={cx("rounded-full px-3 py-1.5 text-sm font-medium", color.soft)}>
              {f.label}
            </Link>
          ))}
        </section>
      )}

      <section className="mt-6 grid gap-3 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Exams</h2>
          {exams.length ? (
            <ul className="space-y-1.5 text-sm">
              {exams.map((e) => {
                const d = daysUntil(e.exam_date);
                return (
                  <li key={e.id} className={cx("flex justify-between gap-3", d < 0 && "text-muted line-through")}>
                    <span className="min-w-0 truncate">
                      {e.label} · {formatDate(e.exam_date)}
                    </span>
                    <span className="shrink-0 font-medium">{countdownLabel(d)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">No exam dates yet.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Lecturers</h2>
          {course.lecturers.length ? (
            <ul className="space-y-2 text-sm">
              {course.lecturers.map((l) => (
                <li key={l.id} className="flex gap-2">
                  <UserRound size={16} className="mt-0.5 shrink-0 text-muted" />
                  <div>
                    <p className="font-medium">{l.name}</p>
                    {l.notes && <p className="text-muted">{l.notes}</p>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No lecturers yet.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Topics</h2>
          {topics?.length ? (
            <ul className="space-y-1 text-sm">
              {topics.map((t) => (
                <li key={t.id} className={cx(t.parent_id && "pl-4 text-muted")}>
                  {t.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No topics yet.</p>
          )}
          <p className="mt-2 text-xs text-muted">Your full topic list gets imported from the Library in Phase 2.</p>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Notes</h2>
          <p className="text-sm whitespace-pre-wrap text-muted">{course.notes || "No notes yet."}</p>
        </Card>
      </section>
    </>
  );
}
