import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { deleteDrug } from "../../actions";
import { PageHeader } from "@/components/ui";
import { DrugForm } from "@/components/drugs/drug-form";
import { ConfirmButton } from "@/components/confirm-button";
import type { Drug, DrugClass } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Edit drug" };

export default async function EditDrugPage({ params }: PageProps<"/drugs/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const [{ data: drug }, { data: classes }] = await Promise.all([
    supabase.from("drugs").select("*").eq("id", id).maybeSingle(),
    supabase.from("drug_classes").select("*"),
  ]);
  if (!drug) notFound();
  return (
    <>
      <PageHeader title={`Edit ${drug.name}`} subtitle="Your changes are kept even when Lengible's list is updated." />
      <DrugForm drug={drug as Drug} classes={(classes ?? []) as DrugClass[]} />
      <form action={deleteDrug} className="mt-10 border-t border-border pt-5">
        <input type="hidden" name="id" value={id} />
        <ConfirmButton message={`Delete ${drug.name}? (It can be re-added from Lengible's list later.)`} variant="danger">
          <Trash2 size={16} /> Delete drug
        </ConfirmButton>
      </form>
    </>
  );
}
