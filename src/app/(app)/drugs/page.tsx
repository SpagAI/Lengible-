import type { Metadata } from "next";
import { Columns2, Plus } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getDrugTree, seedStatus } from "@/lib/drugs";
import { PageHeader, Card, ButtonLink } from "@/components/ui";
import { DrugTree } from "@/components/drugs/drug-tree";
import { LoadDrugsButton } from "@/components/drugs/load-drugs";

export const metadata: Metadata = { title: "Drugs" };

export default async function DrugsPage() {
  const { supabase } = await requireUser();
  const [status, tree] = await Promise.all([seedStatus(supabase), getDrugTree(supabase)]);

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
      <DrugTree systems={tree.systems} />
    </>
  );
}
