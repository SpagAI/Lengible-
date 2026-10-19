import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import type { Concept } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Drugs & diseases" };

const kinds = [
  ["drug", "Drugs"],
  ["disease", "Diseases"],
  ["organism", "Organisms"],
  ["investigation", "Investigations"],
  ["other", "Other"],
] as const;

export default async function IndexPage({ searchParams }: PageProps<"/library/index">) {
  const sp = await searchParams;
  const kind = typeof sp.kind === "string" ? sp.kind : "all";
  const { supabase } = await requireUser();
  const [{ data: concepts }, { data: links }] = await Promise.all([
    supabase.from("concepts").select("*").order("name"),
    supabase.from("file_concepts").select("concept_id"),
  ]);
  const fileCount = new Map<string, number>();
  for (const l of links ?? []) fileCount.set(l.concept_id, (fileCount.get(l.concept_id) ?? 0) + 1);
  const list = ((concepts ?? []) as Concept[]).filter((c) => kind === "all" || c.kind === kind);

  return (
    <>
      <PageHeader
        title="Drugs, diseases & links"
        subtitle="Everything Lengible found in your materials. Open one to see every course and page that mentions it."
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {[["all", "All"] as const, ...kinds].map(([k, label]) => (
          <Link
            key={k}
            href={k === "all" ? "/library/index" : `/library/index?kind=${k}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${kind === k ? "bg-brand text-on-brand" : "bg-surface-2 text-muted"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      {list.length ? (
        <Card className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {list.map((c) => (
            <Link key={c.id} href={`/library/concept/${c.id}`} className="flex justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <span className="truncate">{c.name}</span>
              <span className="shrink-0 text-xs text-muted">{fileCount.get(c.id) ?? 0} files</span>
            </Link>
          ))}
        </Card>
      ) : (
        <EmptyState title="Nothing here yet">Upload slides or notes; Lengible picks out the drugs, diseases and organisms as it reads them.</EmptyState>
      )}
    </>
  );
}
