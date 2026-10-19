"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BadgeCheck, BookMarked, Search, Star } from "lucide-react";
import type { DrugTreeClass } from "@/lib/drugs";
import { inputClass, cx } from "@/components/ui";

type System = { name: string; classes: DrugTreeClass[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function classMatches(c: DrugTreeClass, q: string): boolean {
  return (
    norm(`${c.name} ${c.recognition_tip ?? ""}`).includes(q) ||
    c.drugs.some((d) => norm(`${d.name} ${d.brands.join(" ")}`).includes(q)) ||
    c.children.some((k) => classMatches(k, q))
  );
}

const countDrugs = (c: DrugTreeClass): number => c.drugs.length + c.children.reduce((n, k) => n + countDrugs(k), 0);

// Groups on your syllabus, plus any group that has one somewhere below it.
type Covered = Record<string, string[]>;
const touchesSyllabus = (c: DrugTreeClass, cov: Covered): boolean => !!cov[c.id] || c.children.some((k) => touchesSyllabus(k, cov));

// Browse class → subclass → drug. Typing filters everything, including brand names and
// naming clues such as "olol" or "pril". Groups your Pharmacology topics cover are marked
// "On your syllabus"; everything else is Lengible's extra standard material.
export function DrugTree({ systems, covered, hasTopics }: { systems: System[]; covered: Covered; hasTopics: boolean }) {
  const [query, setQuery] = useState("");
  const [onlySyllabus, setOnlySyllabus] = useState(false);
  const q = norm(query);

  const visible = useMemo(
    () =>
      systems
        .map((s) => ({
          ...s,
          classes: s.classes.filter((c) => (!q || classMatches(c, q)) && (!onlySyllabus || touchesSyllabus(c, covered))),
        }))
        .filter((s) => s.classes.length),
    [systems, q, onlySyllabus, covered],
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          placeholder="Find a drug, brand, class or ending (e.g. -olol, Lonart)"
          className={cx(inputClass, "pl-10")}
        />
      </div>
      {hasTopics && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setOnlySyllabus((v) => !v)}
            aria-pressed={onlySyllabus}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium",
              onlySyllabus ? "border-brand bg-brand text-on-brand" : "border-border bg-surface text-muted hover:bg-surface-2",
            )}
          >
            <BookMarked size={14} /> Syllabus only
          </button>
          <span className="text-xs text-muted">Unmarked groups are extra standard drugs beyond your syllabus.</span>
        </div>
      )}
      {visible.length === 0 && <p className="text-sm text-muted">Nothing matches “{query}”.</p>}
      {visible.map((s) => (
        <section key={s.name}>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">{s.name}</h2>
          <div className="space-y-2">
            {s.classes.map((c) => (
              <ClassNode key={c.id} c={c} q={q} depth={0} covered={covered} onlySyllabus={onlySyllabus} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ClassNode({ c, q, depth, covered, onlySyllabus }: { c: DrugTreeClass; q: string; depth: number; covered: Covered; onlySyllabus: boolean }) {
  const children = c.children.filter((k) => (!q || classMatches(k, q)) && (!onlySyllabus || touchesSyllabus(k, covered)));
  const topics = covered[c.id];
  const classHit = q && norm(`${c.name} ${c.recognition_tip ?? ""}`).includes(q);
  const drugs = q && !classHit ? c.drugs.filter((d) => norm(`${d.name} ${d.brands.join(" ")}`).includes(q)) : c.drugs;
  return (
    <details open={!!q} className={cx("rounded-2xl border border-border bg-surface", depth > 0 && "rounded-xl bg-surface-2/50")}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">
            {c.name}
            {topics && (
              <span title={topics.join("\n")} className="ml-2 inline-flex items-center gap-1 rounded-full bg-ok/15 px-2 py-0.5 align-middle text-[11px] font-medium text-ok">
                <BookMarked size={11} /> On your syllabus
              </span>
            )}
          </span>
          {c.recognition_tip && <span className="block truncate text-xs text-muted">{c.recognition_tip}</span>}
        </span>
        <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-strong">{countDrugs(c)}</span>
      </summary>
      <div className="space-y-2 px-3 pb-3">
        <Link href={`/drugs/class/${c.id}`} className="inline-block px-1 text-xs font-medium text-brand">
          About this group →
        </Link>
        {drugs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {drugs.map((d) => (
              <Link
                key={d.id}
                href={`/drugs/${d.id}`}
                className={cx(
                  "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm",
                  d.is_prototype ? "border-brand bg-brand-soft font-medium text-brand-strong" : "border-border bg-surface hover:bg-surface-2",
                )}
              >
                {d.is_prototype && <Star size={12} className="fill-current" />}
                {d.name}
                {d.verified && <BadgeCheck size={14} className="text-ok" />}
              </Link>
            ))}
          </div>
        )}
        {children.map((k) => (
          <ClassNode key={k.id} c={k} q={q} depth={depth + 1} covered={covered} onlySyllabus={onlySyllabus} />
        ))}
      </div>
    </details>
  );
}
