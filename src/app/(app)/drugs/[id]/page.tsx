import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Columns2, Lightbulb, MapPin, Pencil, Star } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getClassPath } from "@/lib/drugs";
import { findMentions } from "@/lib/mentions";
import { getCourses } from "@/lib/courses";
import { PageHeader, Card, ButtonLink } from "@/components/ui";
import { VerifyToggle } from "@/components/drugs/verify-toggle";
import { DrugImages } from "@/components/drugs/drug-images";
import { Snippet } from "@/components/library/snippet";
import type { Drug, DrugImage } from "@/lib/supabase/types";

export async function generateMetadata({ params }: PageProps<"/drugs/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data } = await supabase.from("drugs").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Drug" };
}

function Section({ title, items, text }: { title: string; items?: string[]; text?: string | null }) {
  if (!(items?.length || text)) return null;
  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold text-muted">{title}</h2>
      {text && <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>}
      {items && items.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default async function DrugPage({ params }: PageProps<"/drugs/[id]">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data } = await supabase.from("drugs").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const drug = data as Drug;

  const [path, { data: siblings }, { data: images }, hits, courses] = await Promise.all([
    getClassPath(supabase, drug.class_id),
    supabase.from("drugs").select("id, name, is_prototype").eq("class_id", drug.class_id).neq("id", id).order("is_prototype", { ascending: false }).order("name"),
    supabase.from("drug_images").select("*").eq("drug_id", id).order("created_at"),
    findMentions(supabase, [drug.name.replace(/\s*\(.*\)/, ""), ...drug.brands.filter((b) => b.length > 3)], 12),
    getCourses(supabase),
  ]);
  const courseName = (cid: string | null) => (cid ? (courses.find((c) => c.id === cid)?.name ?? "") : "General");
  const own = ((images ?? []) as DrugImage[]).filter((i) => i.storage_path);
  const { data: signed } = own.length
    ? await supabase.storage.from("library").createSignedUrls(own.map((i) => i.storage_path!), 3600)
    : { data: [] as { signedUrl: string }[] };
  const imageList = ((images ?? []) as DrugImage[]).map((img) => ({
    ...img,
    src: img.url ?? signed?.[own.findIndex((o) => o.id === img.id)]?.signedUrl ?? "",
  }));

  return (
    <>
      <nav className="mb-1 flex flex-wrap items-center gap-1 text-sm text-brand">
        <Link href="/drugs">Drugs</Link>
        {path.map((c) => (
          <span key={c.id} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-muted" />
            <Link href={`/drugs/class/${c.id}`}>{c.name}</Link>
          </span>
        ))}
      </nav>
      <PageHeader
        title={drug.name}
        subtitle={path.at(-1)?.system}
        action={
          <ButtonLink href={`/drugs/${id}/edit`} variant="secondary" aria-label="Edit">
            <Pencil size={16} /> <span className="hidden sm:inline">Edit</span>
          </ButtonLink>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {drug.is_prototype && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand">
            <Star size={12} className="fill-current" /> Prototype of {path.at(-1)?.name}
          </span>
        )}
        <VerifyToggle id={id} verified={drug.verified} />
      </div>

      {drug.brands.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Brands:</span>
          {drug.brands.map((b) => (
            <span key={b} className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium">
              {b}
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Section title="Mechanism of action" text={drug.mechanism} />
        </div>
        <Section title="Uses (indications)" items={drug.indications} />
        <Section title="Important side effects" items={drug.side_effects} />
        <Section title="Contraindications & cautions" items={drug.contraindications} />
        <Section title="Key interactions" items={drug.interactions} />
        <div className="md:col-span-2">
          <Section title="Pharmacokinetics (exam points)" text={drug.pharmacokinetics} />
        </div>
      </div>

      {drug.nigerian_context && (
        <Card className="mt-3 border-ok/30 bg-ok/5">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ok">
            <MapPin size={15} /> In Nigeria
          </h2>
          <p className="text-sm">{drug.nigerian_context}</p>
        </Card>
      )}

      {path.some((c) => c.mnemonic || c.recognition_tip) && (
        <Card className="mt-3 bg-brand-soft/40">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-brand-strong">
            <Lightbulb size={15} /> Remember the group
          </h2>
          <div className="space-y-2 text-sm">
            {path.map((c) => (
              <div key={c.id}>
                {c.recognition_tip && (
                  <p>
                    <b>Spot it:</b> {c.recognition_tip}
                  </p>
                )}
                {c.mnemonic && (
                  <p>
                    <b>Memory aid:</b> {c.mnemonic}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {drug.notes && <Section title="My notes" text={drug.notes} />}

      <DrugImages drugId={id} drugName={drug.name} images={imageList} />

      {(siblings ?? []).length > 0 && (
        <Card className="mt-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted">Others in {path.at(-1)?.name}</h2>
            <Link href={`/drugs/compare?ids=${id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand">
              <Columns2 size={14} /> Compare
            </Link>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {siblings!.map((s) => (
              <Link key={s.id} href={`/drugs/${s.id}`} className="rounded-full border border-border px-3 py-1 text-sm hover:bg-surface-2">
                {s.is_prototype ? "★ " : ""}
                {s.name}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card className="mt-3">
        <h2 className="mb-2 text-sm font-semibold text-muted">In your materials</h2>
        {hits.length ? (
          <ul className="divide-y divide-border">
            {hits.map((h) => (
              <li key={h.chunk_id}>
                <Link href={`/library/file/${h.file_id}?page=${h.page}`} className="block py-2">
                  <span className="block text-sm font-medium">
                    {h.file_name} <span className="font-normal text-muted">· {courseName(h.course_id)} · page {h.page}</span>
                  </span>
                  <Snippet text={h.snippet} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Not found in your uploads yet.</p>
        )}
      </Card>
      <p className="mt-4 text-xs text-muted">
        Source: Lengible starting reference (standard pharmacology texts: Katzung, Rang &amp; Dale, BNF/WHO, Nigerian national guidelines). Always confirm doses
        and details with your lecture notes and current guidelines.
      </p>
    </>
  );
}
