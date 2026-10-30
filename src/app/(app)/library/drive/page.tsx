import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FolderOpen } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/drugs";
import { formatDate } from "@/lib/dates";
import { PageHeader, Card } from "@/components/ui";
import { AddLinkForm } from "@/components/drive/add-link-form";
import { DriveSetup } from "@/components/drive/drive-setup";
import type { DriveSource } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Google Drive links" };
// Listing a big shared folder (in the add-link action) can take a while.
export const maxDuration = 300;

export default async function DrivePage() {
  const { supabase } = await requireUser();
  const { data: sources, error } = await supabase.from("drive_sources").select("*").order("created_at");
  // Counted in the database (a class drive can hold thousands of files; row reads stop at 1,000).
  const items = () => supabase.from("drive_items").select("id", { count: "exact", head: true });
  const counts = await Promise.all(
    ((sources ?? []) as DriveSource[]).map(async (s) => {
      const [total, inLib, waiting] = await Promise.all([
        items().eq("source_id", s.id),
        items().eq("source_id", s.id).eq("status", "imported"),
        items().eq("source_id", s.id).eq("include", true).in("status", ["new", "changed"]),
      ]);
      return [s.id, { total: total.count ?? 0, inLib: inLib.count ?? 0, waiting: waiting.count ?? 0 }] as const;
    }),
  );
  const countOf = new Map(counts);
  const hasKey = !!(process.env.GOOGLE_DRIVE_API_KEY || process.env.GOOGLE_API_KEY);

  return (
    <>
      <Link href="/library" className="mb-1 inline-flex items-center gap-1 text-sm text-brand">
        <ChevronLeft size={16} /> Library
      </Link>
      <PageHeader title="Google Drive links" subtitle="Bring in folders shared with you, like your class folder. Lengible keeps them up to date." />
      {isMissingTable(error) ? (
        <Card className="space-y-2 text-sm">
          <p className="font-medium">One setup step: add the Drive tables to your Supabase</p>
          <p>
            In Supabase → <b>SQL Editor</b> → <b>New query</b>, paste everything from <b>supabase/migrations/0007_drive_links.sql</b> (in your GitHub repo)
            and click <b>Run</b>. Then refresh this page.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          <DriveSetup open={!hasKey} />
          <Card>
            <h2 className="mb-3 font-semibold">Add a shared link</h2>
            <AddLinkForm />
          </Card>
          {((sources ?? []) as DriveSource[]).length > 0 && (
            <Card className="divide-y divide-border p-0">
              {((sources ?? []) as DriveSource[]).map((s) => {
                const { total, inLib, waiting } = countOf.get(s.id) ?? { total: 0, inLib: 0, waiting: 0 };
                return (
                  <Link key={s.id} href={`/library/drive/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <FolderOpen size={20} className="shrink-0 text-brand" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.name}</span>
                      <span className="block text-xs text-muted">
                        {total.toLocaleString()} files · {inLib} in your Library{waiting ? ` · ${waiting} to bring in` : ""}
                        {s.last_checked_at ? ` · checked ${formatDate(s.last_checked_at.slice(0, 10), { day: "numeric", month: "short" })}` : ""}
                      </span>
                    </span>
                    <ChevronRight size={18} className="text-muted" />
                  </Link>
                );
              })}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
