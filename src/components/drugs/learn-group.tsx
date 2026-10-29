"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { BookMarked, ChevronLeft, ChevronRight, Lightbulb, Loader2, Star } from "lucide-react";
import { startGroupQuiz } from "@/app/(app)/quiz/actions";
import { Button, ButtonLink, Card, cx } from "@/components/ui";

export type LearnDrug = {
  id: string;
  name: string;
  group: string;
  is_prototype: boolean;
  mechanism: string | null;
  indications: string[];
  side_effects: string[];
  contraindications: string[];
  brands: string[];
  nigerian_context: string | null;
};
export type LearnSub = { id: string; name: string; tip: string | null; mnemonic: string | null; prototype: string | null; count: number };
export type LearnData = {
  id: string;
  name: string;
  system: string;
  path: string;
  description: string | null;
  tip: string | null;
  mnemonic: string | null;
  syllabusTopics: string[];
  subgroups: LearnSub[];
  prototypes: LearnDrug[];
  others: LearnDrug[];
  deckId: string | null;
};

const firstSentence = (s: string | null) => (s ? (s.match(/^.*?[.;](\s|$)/)?.[0] ?? s).trim() : "");

function List({ title, items, max = 6 }: { title: string; items: string[]; max?: number }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-sm font-semibold text-muted">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {items.slice(0, max).map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

// Teaches one drug group: overview → subgroups → prototype → other members → memory aids → mini-quiz.
export function LearnGroup({ data }: { data: LearnData }) {
  const steps = [
    "Overview",
    ...(data.subgroups.length ? ["Subgroups"] : []),
    ...(data.prototypes.length ? ["Prototype"] : []),
    ...(data.others.length ? ["Other members"] : []),
    "Remember it",
    "Mini-quiz",
  ];
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const name = steps[step];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        {steps.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(i)}
            className={cx("h-1.5 flex-1 rounded-full transition", i <= step ? "bg-brand" : "bg-surface-2")}
            aria-label={`Step ${i + 1}: ${s}`}
          />
        ))}
      </div>
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">
        Step {step + 1} of {steps.length} · {name}
      </p>

      <Card className="space-y-4">
        {name === "Overview" && (
          <>
            <p className="text-sm text-muted">{data.path}</p>
            {data.description ? <p className="leading-relaxed">{data.description}</p> : <p className="text-muted">No description yet. You can add one on the group page.</p>}
            <p className="text-sm">
              {data.subgroups.length ? `${data.subgroups.length} subgroups · ` : ""}
              {data.prototypes.length + data.others.length} drugs · {data.system}
            </p>
            {data.syllabusTopics.length > 0 ? (
              <p className="flex items-start gap-1.5 rounded-xl bg-ok/10 p-3 text-sm text-ok">
                <BookMarked size={15} className="mt-0.5 shrink-0" /> On your syllabus: {data.syllabusTopics.slice(0, 3).join(" · ")}
              </p>
            ) : (
              <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">Extra: beyond your syllabus.</p>
            )}
          </>
        )}

        {name === "Subgroups" && (
          <ul className="space-y-3">
            {data.subgroups.map((s) => (
              <li key={s.id} className="rounded-xl border border-border p-3">
                <p className="font-medium">
                  {s.name} <span className="text-xs font-normal text-muted">· {s.count} drugs</span>
                </p>
                {s.prototype && (
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-brand-strong">
                    <Star size={12} className="fill-current" /> Prototype: {s.prototype}
                  </p>
                )}
                {s.tip && <p className="mt-1 text-sm text-muted">{s.tip}</p>}
              </li>
            ))}
          </ul>
        )}

        {name === "Prototype" &&
          data.prototypes.map((d, i) => (
            <div key={d.id} className={cx("space-y-3", i > 0 && "border-t border-border pt-4")}>
              <p className="flex items-center gap-1.5 text-lg font-semibold">
                <Star size={16} className="fill-current text-brand" /> {d.name}
                {data.prototypes.length > 1 && <span className="text-sm font-normal text-muted">· {d.group}</span>}
              </p>
              {d.mechanism && (
                <div>
                  <p className="text-sm font-semibold text-muted">Mechanism</p>
                  <p className="text-sm leading-relaxed">{d.mechanism}</p>
                </div>
              )}
              <List title="Uses" items={d.indications} />
              <List title="Important side effects" items={d.side_effects} />
              <List title="Contraindications" items={d.contraindications} max={4} />
              {d.nigerian_context && <p className="rounded-xl bg-surface-2 p-3 text-sm">🇳🇬 {d.nigerian_context}</p>}
              <Link href={`/drugs/${d.id}`} className="inline-block text-sm text-brand underline">
                Full drug page →
              </Link>
            </div>
          ))}

        {name === "Other members" && (
          <>
            <p className="text-sm text-muted">How the others compare with the prototype: same core idea, and what makes each one different.</p>
            <ul className="divide-y divide-border">
              {data.others.map((d) => (
                <li key={d.id} className="py-3">
                  <Link href={`/drugs/${d.id}`} className="font-medium text-brand">
                    {d.name}
                  </Link>
                  {data.subgroups.length > 0 && <span className="text-xs text-muted"> · {d.group}</span>}
                  {d.mechanism && <p className="mt-0.5 text-sm">{firstSentence(d.mechanism)}</p>}
                  {(d.indications.length > 0 || d.side_effects.length > 0) && (
                    <p className="mt-0.5 text-xs text-muted">
                      {d.indications.length > 0 && <>Uses: {d.indications.slice(0, 2).join("; ")}. </>}
                      {d.side_effects.length > 0 && <>Watch for: {d.side_effects.slice(0, 2).join("; ")}.</>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {name === "Remember it" && (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-brand-strong">
              <Lightbulb size={16} /> Memory aids
            </p>
            {data.tip && (
              <p>
                <b>Spot it:</b> {data.tip}
              </p>
            )}
            {data.mnemonic && (
              <p>
                <b>Memory aid:</b> {data.mnemonic}
              </p>
            )}
            {data.subgroups
              .filter((s) => s.tip || s.mnemonic)
              .map((s) => (
                <p key={s.id}>
                  <b>{s.name}:</b> {[s.tip, s.mnemonic].filter(Boolean).join(" · ")}
                </p>
              ))}
            {!data.tip && !data.mnemonic && !data.subgroups.some((s) => s.tip || s.mnemonic) && (
              <p className="text-muted">No memory aid saved for this group yet. Add your own on the group page.</p>
            )}
          </div>
        )}

        {name === "Mini-quiz" && (
          <div className="space-y-3">
            <p>Six quick questions on {data.name}: name the class, mechanism, side effects and odd one out.</p>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await startGroupQuiz(data.id);
                    if (r?.error) setError(r.error);
                  })
                }
              >
                {pending && <Loader2 size={16} className="animate-spin" />} Start the mini-quiz
              </Button>
              <ButtonLink href={data.deckId ? `/flashcards/deck/${data.deckId}` : `/drugs/class/${data.id}`} variant="secondary">
                {data.deckId ? "Flashcards for this group" : "Make flashcards"}
              </ButtonLink>
            </div>
          </div>
        )}
      </Card>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => setStep(step - 1)} disabled={step === 0}>
          <ChevronLeft size={16} /> Back
        </Button>
        {step < steps.length - 1 && (
          <Button onClick={() => setStep(step + 1)}>
            Next <ChevronRight size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
