import type { Metadata } from "next";
import Link from "next/link";
import { Flag, Flame, TrendingDown, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getTodayQuiz } from "@/lib/quiz";
import { getStreak } from "@/lib/progress";
import { getCourses, leafCourses } from "@/lib/courses";
import { aiLabel, isAIConfigured } from "@/lib/ai";
import { isMissingTable } from "@/lib/drugs";
import { FORMATS, topicStats } from "@/lib/quiz-engine";
import { DRUG_QUIZ_TYPES } from "@/lib/drug-quiz";
import { formatDate } from "@/lib/dates";
import { deleteQuizSession } from "./actions";
import { PageHeader, Card, EmptyState, cx } from "@/components/ui";
import { DailyQuiz } from "@/components/quiz/daily-quiz";
import { StartQuiz } from "@/components/quiz/start-quiz";
import { DrugQuizBuilder, QuizBuilder } from "@/components/quiz/quiz-builder";
import type { DrugClass, QuizSession } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Quiz" };

const TABS = [
  { key: "today", label: "Today" },
  { key: "build", label: "Build a quiz" },
  { key: "drugs", label: "Drug quizzes" },
  { key: "history", label: "Results" },
] as const;

export default async function QuizPage({ searchParams }: PageProps<"/quiz">) {
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "today";
  const { supabase } = await requireUser();
  const [streak, courses] = await Promise.all([getStreak(supabase), getCourses(supabase)]);
  const names = Object.fromEntries(courses.map((c) => [c.id, c.short_name || c.name]));

  return (
    <>
      <PageHeader
        title="Quiz"
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-3 py-1.5 text-sm font-semibold text-warn" title="Daily quiz streak">
            <Flame size={16} /> {streak.current}
          </span>
        }
      />
      <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 text-sm font-medium md:mx-0 md:px-0">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "today" ? "/quiz" : `/quiz?tab=${t.key}`}
            className={cx("shrink-0 rounded-full px-4 py-2", tab === t.key ? "bg-brand text-on-brand" : "bg-surface-2 text-muted hover:text-text")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "today" && <TodayTab supabase={supabase} streak={streak} names={names} />}
      {tab === "build" && (
        <BuildTab
          supabase={supabase}
          courses={leafCourses(courses).map((c) => ({ id: c.id, name: c.short_name || c.name }))}
          topic={typeof sp.topic === "string" ? sp.topic : undefined}
          course={typeof sp.course === "string" ? sp.course : undefined}
          past={sp.mode === "past"}
        />
      )}
      {tab === "drugs" && <DrugsTab supabase={supabase} />}
      {tab === "history" && <HistoryTab supabase={supabase} names={names} />}
    </>
  );
}

type DB = Awaited<ReturnType<typeof requireUser>>["supabase"];

async function TodayTab({ supabase, streak, names }: { supabase: DB; streak: Awaited<ReturnType<typeof getStreak>>; names: Record<string, string> }) {
  const today = await getTodayQuiz(supabase);
  return (
    <>
      {today ? (
        <DailyQuiz
          quizId={today.quiz.id}
          questions={today.questions}
          answered={Object.fromEntries(today.attempts.map((a) => [a.question_id, Number(a.chosen)]))}
          courseNames={names}
          finished={!!today.quiz.completed_at}
          streak={streak.current + (streak.doneToday ? 0 : 1)}
          sourceKinds={today.sourceKinds}
        />
      ) : (
        <Card className="space-y-3">
          <p className="font-medium">Today&apos;s 10 questions are ready to be made.</p>
          <p className="text-sm text-muted">
            They come from your uploaded slides, notes and past questions first, topped up with standard textbook knowledge. Every question shows its
            reference in the corner. Courses with an exam or EOPT in the next two weeks get more questions. Finish the 10 to keep your streak going.
          </p>
          {isAIConfigured() ? (
            <StartQuiz />
          ) : (
            <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">The AI key isn&apos;t set up yet. Add GEMINI_API_KEY in Vercel, then redeploy.</p>
          )}
        </Card>
      )}
      <p className="mt-6 text-xs text-muted">
        Questions are written by {aiLabel()} from your uploads first, then standard textbooks. Best streak: {streak.best} days. For
        other formats, difficulty and topics, use <Link href="/quiz?tab=build" className="text-brand underline">Build a quiz</Link>.
      </p>
    </>
  );
}

async function BuildTab({ supabase, courses, topic, course, past }: { supabase: DB; courses: { id: string; name: string }[]; topic?: string; course?: string; past: boolean }) {
  const [{ data: topics }, { error }] = await Promise.all([
    supabase.from("topics").select("name, course_id").neq("session_type", "section").order("sort_order").limit(1000),
    supabase.from("quiz_sessions").select("id").limit(1),
  ]);
  if (isMissingTable(error)) return <SetupNeeded />;
  return (
    <QuizBuilder
      formats={FORMATS.map((f) => ({ value: f.value, label: f.label, hint: f.hint }))}
      courses={courses}
      topics={(topics ?? []).filter((t): t is { name: string; course_id: string } => !!t.course_id)}
      initialTopic={topic}
      initialCourse={course}
      pastMode={past}
    />
  );
}

async function DrugsTab({ supabase }: { supabase: DB }) {
  const [{ data: classRows }, { error }] = await Promise.all([supabase.from("drug_classes").select("id, name, parent_id, system, sort_order").order("sort_order"), supabase.from("quiz_sessions").select("id").limit(1)]);
  if (isMissingTable(error)) return <SetupNeeded />;
  const classes = (classRows ?? []) as Pick<DrugClass, "id" | "name" | "parent_id" | "system" | "sort_order">[];
  if (!classes.length) {
    return (
      <EmptyState title="Your drug database is empty">
        Load it on the{" "}
        <Link href="/drugs" className="text-brand underline">
          Drugs
        </Link>{" "}
        page first.
      </EmptyState>
    );
  }
  // Groups in tree order, with their depth for indenting.
  const groups: { id: string; name: string; depth: number; system: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of classes.filter((x) => x.parent_id === parent)) {
      groups.push({ id: c.id, name: c.name, depth, system: c.system });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return (
    <>
      <DrugQuizBuilder types={DRUG_QUIZ_TYPES.map((t) => ({ value: t.value, label: t.label, hint: t.hint }))} groups={groups} />
      <p className="mt-4 text-sm text-muted">
        Want to learn a group step by step first? Open any group on the{" "}
        <Link href="/drugs" className="text-brand underline">
          Drugs
        </Link>{" "}
        page and tap <b>Learn this group</b>.
      </p>
    </>
  );
}

async function HistoryTab({ supabase, names }: { supabase: DB; names: Record<string, string> }) {
  const [{ data: sessions, error }, stats, { data: flagged }] = await Promise.all([
    supabase.from("quiz_sessions").select("*").order("created_at", { ascending: false }).limit(30),
    topicStats(supabase),
    supabase.from("questions").select("id, stem, flag_note, format").eq("flagged", true).order("created_at", { ascending: false }).limit(50),
  ]);
  if (isMissingTable(error)) return <SetupNeeded />;
  const list = (sessions ?? []) as QuizSession[];
  const quizMe = (t: { topic: string; course_id: string | null }) => `/quiz?tab=build&topic=${encodeURIComponent(t.topic)}${t.course_id ? `&course=${t.course_id}` : ""}`;

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="mb-1 flex items-center gap-1.5 font-semibold">
          <TrendingDown size={16} className="text-danger" /> Weak topics
        </h2>
        <p className="mb-3 text-xs text-muted">Topics under 60% over the last 90 days (at least 2 answers), from every quiz.</p>
        {stats.weak.length ? (
          <ul className="divide-y divide-border">
            {stats.weak.slice(0, 12).map((t) => (
              <li key={`${t.course_id}${t.topic}`} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t.topic}</span>
                  <span className="text-xs text-muted">
                    {t.course_id ? names[t.course_id] : "General"} · {t.n} answers
                  </span>
                </span>
                <span className="font-semibold text-danger">{t.pct}%</span>
                <span className="flex gap-2 text-xs">
                  <Link href={`/library/search?q=${encodeURIComponent(t.topic)}`} className="text-brand underline">
                    Revise
                  </Link>
                  <Link href={quizMe(t)} className="text-brand underline">
                    Quiz me
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No weak topics yet. Keep quizzing and they&apos;ll show up here.</p>
        )}
        {stats.strong.length > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <TrendingUp size={14} className="text-ok" /> Strong:{" "}
            {[...new Map(stats.strong.map((t) => [t.topic.toLowerCase(), t])).values()]
              .slice(0, 6)
              .map((t) => `${t.topic} (${t.pct}%)`)
              .join(" · ")}
          </p>
        )}
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Your quizzes</h2>
        {list.length ? (
          <Card className="divide-y divide-border p-0">
            {list.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/quiz/session/${s.id}`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.title}</span>
                  <span className="text-xs text-muted">
                    {formatDate(s.created_at.slice(0, 10), { day: "numeric", month: "short" })} · {s.question_ids.length} questions
                    {s.time_limit ? " · timed" : ""}
                  </span>
                </Link>
                <span className={cx("shrink-0 text-sm font-semibold", s.score === null ? "text-muted" : s.score >= 70 ? "text-ok" : s.score >= 50 ? "text-warn" : "text-danger")}>
                  {s.score === null ? (s.finished_at ? "—" : "Continue") : `${Math.round(s.score)}%`}
                </span>
                <form action={deleteQuizSession}>
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="text-xs text-muted hover:text-danger" aria-label="Remove from list">
                    ✕
                  </button>
                </form>
              </div>
            ))}
          </Card>
        ) : (
          <p className="text-sm text-muted">
            No quizzes yet. <Link href="/quiz?tab=build" className="text-brand underline">Build one</Link>.
          </p>
        )}
      </section>

      {(flagged ?? []).length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted">
            <Flag size={14} /> Questions you flagged
          </h2>
          <Card className="divide-y divide-border p-0">
            {flagged!.map((q) => (
              <Link key={q.id} href={`/quiz/question/${q.id}`} className="block px-4 py-3 text-sm hover:bg-surface-2">
                <span className="line-clamp-2">{q.stem}</span>
                {q.flag_note && <span className="text-xs text-warn">“{q.flag_note}”</span>}
              </Link>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

function SetupNeeded() {
  return (
    <Card className="space-y-3 text-sm">
      <p className="font-medium">One setup step: add the quiz tables to your Supabase</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Open your project at supabase.com → <b>SQL Editor</b> → <b>New query</b>.
        </li>
        <li>
          Open <b>supabase/migrations/0005_quiz_engine.sql</b> in your Lengible GitHub repo, tap <b>Raw</b>, copy everything, paste it in and click{" "}
          <b>Run</b>.
        </li>
        <li>Come back here and refresh.</li>
      </ol>
    </Card>
  );
}
