import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { ComparePicker } from "@/components/drugs/compare-picker";
import type { Drug, DrugClass } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Compare drugs" };

const ids = (v: string | string[] | undefined) => (typeof v === "string" ? v.split(",").filter(Boolean).slice(0, 4) : []);

function Cell({ items, text }: { items?: string[]; text?: string | null }) {
  if (items) return items.length ? <ul className="list-disc space-y-0.5 pl-4">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="text-muted">—</span>;
  return text ? <span className="whitespace-pre-wrap">{text}</span> : <span className="text-muted">—</span>;
}

export default async function ComparePage({ searchParams }: PageProps<"/drugs/compare">) {
  const sp = await searchParams;
  const mode = typeof sp.classes === "string" ? "classes" : "drugs";
  const { supabase } = await requireUser();
  const [{ data: allDrugs }, { data: allClasses }] = await Promise.all([
    supabase.from("drugs").select("id, name, class_id").order("name"),
    supabase.from("drug_classes").select("*").order("name"),
  ]);
  const classes = (allClasses ?? []) as DrugClass[];
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? "";

  const tab = (m: string, label: string) => (
    <Link href={m === "drugs" ? "/drugs/compare" : "/drugs/compare?classes="} className={`flex-1 rounded-lg py-2 text-center ${mode === m ? "bg-surface text-brand shadow-sm" : "text-muted"}`}>
      {label}
    </Link>
  );

  let body: React.ReactNode = null;
  if (mode === "drugs") {
    const chosen = ids(sp.ids);
    const { data } = chosen.length ? await supabase.from("drugs").select("*").in("id", chosen) : { data: [] };
    const drugs = chosen.map((id) => (data ?? []).find((d) => d.id === id)).filter(Boolean) as Drug[];
    const rows: [string, (d: Drug) => React.ReactNode][] = [
      ["Class", (d) => <Link href={`/drugs/class/${d.class_id}`} className="text-brand">{className(d.class_id)}{d.is_prototype ? " (prototype)" : ""}</Link>],
      ["Mechanism", (d) => <Cell text={d.mechanism} />],
      ["Uses", (d) => <Cell items={d.indications} />],
      ["Side effects", (d) => <Cell items={d.side_effects} />],
      ["Contraindications", (d) => <Cell items={d.contraindications} />],
      ["Interactions", (d) => <Cell items={d.interactions} />],
      ["Pharmacokinetics", (d) => <Cell text={d.pharmacokinetics} />],
      ["Brands", (d) => <Cell text={d.brands.join(", ")} />],
      ["In Nigeria", (d) => <Cell text={d.nigerian_context} />],
    ];
    body = (
      <>
        <ComparePicker
          mode="drugs"
          selected={drugs.map((d) => ({ id: d.id, label: d.name }))}
          options={(allDrugs ?? []).map((d) => ({ id: d.id, label: d.name }))}
        />
        {drugs.length >= 1 && (
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky left-0 w-28 bg-surface p-3 text-left text-xs text-muted" />
                  {drugs.map((d) => (
                    <th key={d.id} className="min-w-56 p-3 text-left align-bottom">
                      <Link href={`/drugs/${d.id}`} className="text-base font-semibold text-brand">
                        {d.name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, render]) => (
                  <tr key={label} className="border-b border-border align-top last:border-0">
                    <th className="sticky left-0 bg-surface p-3 text-left text-xs font-semibold text-muted">{label}</th>
                    {drugs.map((d) => (
                      <td key={d.id} className="p-3">
                        {render(d)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </>
    );
  } else {
    const chosen = ids(sp.classes);
    const picked = chosen.map((id) => classes.find((c) => c.id === id)).filter(Boolean) as DrugClass[];
    const { data: members } = picked.length
      ? await supabase.from("drugs").select("id, name, class_id, is_prototype, mechanism").in("class_id", [...picked.map((c) => c.id), ...classes.filter((c) => picked.some((p) => p.id === c.parent_id)).map((c) => c.id)])
      : { data: [] as Pick<Drug, "id" | "name" | "class_id" | "is_prototype" | "mechanism">[] };
    const inGroup = (c: DrugClass) => (members ?? []).filter((m) => m.class_id === c.id || classes.find((k) => k.id === m.class_id)?.parent_id === c.id);
    const rows: [string, (c: DrugClass) => React.ReactNode][] = [
      ["System", (c) => c.system],
      ["What it does", (c) => <Cell text={c.description} />],
      ["Spot it", (c) => <Cell text={c.recognition_tip} />],
      ["Memory aid", (c) => <Cell text={c.mnemonic} />],
      ["Prototype", (c) => {
        const p = inGroup(c).find((m) => m.is_prototype);
        return p ? <span><Link href={`/drugs/${p.id}`} className="font-medium text-brand">{p.name}</Link>: {p.mechanism}</span> : <span className="text-muted">—</span>;
      }],
      ["Drugs", (c) => <span>{inGroup(c).map((m) => m.name).join(", ") || "—"}</span>],
    ];
    body = (
      <>
        <ComparePicker mode="classes" selected={picked.map((c) => ({ id: c.id, label: c.name }))} options={classes.map((c) => ({ id: c.id, label: c.name }))} />
        {picked.length >= 1 && (
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky left-0 w-28 bg-surface p-3" />
                  {picked.map((c) => (
                    <th key={c.id} className="min-w-56 p-3 text-left">
                      <Link href={`/drugs/class/${c.id}`} className="text-base font-semibold text-brand">
                        {c.name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, render]) => (
                  <tr key={label} className="border-b border-border align-top last:border-0">
                    <th className="sticky left-0 bg-surface p-3 text-left text-xs font-semibold text-muted">{label}</th>
                    {picked.map((c) => (
                      <td key={c.id} className="p-3">
                        {render(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Compare" subtitle="Side by side, up to 4 at a time. Scroll sideways on a phone." />
      <div className="mb-4 flex gap-1 rounded-xl bg-surface-2 p-1 text-sm font-medium">
        {tab("drugs", "Drugs")}
        {tab("classes", "Groups")}
      </div>
      {body}
    </>
  );
}
