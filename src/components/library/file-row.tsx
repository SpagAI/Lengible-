import Link from "next/link";
import { FileText, FileImage, Presentation, FileType2, File as FileIcon } from "lucide-react";
import type { LibraryFile } from "@/lib/supabase/types";
import { docTypeLabel, formatBytes } from "@/lib/library";
import { formatDate } from "@/lib/dates";
import { cx } from "@/components/ui";

export function FileTypeIcon({ file, size = 20 }: { file: Pick<LibraryFile, "mime_type" | "storage_path">; size?: number }) {
  const p = file.storage_path.toLowerCase();
  if (file.mime_type?.startsWith("image/")) return <FileImage size={size} />;
  if (p.endsWith(".pdf")) return <FileText size={size} />;
  if (p.endsWith(".pptx")) return <Presentation size={size} />;
  if (p.endsWith(".docx")) return <FileType2 size={size} />;
  return <FileIcon size={size} />;
}

const statusBadge: Partial<Record<LibraryFile["status"], { text: string; cls: string }>> = {
  uploaded: { text: "Processing", cls: "bg-surface-2 text-muted" },
  no_text: { text: "Needs AI reading", cls: "bg-warn/15 text-warn" },
  failed: { text: "Failed", cls: "bg-danger/15 text-danger" },
};

export function FileRow({ file, courseName }: { file: LibraryFile; courseName?: string }) {
  const badge = statusBadge[file.status];
  const needsReview = !!(file.analysis as { pendingReview?: boolean } | null)?.pendingReview;
  return (
    <Link href={`/library/file/${file.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong">
        <FileTypeIcon file={file} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{file.name}</span>
        <span className="block truncate text-xs text-muted">
          {[courseName, docTypeLabel[file.doc_type], file.page_count ? `${file.page_count} ${file.page_count === 1 ? "page" : "pages"}` : null, formatBytes(file.size_bytes), formatDate(file.created_at.slice(0, 10), { day: "numeric", month: "short" })]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      {needsReview && <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[11px] font-medium text-on-brand">Review</span>}
      {badge && <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", badge.cls)}>{badge.text}</span>}
    </Link>
  );
}
