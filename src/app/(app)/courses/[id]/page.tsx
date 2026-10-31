import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, FolderOpen, Pencil, Target, UserRound, FileText } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { topicStats } from "@/lib/quiz-engine";
import { getCourse, getCourses, nextExam, examKindLabel } from "@/lib/courses";
import { countdownLabel, formatDate, todayISO, addDays } from "@/lib/dates";
import { BUILT_PHASE, courseModules } from "@/modules/registry";
import { PageHeader, Card, ButtonLink, colorFor, cx } from "@/components/ui";
import { CourseCard } from "@/components/course-card";
import { ExamList } from "@/components/exam-list";
import { AskPanel } from "@/components/ask/ask-panel";
import type { Topic, TopicFile } from "@/lib/supabase/types";

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
  const [{ data: topics }, { data: lecturers }, { count: fileCount }, { data: attempts }, { data: sessions }, stats] = await Promise.all([
    supabase.from("topics").select("*").in("course_id", ids).order("sort_order").order("name"),
    supabase.from("lecturers").select("id, name").in("course_id", ids),
    supabase.from("files").select("id", { count: "exact", head: true }).in("course_id", ids),
    supabase.from("attempts").select("correct, score").in("course_id", ids),
    supabase
      .from("schedule_sessions")
      .select("*")
      .in("course_id", ids)
      .gte("session_date", today)
      .lte("session_date", addDays(today, 6))
      .order("session_date")
      .order("start_time"),
    topicStats(supabase),
  ]);
  const weak = stats.weak.filter((t) => t.course_id && ids.includes(t.course_id)).slice(0, 5);

  // Which files (and pages) cover each topic, from the AI reading your uploads.
  const topicIds = (topics ?? []).map((t) => t.id);
  const links: TopicFile[] = [];
  for (let i = 0; i < topicIds.length; i += 150) {
    const { data } = await supabase.from("topic_files").select("*").in("topic_id", topicIds.slice(i, i + 150));
    links.push(...((data ?? []) as TopicFile[]));
  }
  const linkFileIds = [...new Set(links.map((l) => l.file_id))];
  const { data: linkFiles } = linkFileIds.length ? await supabase.from("files").select("id, name").in("id", linkFileIds) : { data: [] };
  const fileName = new Map((linkFiles ?? []).map((f) => [f.id, f.name]));
  const linksOf = (topicId: string) => links.filter((l) => l.topic_id === topicId);

  // Materials: this course's Library folders (with how much is processed) and the newest files.
  type MatFile = { id: string; name: string; folder_id: string | null; status: string; created_at: string; page_count: number | null };
  const matFiles: MatFile[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("files").select("id, name, folder_id, status, created_at, page_count").in("course_id", ids).order("created_at", { ascending: false }).range(from, from + 999);
    matFiles.push(...((data ?? []) as MatFile[]));
    if (!data || data.length < 1000) break;
  }
  const { data: matFolders } = await supabase.from("folders").select("id, name, parent_id, course_id").in("course_id", ids).order("name");
  const topFolders = (matFolders ?? []).filter((f) => !f.parent_id);
  const subtreeOf = (rootId: string) => {
    const inside = new Set([rootId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const f of matFolders ?? []) {
        if (f.parent_id && inside.has(f.parent_id) && !inside.has(f.id)) {
          inside.add(f.id);
          grew = true;
        }
      }
    }
    return inside;
  };
  const folderStats = topFolders.map((f) => {
    const inside = subtreeOf(f.id);
    const list = matFiles.filter((x) => x.folder_id && inside.has(x.folder_id));
    return { ...f, total: list.length, read: list.filter((x) => x.status === "extracted" || x.status === "analysed").length };
  });
  const recentFiles = matFiles.slice(0, 6);

  const exams = [...course.course_exams, ...children.flatMap((c) => c.course_exams)];
  const exam = nextExam(exams);
  const answered = attempts?.length ?? 0;
  const accuracy = answered ? Math.round((100 * (attempts ?? []).reduce((t, a) => t + (a.score ?? (a.correct ? 1 : 0)), 0)) / answered) : null;
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
        <Stat icon={FolderOpen} label="Topics" value={String(topics?.length ?? 0)} sub="from your topic list and files" />
      </section>

      <section className="mt-4 flex flex-wrap gap-2">
        <ButtonLink href={`/library/course/${course.id}`} variant="secondary">
          <FolderOpen size={16} /> Open in Library
        </ButtonLink>
        {!course.is_group && (
          <ButtonLink href={`/quiz?tab=build&course=${course.id}`} variant="secondary">
            <Target size={16} /> Quiz this course
          </ButtonLink>
        )}
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

      {matFiles.length > 0 && (
        <section className="mt-4 grid gap-3 lg:grid-cols-2">
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Materials</h2>
              <span className="text-xs text-muted">
                {matFiles.filter((x) => x.status === "extracted" || x.status === "analysed").length} of {matFiles.length} processed
              </span>
              <Link href={`/library/course/${course.id}`} className="ml-auto text-xs font-medium text-brand">
                All in Library →
              </Link>
            </div>
            {folderStats.length > 0 && (
              <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                {folderStats.map((f) => (
                  <li key={f.id}>
                    <Link href={`/library/course/${f.course_id}?folder=${f.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2">
                      <FolderOpen size={16} className="shrink-0 text-brand" />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {f.total} file{f.total === 1 ? "" : "s"}
                        {f.total ? ` · ${f.read === f.total ? "all processed" : `${f.read} processed`}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Recently added</p>
              <ul className="space-y-1 text-sm">
                {recentFiles.map((f) => {
                  const read = f.status === "extracted" || f.status === "analysed";
                  return (
                    <li key={f.id} className="flex items-center gap-2">
                      <FileText size={15} className="shrink-0 text-muted" />
                      <Link href={`/library/file/${f.id}`} className="min-w-0 flex-1 truncate hover:text-brand">
                        {f.name}
                      </Link>
                      {read ? (
                        <Link href={`/library/file/${f.id}`} className="shrink-0 text-xs font-medium text-brand">
                          Read
                        </Link>
                      ) : (
                        <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">Not processed</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="text-xs text-muted">Open a folder or file to quiz on exactly it, or ask Ally (e.g. “quiz me on the anticoagulant slides”).</p>
          </Card>
          <AskPanel scope={{ courseId: course.id }} scopeLabel={course.name} compact />
        </section>
      )}

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

      {weak.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-2 font-semibold">Weak topics</h2>
          <ul className="space-y-2 text-sm">
            {weak.map((t) => (
              <li key={t.topic} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">{t.topic}</span>
                <span className="font-semibold text-danger">{t.pct}%</span>
                <Link href={`/library/search?q=${encodeURIComponent(t.topic)}`} className="text-xs text-brand underline">
                  Revise
                </Link>
                <Link href={`/quiz?tab=build&topic=${encodeURIComponent(t.topic)}&course=${t.course_id}`} className="text-xs text-brand underline">
                  Quiz me
                </Link>
              </li>
            ))}
          </ul>
        </Card>
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
                    <ul className="mt-2 divide-y divide-border text-sm">
                      {byType.get(t)!.map((topic) => {
                        const found = linksOf(topic.id);
                        const subtopics = [...new Set(found.flatMap((l) => l.subtopics))];
                        const points = [...new Set(found.flatMap((l) => l.key_points))];
                        return (
                          <li key={topic.id} className="py-1.5">
                            <details>
                              <summary className="flex cursor-pointer list-none items-start gap-2">
                                <span className="min-w-0 flex-1">
                                  {children.length ? <span className="text-muted">{names[topic.course_id]} · </span> : null}
                                  {topic.name}
                                </span>
                                {topic.source === "material" ? (
                                  <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-strong" title="Found by reading your uploads">
                                    from your files
                                  </span>
                                ) : found.length ? (
                                  <span className="shrink-0 text-[11px] text-muted">{found.length} file{found.length > 1 ? "s" : ""}</span>
                                ) : null}
                                {topic.lecturer_id && <span className="shrink-0 text-xs text-muted">{lecturerName[topic.lecturer_id]}</span>}
                              </summary>
                              <div className="mt-2 space-y-2 rounded-lg bg-surface p-3 text-xs">
                                {found.length ? (
                                  <ul className="space-y-1">
                                    {found.map((l) => (
                                      <li key={l.file_id}>
                                        <Link href={`/library/file/${l.file_id}?page=${l.start_page ?? 1}`} className="text-brand underline">
                                          {fileName.get(l.file_id) ?? "File"}
                                        </Link>
                                        {l.start_page ? <span className="text-muted"> · pages {l.start_page}{l.end_page && l.end_page !== l.start_page ? `–${l.end_page}` : ""}</span> : null}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-muted">No uploaded file covers this topic yet.</p>
                                )}
                                {subtopics.length > 0 && <p><b>Covers:</b> {subtopics.slice(0, 12).join(" · ")}</p>}
                                {points.length > 0 && (
                                  <ul className="list-disc space-y-0.5 pl-4">
                                    {points.slice(0, 8).map((x) => (
                                      <li key={x}>{x}</li>
                                    ))}
                                  </ul>
                                )}
                                <Link href={`/quiz?tab=build&topic=${encodeURIComponent(topic.name)}&course=${topic.course_id}`} className="inline-block font-medium text-brand">
                                  Quiz me on this →
                                </Link>
                              </div>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ))}
            </div>
          ) : (
            <p className="text-sm text-muted">
              No topics yet. Upload slides or notes for this course (Lengible finds the topics in them as it reads), or import your topic list
              or timetable in the Library.
            </p>
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
