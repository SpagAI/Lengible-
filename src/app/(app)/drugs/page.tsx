import type { Metadata } from "next";
import { Columns2, Plus } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getDrugTree, seedStatus } from "@/lib/drugs";
import { PageHeader, Card, ButtonLink } from "@/components/ui";
import { DrugTree } from "@/components/drugs/drug-tree";
import { LoadDrugsButton } from "@/components/drugs/load-drugs";
import { SyllabusView } from "@/components/drugs/syllabus-view";
import { syllabusCoverage } from "@/lib/syllabus-coverage";
import Link from "next/link";

export const metadata: Metadata = { title: "Drugs" };
// Loading the full list (a server action on this page) can take a minute.
export const maxDuration = 300;

export default async function DrugsPage({ searchParams }: PageProps<"/drugs">) {
  const sp = await searchParams;
  const view = sp.view === "syllabus" ? "syllabus" : "all";
  const { supabase } = await requireUser();
  const [status, tree, coverage] = await Promise.all([seedStatus(supabase), getDrugTree(supabase), syllabusCoverage(supabase)]);

  if (status.tableMissing) {
    return (
      <>
        <PageHeader title="Drugs" subtitle="Your pharmacology drug database." />
        <Card className="space-y-3 text-sm">
          <p className="font-medium">One setup step left: add the drug tables to your Supabase</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Open your project at supabase.com → <b>SQL Editor</b> → <b>New query</b>.</li>
            <li>
              Open <b>supabase/migrations/0003_drugs.sql</b> in your Lengible GitHub repo, copy everything, paste it in and click <b>Run</b>.
            </li>
            <li>Come back here and refresh. The <b>Load the drug database</b> button will then work.</li>
          </ol>
        </Card>
      </>
    );
  }

  if (status.loaded === 0 && tree.drugCount === 0) {
    return (
      <>
        <PageHeader title="Drugs" subtitle="Your pharmacology drug database." />
        <Card className="space-y-3">
          <p className="font-medium">Load Lengible&apos;s drug list ({status.total} drugs across the undergraduate syllabus)</p>
          <p className="text-sm text-muted">
            Organised as system → class → subclass → drug, with mechanism, uses, side effects, contraindications, interactions, pharmacokinetics,
            brands (Nigerian ones where known), Nigerian context, mnemonics and naming clues. Every entry starts as{" "}
            <b>“Reference: needs verification”</b> — check it against your lecture notes and textbooks, edit anything, and mark it verified.
          </p>
          <LoadDrugsButton label="Load the drug database" />
          {status.error && <p className="text-xs text-danger">Database said: {status.error}</p>}
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Drugs"
        subtitle={`${tree.drugCount} drugs · ${tree.verifiedCount} verified by you · ★ = prototype of its group`}
        action={
          <div className="flex gap-2">
            <ButtonLink href="/drugs/compare" variant="secondary" aria-label="Compare drugs">
              <Columns2 size={16} /> <span className="hidden sm:inline">Compare</span>
            </ButtonLink>
            <ButtonLink href="/drugs/new" variant="secondary" aria-label="Add a drug">
              <Plus size={16} /> <span className="hidden sm:inline">Add</span>
            </ButtonLink>
          </div>
        }
      />
      {status.missing > 0 && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-brand/40">
          <p className="text-sm">{status.missing} new drugs are available in Lengible&apos;s list.</p>
          <LoadDrugsButton label="Add them" variant="secondary" />
        </Card>
      )}
      <div className="mb-4 flex gap-1 rounded-xl bg-surface-2 p-1 text-sm font-medium">
        <Link href="/drugs" className={`flex-1 rounded-lg py-2 text-center ${view === "all" ? "bg-surface text-brand shadow-sm" : "text-muted"}`}>
          All drugs
        </Link>
        <Link href="/drugs?view=syllabus" className={`flex-1 rounded-lg py-2 text-center ${view === "syllabus" ? "bg-surface text-brand shadow-sm" : "text-muted"}`}>
          By my syllabus
        </Link>
      </div>
      {view === "syllabus" ? <SyllabusView supabase={supabase} /> : <DrugTree systems={tree.systems} covered={coverage.byClass} hasTopics={coverage.hasTopics} />}
    </>
  );
}
