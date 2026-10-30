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
import { allDriveItems, blockedNote } from "@/lib/drive";
import type { DriveSource } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Drive link" };
// "Check for changes" lists the whole shared folder again.
export const maxDuration = 300;

export default async function DriveSourcePage({ params, searchParams }: PageProps<"/library/drive/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const blocked = typeof sp.blocked === "string" ? sp.blocked.split("\n").filter(Boolean) : [];
  const { supabase } = await requireUser();
  const { data } = await supabase.from("drive_sources").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const source = data as DriveSource;
  const [items, courses] = await Promise.all([
    allDriveItems(supabase, id),
    getCourses(supabase),
  ]);
  // Whether each file brought in has been processed yet ("uploaded" = stored, waiting for you to tap Process).
  const fileIds = items.flatMap((i) => (i.file_id ? [i.file_id] : []));
  const fileStatus: Record<string, string> = {};
  for (let k = 0; k < fileIds.length; k += 200) {
    const { data } = await supabase.from("files").select("id, status").in("id", fileIds.slice(k, k + 200));
    for (const f of data ?? []) fileStatus[f.id] = f.status;
  }
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
      {blocked.length > 0 && (
        <p className="mb-4 rounded-xl bg-warn/10 p-3 text-sm text-warn">
          {blockedNote(blocked)} Ask your class rep to share them, or add them as their own links if they have their own shared link.
        </p>
      )}
      <DriveTree
        sourceId={id}
        items={items}
        courses={leafCourses(courses).map((c) => ({ id: c.id, name: c.name }))}
        autoImport={source.auto_import}
        fileStatus={fileStatus}
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
