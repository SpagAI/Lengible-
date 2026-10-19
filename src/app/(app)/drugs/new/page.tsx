import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { DrugForm } from "@/components/drugs/drug-form";
import type { DrugClass } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Add drug" };

export default async function NewDrugPage({ searchParams }: PageProps<"/drugs/new">) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const { data: classes } = await supabase.from("drug_classes").select("*");
  return (
    <>
      <PageHeader title="Add a drug" subtitle="For drugs your lecturers teach that aren't in the list yet." />
      <DrugForm classes={(classes ?? []) as DrugClass[]} defaultClassId={typeof sp.class === "string" ? sp.class : undefined} />
    </>
  );
}
