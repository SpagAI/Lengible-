import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourses, leafCourses } from "@/lib/courses";
import { matchCourse, normalizeBlock, normalizeTime, examKindFrom } from "@/lib/analysis/match";
import type { Analysis } from "@/lib/analysis/run";
import { daysUntil, formatDate, resolveDate } from "@/lib/dates";
import { importTimetable, importTopics } from "./actions";
import { diffSessions, diffTopics, type OldSession, type OldTopic, type SessionChange } from "@/lib/analysis/diff";
import { PageHeader, Card, Button, inputClass, cx, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Review import" };

const fixDate = (d: string | null | undefined) => {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? resolveDate(Number(m[3]), Number(m[2]), m[1] === "0000" ? null : Number(m[1])) : null;
};

export default async function ReviewPage({ params, searchParams }: PageProps<"/library/file/[id]/review">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const { data: file } = await supabase.from("files").select("id, name, doc_type, analysis").eq("id", id).maybeSingle();
  if (!file) notFound();
  const analysis = file.analysis as Analysis | null;
  const courses = leafCourses(await getCourses(supabase));
  const done = typeof sp.done === "string" ? sp.done : null;

  if (done || analysis?.importedAt) {
    const [a, b, c] = (done ?? "").split("-");
    return (
      <>
        <PageHeader title="Imported" subtitle={file.name} />
        <Card className="space-y-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="text-ok" size={20} />
            {file.doc_type === "timetable"
              ? done
                ? `${a} sessions and ${b} exams/EOPTs added.`
                : "This timetable has been imported."
              : done
                ? `${a} topics in your courses${Number(b) ? `, ${b} corrected` : ""}${Number(c) ? `, ${c} removed` : ""}.`
                : "This topic list has been imported."}
          </p>
          <p className="text-muted">
            Your courses now show these topics{file.doc_type === "timetable" ? ", lecturers, the week's schedule and EOPT countdowns" : ""}. You can edit anything on each course&apos;s
            page. Uploading a newer version of this file and importing again replaces what it added.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/courses" className="rounded-xl bg-brand px-4 py-2.5 font-medium text-on-brand">
              See courses
            </Link>
            <Link href={`/library/file/${id}`} className="rounded-xl border border-border px-4 py-2.5 font-medium">
              Back to file
            </Link>
          </div>
        </Card>
      </>
    );
  }

  if (!analysis || !(analysis.sessions?.length || analysis.topics?.length)) {
    return (
      <>
        <PageHeader title="Nothing to review" subtitle={file.name} />
        <EmptyState title="Nothing found yet">
          Open the file and tap <b>Re-analyse</b>. Make sure its type is set to Timetable or Topic list.
        </EmptyState>
      </>
    );
  }

  const items = file.doc_type === "timetable" ? (analysis.sessions ?? []) : (analysis.topics ?? []);
  const labels = [...new Set(items.map((x) => x.course))];
  if (file.doc_type === "timetable" && analysis.sessions) {
    const sessions = analysis.sessions.map((s, i) => ({ ...s, i, date: fixDate(s.date) }));
    const assessments = sessions.filter((s) => s.type === "assessment");
    // A newer version of a timetable you imported before: what changed.
    const [{ data: oldRows }, { data: oldExams }] = await Promise.all([
      supabase.from("schedule_sessions").select("id, course_id, session_date, start_time, end_time, title, venue, lecturer, topic_id").eq("source_file_id", id),
      supabase.from("course_exams").select("course_id, label, exam_date, start_time").eq("source_file_id", id),
    ]);
    const diff = oldRows?.length
      ? diffSessions(
          sessions
            .filter((s) => s.type !== "assessment")
            .map((s) => ({ i: s.i, courseId: matchCourse(s.course, courses), date: s.date, start: normalizeTime(s.start_time), end: normalizeTime(s.end_time), title: s.title.trim(), venue: s.venue, lecturer: s.lecturer })),
          oldRows as OldSession[],
        )
      : null;
    const changeOf = new Map((diff?.changes ?? []).map((c) => [c.i, c]));
    const examChanges = (oldExams ?? []).length
      ? assessments.flatMap((s) => {
          const was = (oldExams ?? []).find((e) => e.course_id === matchCourse(s.course, courses) && e.exam_date !== s.date);
          const same = (oldExams ?? []).find((e) => e.course_id === matchCourse(s.course, courses) && e.exam_date === s.date);
          return was && !same && s.date ? [`${s.course}: ${s.title} moved ${formatDate(was.exam_date, { day: "numeric", month: "short" })} → ${formatDate(s.date, { day: "numeric", month: "short" })}`] : [];
        })
      : [];
    const dates = sessions.map((s) => s.date).filter(Boolean).sort() as string[];
    return (
      <>
        <PageHeader title="Review timetable" subtitle={`${file.name} · ${sessions.length} sessions found${dates.length ? ` · ${formatDate(dates[0])} – ${formatDate(dates.at(-1)!)}` : ""}`} />
        <form action={importTimetable} className="space-y-4">
          <input type="hidden" name="file_id" value={id} />

          {diff && <TimetableChanges changes={diff.changes} removed={diff.removed} examChanges={examChanges} sessions={sessions} courseName={(cid) => courses.find((c) => c.id === cid)?.name ?? ""} />}

          <Card className="space-y-3">
            <h2 className="font-semibold">Block / posting</h2>
            <input name="block" defaultValue={normalizeBlock(analysis.block) ?? analysis.block ?? ""} placeholder="e.g. Block 2" className={inputClass} />
          </Card>

          <Card className="space-y-3">
            <h2 className="font-semibold">Exams & EOPTs found</h2>
            <p className="text-sm text-muted">Ticked ones are added with a countdown. Dates already past are unticked. Correct any date or time before importing.</p>
            {assessments.length ? (
              <ul className="space-y-2">
                {assessments.map((s) => {
                  const past = s.date ? daysUntil(s.date) < 0 : true;
                  return (
                    <li key={s.i} className="grid grid-cols-[auto_1fr] items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm">
                      <input type="checkbox" name={`exam:${s.i}`} defaultChecked={!past} className="mt-1 size-5 accent-[var(--brand)]" />
                      <div className="space-y-2">
                        <p className="font-medium">
                          {s.course} · {s.title}{" "}
                          <span className="rounded bg-brand-soft px-1.5 text-[11px] text-brand-strong">{examKindFrom(s.title, s.assessment_kind).toUpperCase()}</span>
                          {past && <span className="ml-1 text-xs text-muted">(already passed)</span>}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <input type="date" name={`examdate:${s.i}`} defaultValue={s.date ?? ""} className={cx(inputClass, "min-h-9 w-44")} />
                          <input type="time" name={`examtime:${s.i}`} defaultValue={normalizeTime(s.start_time) ?? ""} className={cx(inputClass, "min-h-9 w-32")} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">No exams or EOPTs in this timetable. You can add dates on each course&apos;s Edit page.</p>
            )}
          </Card>

          <Card className="space-y-3">
            <h2 className="font-semibold">Sessions by course</h2>
            <p className="text-sm text-muted">Check each timetable name is matched to the right course. Untick a course to leave it out.</p>
            {labels.map((label) => {
              const list = sessions.filter((s) => s.course === label && s.type !== "assessment");
              return (
                <details key={label} className="rounded-xl bg-surface-2 p-3">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <input type="checkbox" name="include" value={label} defaultChecked={label !== "Other"} className="size-5 accent-[var(--brand)]" />
                    <span className="font-medium">{label}</span>
                    <span className="text-muted">· {list.length} sessions</span>
                    <span className="ml-auto w-full sm:w-64">
                      <MapSelect label={label} courses={courses} />
                    </span>
                  </summary>
                  <ul className="mt-2 max-h-72 space-y-1 overflow-auto text-xs">
                    {list.map((s) => (
                      <li key={s.i} className="flex gap-2">
                        {diff && <ChangeChip c={changeOf.get(s.i)} />}
                        <span className="w-24 shrink-0 text-muted">
                          {s.date ? formatDate(s.date, { day: "numeric", month: "short" }) : "?"} {normalizeTime(s.start_time) ?? ""}
                        </span>
                        <span>
                          <span className="text-muted">{s.type} · </span>
                          {s.title}
                          {s.lecturer ? <span className="text-muted"> · {s.lecturer}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </Card>

          <Card className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="opt_topics" defaultChecked className="size-5 accent-[var(--brand)]" /> Add each session&apos;s topic to its course
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="opt_lecturers" defaultChecked className="size-5 accent-[var(--brand)]" /> Add lecturers (from lectures) and link them to their topics
            </label>
            {diff && (
              <label className="flex items-center gap-2">
                <input type="checkbox" name="opt_rename" defaultChecked className="size-5 accent-[var(--brand)]" /> Rename topics whose session title was corrected
                (keeps their files, quizzes and flashcards)
              </label>
            )}
          </Card>

          <Button type="submit" className="w-full sm:w-auto">
            {diff ? "Apply these changes" : "Import into my courses"}
          </Button>
        </form>
      </>
    );
  }

  const topics = (analysis.topics ?? []).map((t, i) => ({ ...t, i }));
  // Compare with the topics already in your courses: new ones, corrections, and ones no longer listed.
  const { data: existingTopics } = await supabase.from("topics").select("id, course_id, name, source").neq("session_type", "section").limit(3000);
  const tdiff = diffTopics(
    topics.map((t) => ({ i: t.i, courseId: matchCourse(t.course, courses), name: t.name.trim() })),
    (existingTopics ?? []) as OldTopic[],
  );
  const tchange = new Map(tdiff.changes.map((c) => [c.i, c]));
  const counts = { new: tdiff.changes.filter((c) => c.kind === "new").length, renamed: tdiff.changes.filter((c) => c.kind === "renamed").length };
  return (
    <>
      <PageHeader title="Review topic list" subtitle={`${file.name} · ${topics.length} topics found`} />
      <form action={importTopics} className="space-y-4">
        <input type="hidden" name="file_id" value={id} />
        {(existingTopics ?? []).length > 0 && (
          <Card className="space-y-2 border-brand/40 text-sm">
            <h2 className="font-semibold">Compared with your courses</h2>
            <p>
              <b>{counts.new}</b> new · <b>{counts.renamed}</b> corrected or renamed · <b>{topics.length - counts.new - counts.renamed}</b> already in your
              courses
              {tdiff.missing.length ? (
                <>
                  {" "}
                  · <b>{tdiff.missing.length}</b> no longer in this list
                </>
              ) : null}
            </p>
            <p className="text-xs text-muted">Corrections rename the topic you already have, so its files, quiz results and flashcards stay linked.</p>
          </Card>
        )}
        {labels.map((label) => {
          const list = topics.filter((t) => t.course === label);
          const blocks = [...new Set(list.map((t) => normalizeBlock(t.block) ?? "No block"))];
          return (
            <Card key={label} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="flex-1 font-semibold">{label}</h2>
                <span className="w-full sm:w-64">
                  <MapSelect label={label} courses={courses} />
                </span>
              </div>
              {blocks.map((b) => (
                <div key={b}>
                  <p className="mb-1 text-xs font-semibold text-muted">{b}</p>
                  <ul className="space-y-1">
                    {list
                      .filter((t) => (normalizeBlock(t.block) ?? "No block") === b)
                      .map((t) => (
                        <li key={t.i}>
                          <label className="flex items-start gap-2 text-sm">
                            <input type="checkbox" name={`topic:${t.i}`} defaultChecked className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
                            <span>
                              {t.name} <span className="text-xs text-muted">· {t.type}</span>
                              {tchange.get(t.i)?.kind === "new" && (existingTopics ?? []).length > 0 && (
                                <span className="ml-1.5 rounded bg-brand-soft px-1.5 text-[11px] text-brand-strong">new</span>
                              )}
                            </span>
                          </label>
                          {tchange.get(t.i)?.kind === "renamed" && (
                            <label className="mt-0.5 ml-6 flex items-start gap-2 text-xs text-warn">
                              <input type="checkbox" name={`rename:${t.i}`} value={tchange.get(t.i)!.old!.id} defaultChecked className="mt-0.5 size-3.5 shrink-0 accent-[var(--brand)]" />
                              <span>Correction of “{tchange.get(t.i)!.old!.name}”: rename it</span>
                            </label>
                          )}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </Card>
          );
        })}
        {tdiff.missing.length > 0 && (
          <Card className="space-y-2">
            <h2 className="font-semibold">In your courses but not in this list</h2>
            <p className="text-sm text-muted">Maybe dropped or merged. They stay unless you tick them (ticking deletes the topic; its files stay in your Library).</p>
            <ul className="space-y-1">
              {tdiff.missing.map((m) => (
                <li key={m.id}>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="remove" value={m.id} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
                    <span>
                      {m.name} <span className="text-xs text-muted">· {courses.find((c) => c.id === m.course_id)?.name}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Button type="submit" className="w-full sm:w-auto">
          Import topics
        </Button>
      </form>
    </>
  );
}

// Which of your courses a name from the file belongs to (pre-filled with the best guess).
function MapSelect({ label, courses }: { label: string; courses: { id: string; name: string; short_name: string | null }[] }) {
  return (
    <select name={`map:${label}`} defaultValue={matchCourse(label, courses) ?? ""} className={cx(inputClass, "min-h-9 text-sm")}>
      <option value="">— Skip —</option>
      {courses.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

const changeStyle: Record<SessionChange["kind"], { label: string; cls: string }> = {
  same: { label: "", cls: "" },
  new: { label: "new", cls: "bg-brand-soft text-brand-strong" },
  changed: { label: "changed", cls: "bg-warn/15 text-warn" },
  moved: { label: "moved", cls: "bg-warn/15 text-warn" },
  renamed: { label: "renamed", cls: "bg-warn/15 text-warn" },
};

function ChangeChip({ c }: { c?: SessionChange }) {
  if (!c || c.kind === "same") return <span className="w-14 shrink-0" />;
  return <span className={cx("w-14 shrink-0 rounded px-1 text-center text-[10px] font-semibold", changeStyle[c.kind].cls)}>{changeStyle[c.kind].label}</span>;
}

// "What changed since your last import" for a newer version of a timetable.
function TimetableChanges({
  changes,
  removed,
  examChanges,
  sessions,
  courseName,
}: {
  changes: SessionChange[];
  removed: OldSession[];
  examChanges: string[];
  sessions: { i: number; title: string; date: string | null; course: string }[];
  courseName: (id: string) => string;
}) {
  const by = (k: SessionChange["kind"]) => changes.filter((c) => c.kind === k);
  const title = (i: number) => sessions.find((s) => s.i === i);
  const d = (x: string | null | undefined) => (x ? formatDate(x, { weekday: "short", day: "numeric", month: "short" }) : "?");
  const lists: { label: string; items: string[] }[] = [
    { label: "Exams / EOPTs moved", items: examChanges },
    { label: "Moved to another day", items: by("moved").map((c) => `${title(c.i)?.title} · ${"what" in c ? c.what.join("; ") : ""}`) },
    { label: "Time, venue or lecturer changed", items: by("changed").map((c) => `${d(title(c.i)?.date)} · ${title(c.i)?.title} · ${"what" in c ? c.what.join("; ") : ""}`) },
    { label: "Title corrected", items: by("renamed").map((c) => `${d(title(c.i)?.date)} · ${"what" in c ? c.what.join("; ") : ""}`) },
    { label: "New sessions", items: by("new").map((c) => `${d(title(c.i)?.date)} · ${title(c.i)?.course} · ${title(c.i)?.title}`) },
    { label: "No longer in the timetable", items: removed.map((r) => `${d(r.session_date)} · ${courseName(r.course_id)} · ${r.title}`) },
  ].filter((l) => l.items.length);
  return (
    <Card className="space-y-3 border-brand/40">
      <h2 className="font-semibold">What changed since your last import</h2>
      {lists.length ? (
        lists.map((l) => (
          <details key={l.label} open={l.items.length <= 6} className="text-sm">
            <summary className="cursor-pointer font-medium">
              {l.label} ({l.items.length})
            </summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {l.items.slice(0, 60).map((x, k) => (
                <li key={k}>{x}</li>
              ))}
            </ul>
          </details>
        ))
      ) : (
        <p className="text-sm text-muted">Nothing changed in the sessions.</p>
      )}
      <p className="text-xs text-muted">Applying replaces this timetable&apos;s sessions with the new version; your countdowns and course pages update.</p>
    </Card>
  );
}
