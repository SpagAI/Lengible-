import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourses, leafCourses } from "@/lib/courses";
import { removeDriveLink } from "../actions";
import { PageHeader } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { DriveTree } from "@/components/drive/drive-tree";
import type { DriveItem, DriveSource } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Drive link" };
// "Check for changes" lists the whole shared folder again.
export const maxDuration = 300;

export default async function DriveSourcePage({ params }: PageProps<"/library/drive/[id]">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data } = await supabase.from("drive_sources").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const source = data as DriveSource;
  const [{ data: items }, courses] = await Promise.all([
    supabase.from("drive_items").select("*").eq("source_id", id).order("path").order("name").limit(5000),
    getCourses(supabase),
  ]);
  return (
    <>
      <Link href="/library/drive" className="mb-1 inline-flex items-center gap-1 text-sm text-brand">
        <ChevronLeft size={16} /> Drive links
      </Link>
      <PageHeader
        title={source.name}
        subtitle={
          <a href={source.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand">
            Open in Google Drive <ExternalLink size={13} />
          </a>
        }
      />
      <DriveTree
        sourceId={id}
        items={(items ?? []) as DriveItem[]}
        courses={leafCourses(courses).map((c) => ({ id: c.id, name: c.name }))}
        autoImport={source.auto_import}
      />
      <form action={removeDriveLink} className="mt-6">
        <input type="hidden" name="id" value={id} />
        <ConfirmButton variant="danger" message="Remove this link? Files already brought in stay in your Library.">
          Remove this link
        </ConfirmButton>
      </form>
    </>
  );
}
