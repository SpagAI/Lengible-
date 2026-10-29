import Link from "next/link";
import { BookOpen, FileText, History, ImageIcon, Library, Pill } from "lucide-react";
import type { Question } from "@/lib/supabase/types";
import type { SourceKind } from "@/lib/quiz";
import { cx } from "@/components/ui";

const kindStyle: Record<SourceKind, { label: string; icon: typeof BookOpen; cls: string }> = {
  drugs: { label: "Drug database", icon: Pill, cls: "bg-ok/15 text-ok" },
  picture: { label: "Your picture card", icon: ImageIcon, cls: "bg-brand-soft text-brand-strong" },
  past: { label: "Past question", icon: History, cls: "bg-warn/15 text-warn" },
  mb: { label: "MB question", icon: History, cls: "bg-warn/15 text-warn" },
  material: { label: "Your material", icon: FileText, cls: "bg-brand-soft text-brand-strong" },
  standard: { label: "Standard reference", icon: Library, cls: "bg-surface-2 text-muted" },
};

// Where a question came from, shown in the corner of every question.
export function ReferenceTag({ q, kind }: { q: Pick<Question, "source_label" | "source_file_id" | "source_page">; kind: SourceKind }) {
  const raw = q.source_label && q.source_label !== "Standard reference" ? q.source_label : kind === "standard" ? "Standard textbook knowledge" : "";
  const { label, icon: Icon, cls } = kindStyle[kind];
  const detail = raw === label ? "" : raw;
  const body = (
    <>
      <Icon size={13} className="shrink-0" />
      <span className="shrink-0 font-semibold whitespace-nowrap">{label}</span>
      {detail && <span className="min-w-0 truncate opacity-90">· {detail}</span>}
    </>
  );
  const className = cx("inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs", cls);
  return q.source_file_id ? (
    <Link href={`/library/file/${q.source_file_id}?page=${q.source_page ?? 1}`} className={cx(className, "underline-offset-2 hover:underline")} title="Open the source">
      {body}
    </Link>
  ) : (
    <span className={className} title={detail}>
      {body}
    </span>
  );
}
