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
    const [a, b] = (done ?? "").split("-");
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
                ? `${a} topics added.`
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
    const dates = sessions.map((s) => s.date).filter(Boolean).sort() as string[];
    return (
      <>
        <PageHeader title="Review timetable" subtitle={`${file.name} · ${sessions.length} sessions found${dates.length ? ` · ${formatDate(dates[0])} – ${formatDate(dates.at(-1)!)}` : ""}`} />
        <form action={importTimetable} className="space-y-4">
          <input type="hidden" name="file_id" value={id} />

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
          </Card>

          <Button type="submit" className="w-full sm:w-auto">
            Import into my courses
          </Button>
        </form>
      </>
    );
  }

  const topics = (analysis.topics ?? []).map((t, i) => ({ ...t, i }));
  return (
    <>
      <PageHeader title="Review topic list" subtitle={`${file.name} · ${topics.length} topics found`} />
      <form action={importTopics} className="space-y-4">
        <input type="hidden" name="file_id" value={id} />
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
                            </span>
                          </label>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </Card>
          );
        })}
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
