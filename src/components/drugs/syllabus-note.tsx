import { BookMarked } from "lucide-react";

// Whether a drug or group is in your Pharmacology topics, or an extra Lengible added.
export function SyllabusNote({ topics, what, partly = false }: { topics: string[]; what: "drug" | "group"; partly?: boolean }) {
  if (!topics.length && partly)
    return (
      <div className="mb-4 rounded-2xl border border-ok/30 bg-ok/5 px-4 py-3 text-sm">
        <p className="flex items-center gap-1.5 font-medium text-ok">
          <BookMarked size={15} /> Partly on your syllabus
        </p>
        <p className="mt-0.5 text-muted">Some subgroups below are in your topics; the others are extras.</p>
      </div>
    );
  return topics.length ? (
    <div className="mb-4 rounded-2xl border border-ok/30 bg-ok/10 px-4 py-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-ok">
        <BookMarked size={15} /> On your syllabus
      </p>
      <p className="mt-0.5 text-muted">
        Covered in: {topics.slice(0, 4).join(" · ")}
        {topics.length > 4 ? ` · +${topics.length - 4} more` : ""}
      </p>
    </div>
  ) : (
    <div className="mb-4 rounded-2xl border border-border bg-surface-2 px-4 py-3 text-sm">
      <p className="font-medium">Extra — beyond your syllabus</p>
      <p className="mt-0.5 text-muted">
        A standard {what} added by Lengible. Study your syllabus groups first; this is for wards, wider exam questions and practice.
      </p>
    </div>
  );
}
