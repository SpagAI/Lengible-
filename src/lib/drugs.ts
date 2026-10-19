import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Drug, DrugClass } from "@/lib/supabase/types";
import { seedClasses, seedDrugs, SYSTEMS, type SeedDrug } from "@/data/drugs";

type DB = SupabaseClient<Database>;

const drugFields = (d: SeedDrug, classId: string, i: number) => ({
  seed_key: d.key,
  class_id: classId,
  name: d.name,
  is_prototype: !!d.proto,
  mechanism: d.moa,
  indications: d.uses,
  side_effects: d.se,
  contraindications: d.ci ?? [],
  interactions: d.ix ?? [],
  pharmacokinetics: d.pk ?? null,
  brands: d.brands ?? [],
  nigerian_context: d.ng ?? null,
  sort_order: i,
});

// Copies Lengible's drug list into the account, or adds what's new since last time.
// Entries you have edited are never overwritten; unedited, unverified ones get the latest wording.
export async function syncDrugSeed(supabase: DB) {
  const [{ data: existingClasses }, { data: existingDrugs }] = await Promise.all([
    supabase.from("drug_classes").select("id, seed_key, edited, verified"),
    supabase.from("drugs").select("id, seed_key, edited, verified"),
  ]);
  const classByKey = new Map((existingClasses ?? []).filter((c) => c.seed_key).map((c) => [c.seed_key!, c]));
  const drugByKey = new Map((existingDrugs ?? []).filter((d) => d.seed_key).map((d) => [d.seed_key!, d]));
  const classId = new Map<string, string>();
  for (const [k, c] of classByKey) classId.set(k, c.id);

  // Parents before children (two levels deep).
  const ordered = [...seedClasses.filter((c) => !c.parent), ...seedClasses.filter((c) => c.parent)];
  let added = 0;
  let updated = 0;
  for (const [i, c] of ordered.entries()) {
    const fields = {
      seed_key: c.key,
      name: c.name,
      system: c.system,
      parent_id: c.parent ? (classId.get(c.parent) ?? null) : null,
      description: c.description,
      mnemonic: c.mnemonic ?? null,
      recognition_tip: c.tip ?? null,
      sort_order: SYSTEMS.indexOf(c.system as (typeof SYSTEMS)[number]) * 1000 + i,
    };
    const existing = classByKey.get(c.key);
    if (!existing) {
      const { data } = await supabase.from("drug_classes").insert(fields).select("id").single();
      if (data) classId.set(c.key, data.id);
      added++;
    } else if (!existing.edited && !existing.verified) {
      await supabase.from("drug_classes").update(fields).eq("id", existing.id);
      updated++;
    }
  }

  const newRows = [];
  const refreshRows = [];
  for (const [i, d] of seedDrugs.entries()) {
    const cid = classId.get(d.cls);
    if (!cid) continue;
    const existing = drugByKey.get(d.key);
    if (!existing) newRows.push(drugFields(d, cid, i));
    else if (!existing.edited && !existing.verified) refreshRows.push({ id: existing.id, ...drugFields(d, cid, i) });
  }
  for (let i = 0; i < newRows.length; i += 100) {
    const { error } = await supabase.from("drugs").insert(newRows.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
  for (let i = 0; i < refreshRows.length; i += 100) {
    await supabase.from("drugs").upsert(refreshRows.slice(i, i + 100));
  }
  return { added: added + newRows.length, updated: updated + refreshRows.length };
}

// How many entries in Lengible's list the account doesn't have yet.
export async function seedStatus(supabase: DB) {
  const { data } = await supabase.from("drugs").select("seed_key");
  const have = new Set((data ?? []).map((d) => d.seed_key));
  return { total: seedDrugs.length, missing: seedDrugs.filter((d) => !have.has(d.key)).length, loaded: (data ?? []).length };
}

export type DrugTreeClass = DrugClass & { children: DrugTreeClass[]; drugs: Pick<Drug, "id" | "name" | "is_prototype" | "verified" | "brands">[] };

export async function getDrugTree(supabase: DB) {
  const [{ data: classes }, { data: drugs }] = await Promise.all([
    supabase.from("drug_classes").select("*").order("sort_order").order("name"),
    supabase.from("drugs").select("id, name, class_id, is_prototype, verified, brands, sort_order").order("is_prototype", { ascending: false }).order("sort_order").order("name"),
  ]);
  const all = (classes ?? []) as DrugClass[];
  const build = (c: DrugClass): DrugTreeClass => ({
    ...c,
    children: all.filter((k) => k.parent_id === c.id).map(build),
    drugs: (drugs ?? []).filter((d) => d.class_id === c.id),
  });
  const roots = all.filter((c) => !c.parent_id).map(build);
  const systems = [...new Set([...SYSTEMS, ...roots.map((r) => r.system)])]
    .map((name) => ({ name, classes: roots.filter((r) => r.system === name) }))
    .filter((s) => s.classes.length);
  return { systems, drugCount: (drugs ?? []).length, verifiedCount: (drugs ?? []).filter((d) => d.verified).length };
}

// The class and its parent (for breadcrumbs and inherited mnemonics).
export async function getClassPath(supabase: DB, classId: string) {
  const path: DrugClass[] = [];
  let id: string | null = classId;
  while (id && path.length < 4) {
    const res = await supabase.from("drug_classes").select("*").eq("id", id).maybeSingle();
    const row = res.data as DrugClass | null;
    if (!row) break;
    path.unshift(row);
    id = row.parent_id;
  }
  return path;
}

export const listToText = (l: string[]) => l.join("\n");
export const textToList = (t: string) =>
  t
    .split("\n")
    .map((x) => x.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
