"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { syncDrugSeed, textToList } from "@/lib/drugs";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function loadDrugs() {
  const { supabase } = await requireUser();
  try {
    const result = await syncDrugSeed(supabase);
    revalidatePath("/drugs", "layout");
    return result;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't load the drug list." };
  }
}

function drugFieldsFrom(fd: FormData) {
  return {
    name: str(fd, "name") || "Unnamed drug",
    class_id: str(fd, "class_id"),
    is_prototype: fd.get("is_prototype") === "on",
    mechanism: str(fd, "mechanism") || null,
    indications: textToList(str(fd, "indications")),
    side_effects: textToList(str(fd, "side_effects")),
    contraindications: textToList(str(fd, "contraindications")),
    interactions: textToList(str(fd, "interactions")),
    pharmacokinetics: str(fd, "pharmacokinetics") || null,
    brands: textToList(str(fd, "brands").replace(/,/g, "\n")),
    nigerian_context: str(fd, "nigerian_context") || null,
    notes: str(fd, "notes") || null,
  };
}

// Saving your own changes marks the entry as edited, so Lengible's updates never overwrite it.
export async function saveDrug(fd: FormData) {
  const { supabase } = await requireUser();
  const id = str(fd, "id");
  const fields = drugFieldsFrom(fd);
  if (id) {
    await supabase
      .from("drugs")
      .update({ ...fields, edited: true, verified: fd.get("verified") === "on", updated_at: new Date().toISOString() })
      .eq("id", id);
    revalidatePath("/drugs", "layout");
    redirect(`/drugs/${id}`);
  }
  const { data } = await supabase
    .from("drugs")
    .insert({ ...fields, edited: true, verified: fd.get("verified") === "on" })
    .select("id")
    .single();
  revalidatePath("/drugs", "layout");
  redirect(data ? `/drugs/${data.id}` : "/drugs");
}

export async function deleteDrug(fd: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("drugs").delete().eq("id", str(fd, "id"));
  revalidatePath("/drugs", "layout");
  redirect("/drugs");
}

export async function setDrugVerified(id: string, verified: boolean) {
  const { supabase } = await requireUser();
  await supabase.from("drugs").update({ verified }).eq("id", id);
  revalidatePath("/drugs", "layout");
}

export async function saveClass(fd: FormData) {
  const { supabase } = await requireUser();
  const id = str(fd, "id");
  await supabase
    .from("drug_classes")
    .update({
      name: str(fd, "name") || "Unnamed group",
      description: str(fd, "description") || null,
      mnemonic: str(fd, "mnemonic") || null,
      recognition_tip: str(fd, "recognition_tip") || null,
      verified: fd.get("verified") === "on",
      edited: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath("/drugs", "layout");
}

export async function addDrugImage(img: { drugId: string; url?: string; storagePath?: string; source: string; sourceUrl?: string; caption?: string }) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("drug_images").insert({
    drug_id: img.drugId,
    url: img.url ?? null,
    storage_path: img.storagePath ?? null,
    source: img.source,
    source_url: img.sourceUrl ?? null,
    caption: img.caption ?? null,
  });
  revalidatePath(`/drugs/${img.drugId}`);
  return { error: error?.message };
}

export async function deleteDrugImage(fd: FormData) {
  const { supabase } = await requireUser();
  const id = str(fd, "id");
  const { data } = await supabase.from("drug_images").select("drug_id, storage_path").eq("id", id).maybeSingle();
  if (data?.storage_path) await supabase.storage.from("library").remove([data.storage_path]);
  await supabase.from("drug_images").delete().eq("id", id);
  if (data) revalidatePath(`/drugs/${data.drug_id}`);
}
