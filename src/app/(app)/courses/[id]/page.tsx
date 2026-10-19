import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, FolderOpen, Pencil, Target, UserRound, FileText } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourse, getCourses, nextExam, examKindLabel } from "@/lib/courses";
import { countdownLabel, formatDate, todayISO, addDays } from "@/lib/dates";
import { BUILT_PHASE, courseModules } from "@/modules/registry";
import { PageHeader, Card, ButtonLink, colorFor, cx } from "@/components/ui";
import { CourseCard } from "@/components/course-card";
import { ExamList } from "@/components/exam-list";
import type { Topic } from "@/lib/supabase/types";

export async function generateMetadata({ params }: PageProps<"/courses/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { supabase } = await requireUser();
  const course = await getCourse(supabase, id);
  return { title: course?.name ?? "Course" };
}

const typeLabels: Record<string, string> = { lecture: "Lectures", tutorial: "Tutorials", practical: "Practicals", other: "Other", section: "Sections" };

export default async function CoursePage({ params }: PageProps<"/courses/[id]">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const course = await getCourse(supabase, id);
  if (!course) notFound();

  const all = await getCourses(supabase);
  const children = all.filter((c) => c.parent_id === course.id);
  const parent = all.find((c) => c.id === course.parent_id);
  const ids = [course.id, ...children.map((c) => c.id)];
  const names = Object.fromEntries(all.map((c) => [c.id, c.short_name || c.name]));

  const today = todayISO();
  const [{ data: topics }, { data: lecturers }, { count: fileCount }, { data: attempts }, { data: sessions }] = await Promise.all([
    supabase.from("topics").select("*").in("course_id", ids).order("sort_order").order("name"),
    supabase.from("lecturers").select("id, name").in("course_id", ids),
    supabase.from("files").select("id", { count: "exact", head: true }).in("course_id", ids),
    supabase.from("attempts").select("correct").in("course_id", ids),
    supabase
      .from("schedule_sessions")
      .select("*")
      .in("course_id", ids)
      .gte("session_date", today)
      .lte("session_date", addDays(today, 6))
      .order("session_date")
      .order("start_time"),
  ]);

  const exams = [...course.course_exams, ...children.flatMap((c) => c.course_exams)];
  const exam = nextExam(exams);
  const answered = attempts?.length ?? 0;
  const accuracy = answered ? Math.round((100 * (attempts ?? []).filter((a) => a.correct).length) / answered) : null;
  const courseModule = courseModules[course.kind];
  const color = colorFor(course.color);
  const lecturerName = Object.fromEntries((lecturers ?? []).map((l) => [l.id, l.name]));
  const byType = new Map<string, Topic[]>();
  for (const t of (topics ?? []) as Topic[]) byType.set(t.session_type, [...(byType.get(t.session_type) ?? []), t]);

  return (
    <>
      {parent && (
        <Link href={`/courses/${parent.id}`} className="mb-1 inline-block text-sm text-brand">
          ← {parent.name}
        </Link>
      )}
      <PageHeader
        title={course.name}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <span className={cx("size-2.5 rounded-full", color.dot)} />
            {[course.code, course.is_group ? `${children.length} courses` : courseModule.label].filter(Boolean).join(" · ")}
          </span>
        }
        action={
          <ButtonLink href={`/courses/${course.id}/edit`} variant="secondary" aria-label="Edit course">
            <Pencil size={16} /> <span className="hidden sm:inline">Edit</span>
          </ButtonLink>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={CalendarClock} label="Next exam / EOPT" value={exam ? countdownLabel(exam.days) : "—"} sub={exam ? `${examKindLabel[exam.kind]} · ${names[exam.course_id]}` : "None set"} />
        <Stat icon={Target} label="Quiz accuracy" value={accuracy === null ? "—" : `${accuracy}%`} sub={`${answered} answered`} />
        <Stat icon={FileText} label="Materials" value={String(fileCount ?? 0)} sub="files in Library" />
        <Stat icon={FolderOpen} label="Topics" value={String(topics?.length ?? 0)} sub="from your topic list" />
      </section>

      <section className="mt-4 flex flex-wrap gap-2">
        <ButtonLink href={`/library/course/${course.id}`} variant="secondary">
          <FolderOpen size={16} /> Open in Library
        </ButtonLink>
        {courseModule.features.map((f) =>
          f.phase <= BUILT_PHASE ? (
            <Link key={f.href} href={f.href} className={cx("inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium", color.soft)}>
              {f.label}
            </Link>
          ) : (
            <span key={f.href} className="inline-flex min-h-11 items-center rounded-xl bg-surface-2 px-4 text-sm text-muted">
              {f.label} · coming soon
            </span>
          ),
        )}
      </section>

      {children.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-muted">Courses in {course.name}</h2>
          <div className="space-y-2">
            {children.map((k) => (
              <CourseCard key={k.id} course={k} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 grid gap-3 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Exams & EOPTs</h2>
          <ExamList exams={exams} courseNames={children.length ? names : undefined} />
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Next 7 days</h2>
          {sessions?.length ? (
            <ul className="space-y-2 text-sm">
              {sessions.map((s) => (
                <li key={s.id} className="flex gap-3">
                  <span className="w-20 shrink-0 text-xs text-muted">
                    {formatDate(s.session_date, { weekday: "short", day: "numeric", month: "short" })}
                    <br />
                    {s.start_time}
                  </span>
                  <span className="min-w-0">
                    <span className="block">{s.title}</span>
                    <span className="block text-xs text-muted">
                      {[children.length ? names[s.course_id] : null, s.session_type, s.lecturer].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing scheduled. Upload your timetable in the Library to fill this in.</p>
          )}
        </Card>

        <Card className="md:col-span-2">
          <h2 className="mb-2 font-semibold">Topics</h2>
          {byType.size ? (
            <div className="space-y-2">
              {["lecture", "tutorial", "practical", "other", "section"]
                .filter((t) => byType.has(t))
                .map((t) => (
                  <details key={t} open={t === "lecture"} className="rounded-xl bg-surface-2 px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium">
                      {typeLabels[t]} ({byType.get(t)!.length})
                    </summary>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {byType.get(t)!.map((topic) => (
                        <li key={topic.id} className="flex justify-between gap-3">
                          <span>
                            {children.length ? <span className="text-muted">{names[topic.course_id]} · </span> : null}
                            {topic.name}
                          </span>
                          {topic.lecturer_id && <span className="shrink-0 text-xs text-muted">{lecturerName[topic.lecturer_id]}</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No topics yet. Upload your topic list or timetable in the Library and import it.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Lecturers</h2>
          {course.lecturers.length || children.some((c) => c.lecturers.length) ? (
            <ul className="space-y-2 text-sm">
              {[course, ...children].flatMap((c) =>
                c.lecturers.map((l) => (
                  <li key={l.id} className="flex gap-2">
                    <UserRound size={16} className="mt-0.5 shrink-0 text-muted" />
                    <div>
                      <p className="font-medium">
                        {l.name}
                        {children.length ? <span className="font-normal text-muted"> · {names[c.id]}</span> : null}
                      </p>
                      {l.notes && <p className="text-muted">{l.notes}</p>}
                    </div>
                  </li>
                )),
              )}
            </ul>
          ) : (
            <p className="text-sm text-muted">No lecturers yet.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Notes</h2>
          <p className="text-sm whitespace-pre-wrap text-muted">{course.notes || "No notes yet."}</p>
        </Card>
      </section>
    </>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Target; label: string; value: string; sub: string }) {
  return (
    <Card>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Icon size={14} /> {label}
      </div>
      <p className="mt-1.5 text-2xl font-semibold">{value}</p>
      <p className="truncate text-xs text-muted">{sub}</p>
    </Card>
  );
}
