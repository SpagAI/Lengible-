import type { Metadata } from "next";
import Link from "next/link";
import { FileText, MessageSquare, Repeat2 } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourses } from "@/lib/courses";
import { isMissingTable } from "@/lib/drugs";
import { PageHeader, Card, EmptyState, cx } from "@/components/ui";
import type { ExamQuestion } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Past questions" };

const EXAM: Record<string, string> = { mb: "MB", eopt: "EOPT", resit: "Resit", test: "Test", departmental: "Departmental", other: "Other" };
const FORMAT: Record<string, string> = { essay: "Essay", short_note: "Short note", mcq: "MCQ", tf: "True/False", osce: "OSCE", practical: "Practical", other: "Other" };
// "MB 2K23", "Resit 2024".
const when = (q: Pick<ExamQuestion, "exam" | "class_set" | "exam_year">) => `${EXAM[q.exam] ?? q.exam} ${q.class_set ?? q.exam_year ?? ""}`.trim();

export default async function QuestionsPage({ searchParams }: PageProps<"/questions">) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : null);
  const course = pick("course");
  const exam = pick("exam");
  const format = pick("format");
  const { supabase } = await requireUser();
  const courses = await getCourses(supabase);
  const scope = course ? [course, ...courses.filter((c) => c.parent_id === course).map((c) => c.id)] : null;

  const rows: ExamQuestion[] = [];
  let missing = false;
  for (let from = 0; from < 20000; from += 1000) {
    let q = supabase.from("exam_questions").select("id, file_id, course_id, page, exam, class_set, exam_year, format, number, question, marks, topic, cluster_id, created_at, user_id").order("created_at").range(from, from + 999);
    if (scope) q = q.in("course_id", scope);
    if (exam) q = q.eq("exam", exam as ExamQuestion["exam"]);
    if (format) q = q.eq("format", format as ExamQuestion["format"]);
    const { data, error } = await q;
    if (error) {
      missing = isMissingTable(error);
      break;
    }
    rows.push(...((data ?? []) as ExamQuestion[]));
    if (!data || data.length < 1000) break;
  }
  const fileIds = [...new Set(rows.map((r) => r.file_id))];
  const names = new Map<string, string>();
  for (let k = 0; k < fileIds.length; k += 150) {
    const { data } = await supabase.from("files").select("id, name").in("id", fileIds.slice(k, k + 150));
    for (const f of data ?? []) names.set(f.id, f.name);
  }
  const courseName = new Map(courses.map((c) => [c.id, c.short_name || c.name]));

  // The same question asked in different years (any wording) is one group.
  const groups = new Map<string, ExamQuestion[]>();
  for (const r of rows) groups.set(r.cluster_id ?? r.id, [...(groups.get(r.cluster_id ?? r.id) ?? []), r]);
  const ranked = [...groups.values()]
    .map((list) => ({ list, times: new Set(list.map((q) => `${q.exam}|${q.class_set ?? q.exam_year ?? q.file_id}`)).size }))
    .sort((a, b) => b.times - a.times || b.list.length - a.list.length);
  const repeated = ranked.filter((g) => g.times > 1);

  // Topics by set: how often each topic comes up in each class set / year.
  const sets = [...new Set(rows.map((r) => r.class_set ?? (r.exam_year ? String(r.exam_year) : null)).filter(Boolean) as string[])].sort();
  const topicCounts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const t = (r.topic ?? "").trim();
    const s = r.class_set ?? (r.exam_year ? String(r.exam_year) : null);
    if (!t || !s) continue;
    const m = topicCounts.get(t.toLowerCase()) ?? new Map<string, number>();
    m.set(s, (m.get(s) ?? 0) + 1);
    m.set("__name", 0);
    topicCounts.set(t.toLowerCase(), m);
  }
  const topicRows = [...topicCounts.entries()]
    .map(([key, m]) => ({ name: rows.find((r) => (r.topic ?? "").trim().toLowerCase() === key)?.topic ?? key, counts: m, total: [...m.entries()].filter(([k]) => k !== "__name").reduce((t, [, n]) => t + n, 0), years: [...m.keys()].filter((k) => k !== "__name").length }))
    .sort((a, b) => b.years - a.years || b.total - a.total)
    .slice(0, 40);

  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ course, exam, format, ...patch })) if (v) q.set(k, v);
    const s = q.toString();
    return `/questions${s ? `?${s}` : ""}`;
  };
  const chip = (on: boolean) => cx("shrink-0 rounded-full px-3 py-1 text-xs font-medium", on ? "bg-brand text-on-brand" : "bg-surface-2 text-muted hover:text-text");

  return (
    <>
      <PageHeader
        title="Past questions"
        subtitle="Every question from your MB, EOPT, resit and test papers, with how often each one comes back and which topics come up every year."
      />
      {missing ? (
        <Card className="text-sm">One setup step: run supabase/migrations/0009_server_processing.sql in Supabase. Then process your past-question files.</Card>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <Link href={href({ course: null })} className={chip(!course)}>
                All courses
              </Link>
              {courses
                .filter((c) => !c.archived)
                .map((c) => (
                  <Link key={c.id} href={href({ course: c.id })} className={chip(course === c.id)}>
                    {c.short_name || c.name}
                  </Link>
                ))}
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <Link href={href({ exam: null })} className={chip(!exam)}>
                All exams
              </Link>
              {Object.entries(EXAM).map(([k, v]) => (
                <Link key={k} href={href({ exam: k })} className={chip(exam === k)}>
                  {v}
                </Link>
              ))}
              <span className="mx-1 self-center text-muted">·</span>
              <Link href={href({ format: null })} className={chip(!format)}>
                All formats
              </Link>
              {Object.entries(FORMAT).map(([k, v]) => (
                <Link key={k} href={href({ format: k })} className={chip(format === k)}>
                  {v}
                </Link>
              ))}
            </div>
          </div>

          {!rows.length ? (
            <div className="mt-4">
              <EmptyState title="No past questions yet">
                Bring in and process your past-question papers (MB, EOPT, resit, tests). Lengible recognises them by their folder and file names
                (e.g. “MB 2K23”) and saves every question here.
              </EmptyState>
            </div>
          ) : (
            <>
              <section className="mt-4 grid grid-cols-3 gap-3">
                <Card className="p-3">
                  <p className="text-2xl font-semibold">{rows.length}</p>
                  <p className="text-xs text-muted">questions</p>
                </Card>
                <Card className="p-3">
                  <p className="text-2xl font-semibold">{fileIds.length}</p>
                  <p className="text-xs text-muted">papers</p>
                </Card>
                <Card className="p-3">
                  <p className="text-2xl font-semibold">{repeated.length}</p>
                  <p className="text-xs text-muted">asked more than once</p>
                </Card>
              </section>

              <Card className="mt-4 p-0">
                <h2 className="flex items-center gap-2 px-4 pt-4 pb-2 font-semibold">
                  <Repeat2 size={18} className="text-brand" /> Most repeated
                </h2>
                <ul className="divide-y divide-border">
                  {ranked.slice(0, 80).map(({ list, times }) => {
                    const first = list[0];
                    const wordings = [...new Set(list.map((q) => q.question))];
                    return (
                      <li key={first.cluster_id ?? first.id} className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <span className={cx("mt-0.5 shrink-0 rounded-lg px-2 py-0.5 text-xs font-semibold", times > 1 ? "bg-brand text-on-brand" : "bg-surface-2 text-muted")}>{times}×</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm">{first.question}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                              {[...new Set(list.map(when))].map((w) => (
                                <span key={w} className="rounded-full bg-surface-2 px-2 py-0.5">
                                  {w}
                                </span>
                              ))}
                              <span className="text-muted">
                                {FORMAT[first.format] ?? first.format}
                                {first.topic ? ` · ${first.topic}` : ""}
                                {first.course_id ? ` · ${courseName.get(first.course_id) ?? ""}` : ""}
                              </span>
                            </div>
                            {wordings.length > 1 && (
                              <details className="mt-1.5 text-xs">
                                <summary className="cursor-pointer text-brand">Other wordings ({wordings.length - 1})</summary>
                                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
                                  {wordings.slice(1).map((w) => (
                                    <li key={w}>{w}</li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                              {list.slice(0, 4).map((q) => (
                                <Link key={q.id} href={`/library/file/${q.file_id}${q.page ? `?page=${q.page}` : ""}`} className="inline-flex items-center gap-1 text-brand">
                                  <FileText size={12} /> {names.get(q.file_id) ?? "Paper"}
                                  {q.page ? `, p. ${q.page}` : ""}
                                </Link>
                              ))}
                              <Link href={`/ally?q=${encodeURIComponent(`Help me answer this past question from my slides: ${first.question}`)}`} className="inline-flex items-center gap-1 font-medium text-brand">
                                <MessageSquare size={12} /> Answer it with Ally
                              </Link>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>

              {topicRows.length > 0 && sets.length > 0 && (
                <Card className="mt-4 overflow-x-auto">
                  <h2 className="mb-2 font-semibold">Topics by set</h2>
                  <p className="mb-3 text-xs text-muted">How many questions on each topic came up in each set or year. Topics that come up every year are at the top.</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="py-1 pr-3 font-medium">Topic</th>
                        {sets.map((s) => (
                          <th key={s} className="px-2 py-1 text-center font-medium">
                            {s}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {topicRows.map((t) => (
                        <tr key={t.name}>
                          <td className="py-1.5 pr-3">{t.name}</td>
                          {sets.map((s) => {
                            const n = t.counts.get(s) ?? 0;
                            return (
                              <td key={s} className="px-2 py-1.5 text-center">
                                <span className={cx("inline-grid min-w-6 place-items-center rounded-md px-1 text-xs", n ? (n > 1 ? "bg-brand text-on-brand" : "bg-brand-soft text-brand-strong") : "text-muted")}>
                                  {n || "·"}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
