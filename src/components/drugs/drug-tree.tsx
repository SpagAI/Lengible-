"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Search, Star } from "lucide-react";
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

// Browse class → subclass → drug. Typing filters everything, including brand names and
// naming clues such as "olol" or "pril".
export function DrugTree({ systems }: { systems: System[] }) {
  const [query, setQuery] = useState("");
  const q = norm(query);

  const visible = useMemo(
    () => systems.map((s) => ({ ...s, classes: q ? s.classes.filter((c) => classMatches(c, q)) : s.classes })).filter((s) => s.classes.length),
    [systems, q],
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
      {visible.length === 0 && <p className="text-sm text-muted">Nothing matches “{query}”.</p>}
      {visible.map((s) => (
        <section key={s.name}>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">{s.name}</h2>
          <div className="space-y-2">
            {s.classes.map((c) => (
              <ClassNode key={c.id} c={c} q={q} depth={0} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ClassNode({ c, q, depth }: { c: DrugTreeClass; q: string; depth: number }) {
  const children = q ? c.children.filter((k) => classMatches(k, q)) : c.children;
  const classHit = q && norm(`${c.name} ${c.recognition_tip ?? ""}`).includes(q);
  const drugs = q && !classHit ? c.drugs.filter((d) => norm(`${d.name} ${d.brands.join(" ")}`).includes(q)) : c.drugs;
  return (
    <details open={!!q} className={cx("rounded-2xl border border-border bg-surface", depth > 0 && "rounded-xl bg-surface-2/50")}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{c.name}</span>
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
          <ClassNode key={k.id} c={k} q={q} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}
