"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import type { Difficulty, QuestionFormat, QuizSettings } from "@/lib/supabase/types";
import { startDrugQuiz, startQuiz } from "@/app/(app)/quiz/actions";
import { Button, Card, cx, inputClass } from "@/components/ui";

type Opt<T extends string> = { value: T; label: string; hint?: string };

function Chips<T extends string>({ options, value, onChange, multi = false }: { options: Opt<T>[]; value: T[]; onChange: (v: T[]) => void; multi?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            title={o.hint}
            aria-pressed={on}
            onClick={() => onChange(multi ? (on ? value.filter((v) => v !== o.value) : [...value, o.value]) : [o.value])}
            className={cx(
              "rounded-full border px-3 py-1.5 text-sm font-medium",
              on ? "border-brand bg-brand text-on-brand" : "border-border bg-surface text-muted hover:bg-surface-2",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className="flex items-center gap-2 text-sm">
      <span className={cx("relative h-6 w-10 rounded-full transition", on ? "bg-brand" : "bg-surface-2 ring-1 ring-border")}>
        <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

const DIFFICULTIES: Opt<Difficulty>[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

export function QuizBuilder({
  formats,
  courses,
  topics,
  initialTopic,
  initialCourse,
  pastMode,
}: {
  formats: Opt<QuestionFormat>[];
  courses: { id: string; name: string }[];
  topics: { name: string; course_id: string }[];
  initialTopic?: string;
  initialCourse?: string;
  pastMode?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"custom" | "past">(pastMode ? "past" : "custom");
  const [fmts, setFmts] = useState<QuestionFormat[]>(["mcq"]);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [courseIds, setCourseIds] = useState<string[]>(initialCourse ? [initialCourse] : []);
  const [chosenTopics, setChosenTopics] = useState<string[]>(initialTopic ? [initialTopic] : []);
  const [topicQuery, setTopicQuery] = useState("");
  const [source, setSource] = useState<"slides" | "mixed">("mixed");
  const [count, setCount] = useState(10);
  const [timed, setTimed] = useState(false);
  const [negative, setNegative] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const visibleTopics = useMemo(() => {
    const q = topicQuery.toLowerCase().trim();
    const names = [...new Set(topics.filter((t) => !courseIds.length || courseIds.includes(t.course_id)).map((t) => t.name))];
    return names.filter((n) => !chosenTopics.includes(n) && (!q || n.toLowerCase().includes(q))).slice(0, q ? 30 : 12);
  }, [topics, courseIds, topicQuery, chosenTopics]);

  const submit = () =>
    start(async () => {
      setError(undefined);
      const settings: QuizSettings = {
        formats: fmts,
        difficulty,
        course_ids: courseIds,
        topics: chosenTopics,
        source: mode === "past" ? "past" : source,
        count,
        timed,
        negative_marking: negative,
      };
      const r = await startQuiz(settings, mode);
      if ("error" in r) return setError(r.error);
      router.push(`/quiz/session/${r.id}`);
    });

  return (
    <Card className="space-y-5">
      <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm font-medium">
        {(
          [
            ["custom", "Build your own"],
            ["past", "Past-question style"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={cx("flex-1 rounded-lg py-2", mode === m ? "bg-surface text-brand shadow-sm" : "text-muted")}>
            {label}
          </button>
        ))}
      </div>
      {mode === "past" && (
        <p className="-mt-2 text-sm text-muted">
          Questions styled like your uploaded past and MB questions, weighted toward the topics that come up most in them.
        </p>
      )}

      <Row label="Question formats" hint={fmts.includes("picture") ? "Picture questions come from your picture flashcards." : undefined}>
        <Chips options={formats} value={fmts} onChange={(v) => setFmts(v.length ? v : fmts)} multi />
      </Row>
      <Row label="Difficulty">
        <Chips options={DIFFICULTIES} value={[difficulty]} onChange={(v) => setDifficulty(v[0])} />
      </Row>
      <Row label="Courses" hint="None selected = all courses.">
        <Chips options={courses.map((c) => ({ value: c.id, label: c.name }))} value={courseIds} onChange={setCourseIds} multi />
      </Row>
      <Row label="Topics" hint={chosenTopics.length ? undefined : "None selected = all topics in those courses."}>
        {chosenTopics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chosenTopics.map((t) => (
              <button key={t} type="button" onClick={() => setChosenTopics(chosenTopics.filter((x) => x !== t))} className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-sm text-on-brand">
                {t} <X size={13} />
              </button>
            ))}
          </div>
        )}
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input value={topicQuery} onChange={(e) => setTopicQuery(e.target.value)} placeholder="Find a topic" className={cx(inputClass, "pl-9")} />
        </div>
        {visibleTopics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {visibleTopics.map((t) => (
              <button key={t} type="button" onClick={() => setChosenTopics([...chosenTopics, t].slice(0, 10))} className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:bg-surface-2">
                + {t}
              </button>
            ))}
          </div>
        )}
      </Row>
      {mode === "custom" && (
        <Row label="Source">
          <Chips
            options={[
              { value: "slides", label: "My slides only" },
              { value: "mixed", label: "Slides + standard references" },
            ]}
            value={[source]}
            onChange={(v) => setSource(v[0] as "slides" | "mixed")}
          />
        </Row>
      )}
      <Row label="Number of questions">
        <Chips options={[5, 10, 20, 30].map((n) => ({ value: String(n), label: String(n) }))} value={[String(count)]} onChange={(v) => setCount(Number(v[0]))} />
      </Row>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Toggle on={timed} onChange={setTimed} label="Timed" />
        {fmts.includes("tf") && <Toggle on={negative} onChange={setNegative} label="Negative marking (true/false)" />}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      <Button onClick={submit} disabled={pending} className="w-full sm:w-auto">
        {pending && <Loader2 size={16} className="animate-spin" />} Start quiz
      </Button>
    </Card>
  );
}

export function DrugQuizBuilder({ types, groups }: { types: Opt<string>[]; groups: { id: string; name: string; depth: number; system: string }[] }) {
  const [chosen, setChosen] = useState<string[]>(types.map((t) => t.value));
  const [scope, setScope] = useState("syllabus");
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const bySystem = useMemo(() => {
    const m = new Map<string, typeof groups>();
    for (const g of groups) m.set(g.system, [...(m.get(g.system) ?? []), g]);
    return [...m.entries()];
  }, [groups]);

  return (
    <Card className="space-y-5">
      <p className="text-sm text-muted">Made instantly from your drug database (no AI). Every answer links back to the drug, so you can check it.</p>
      <Row label="Question types">
        <Chips options={types} value={chosen} onChange={(v) => setChosen(v.length ? v : chosen)} multi />
      </Row>
      <Row label="Which drugs">
        <select value={scope} onChange={(e) => setScope(e.target.value)} className={inputClass}>
          <option value="syllabus">My syllabus groups</option>
          <option value="all">All drugs</option>
          {bySystem.map(([system, gs]) => (
            <optgroup key={system} label={system}>
              {gs.map((g) => (
                <option key={g.id} value={g.id}>
                  {"  ".repeat(g.depth)}
                  {g.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Row>
      <Row label="Difficulty" hint="Hard picks wrong options from the same body system, so they look alike.">
        <Chips options={DIFFICULTIES} value={[difficulty]} onChange={(v) => setDifficulty(v[0])} />
      </Row>
      <Row label="Number of questions">
        <Chips options={[5, 10, 20, 30].map((n) => ({ value: String(n), label: String(n) }))} value={[String(count)]} onChange={(v) => setCount(Number(v[0]))} />
      </Row>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startDrugQuiz({ types: chosen as never, scope, count, difficulty });
            if (r?.error) setError(r.error);
          })
        }
      >
        {pending && <Loader2 size={16} className="animate-spin" />} Start drug quiz
      </Button>
    </Card>
  );
}
