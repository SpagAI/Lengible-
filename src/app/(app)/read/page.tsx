import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { drivePreviewUrl, isDrivePath } from "@/lib/drive";
import { Reader } from "@/components/library/reader";
import type { LibraryFile } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Read" };

// Reading view: one file at a time, or several you selected one after another (?files=a,b,c&i=0&page=5).
export default async function ReadPage({ searchParams }: PageProps<"/read">) {
  const sp = await searchParams;
  const ids = (typeof sp.files === "string" ? sp.files : "").split(",").filter(Boolean).slice(0, 200);
  if (!ids.length) redirect("/library");
  const i = Math.min(Math.max(0, Number(sp.i) || 0), ids.length - 1);
  const { supabase } = await requireUser();
  const { data: list } = await supabase.from("files").select("id, name, status, page_count, storage_path, mime_type").in("id", ids);
  const byId = new Map((list ?? []).map((f) => [f.id, f]));
  const files = ids.map((id) => byId.get(id)).filter(Boolean) as Pick<LibraryFile, "id" | "name" | "status" | "page_count" | "storage_path" | "mime_type">[];
  if (!files.length) redirect("/library");
  const file = files[Math.min(i, files.length - 1)];

  // The file itself to look at (PDF, picture, or Google's viewer for files linked from Drive) and its text page by page.
  const [{ data: pages }, { data: item }] = await Promise.all([
    supabase.from("chunks").select("page, content").eq("file_id", file.id).order("page").limit(3000),
    supabase.from("drive_items").select("drive_id, resource_key").eq("file_id", file.id).limit(1).maybeSingle(),
  ]);
  let visual: { kind: "pdf" | "image" | "drive"; url: string } | null = null;
  if (isDrivePath(file.storage_path)) {
    visual = { kind: "drive", url: drivePreviewUrl(item?.drive_id ?? file.storage_path.slice(6).split("/")[0], item?.resource_key) };
  } else {
    const { data: signed } = await supabase.storage.from("library").createSignedUrl(file.storage_path, 3600);
    const lower = file.storage_path.toLowerCase();
    if (signed?.signedUrl && lower.endsWith(".pdf")) visual = { kind: "pdf", url: signed.signedUrl };
    else if (signed?.signedUrl && file.mime_type?.startsWith("image/")) visual = { kind: "image", url: signed.signedUrl };
    else if (item) visual = { kind: "drive", url: drivePreviewUrl(item.drive_id, item.resource_key) };
  }

  return (
    <Reader
      key={file.id}
      ids={files.map((f) => f.id)}
      names={files.map((f) => f.name)}
      index={files.indexOf(file)}
      file={{ id: file.id, name: file.name, status: file.status, pageCount: file.page_count ?? 0, slides: /\.pptx$/i.test(file.storage_path) }}
      pages={(pages ?? []).map((p) => ({ page: p.page, text: p.content }))}
      visual={visual}
      startPage={Number(sp.page) || 0}
    />
  );
}
