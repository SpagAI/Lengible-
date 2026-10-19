"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import type { ConceptKind } from "@/lib/supabase/types";

const kinds: ConceptKind[] = ["drug", "disease", "organism", "investigation", "other"];

export async function updateConcept(fd: FormData) {
  const { supabase } = await requireUser();
  const id = String(fd.get("id"));
  const kind = String(fd.get("kind")) as ConceptKind;
  const aliases = String(fd.get("aliases") ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  await supabase
    .from("concepts")
    .update({
      name: String(fd.get("name") ?? "").trim() || "Untitled",
      kind: kinds.includes(kind) ? kind : "other",
      aliases,
      notes: String(fd.get("notes") ?? "").trim() || null,
    })
    .eq("id", id);
  revalidatePath(`/library/concept/${id}`);
}

export async function deleteConcept(fd: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("concepts").delete().eq("id", String(fd.get("id")));
  revalidatePath("/library", "layout");
  redirect("/library/index");
}
