"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil } from "lucide-react";
import type { FileProfile } from "@/lib/supabase/types";
import { saveFileProfile } from "@/app/(app)/library/actions";
import { Button, Card, cx, inputClass } from "@/components/ui";

const KIND: Record<FileProfile["kind"], string> = {
  lecture: "Lecture",
  practical: "Practical",
  tutorial: "Tutorial",
  past_questions: "Past questions",
  notes: "Notes",
  textbook: "Textbook",
  timetable: "Timetable",
  topic_list: "Topic list",
  other: "Other",
};
const EXAM: Record<string, string> = { mb: "MB", eopt: "EOPT", resit: "Resit", test: "Test", departmental: "Departmental", other: "Other" };

// What Lengible worked out this file is (from its folder, name and first pages). Tap Correct to fix it.
export function ProfileCard({ fileId, profile }: { fileId: string; profile: FileProfile }) {
  const [editing, setEditing] = useState(false);
  const [p, setP] = useState(profile);
  const [saving, start] = useTransition();
  const facts = [
    KIND[p.kind],
    p.exam ? `${EXAM[p.exam] ?? p.exam}${p.exam_year ? ` ${p.exam_year}` : ""}` : null,
    p.set,
    p.course,
    p.posting,
    p.theory_or_practical && p.theory_or_practical !== "theory" ? (p.theory_or_practical === "both" ? "Theory & practical" : "Practical") : null,
    p.lecturer,
  ].filter(Boolean);

  if (!editing)
    return (
      <Card className="mt-3 space-y-1.5 p-3 text-sm">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="text-xs font-semibold tracking-wide text-muted uppercase">What this file is</span>
            {p.edited && <span className="ml-1.5 text-[11px] text-muted">(you corrected it)</span>}
            <span className="mt-1 flex flex-wrap gap-1.5">
              {facts.map((f) => (
                <span key={f} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                  {f}
                </span>
              ))}
            </span>
          </span>
          <button type="button" onClick={() => setEditing(true)} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand">
            <Pencil size={12} /> Correct
          </button>
        </div>
        {p.summary && <p className="text-xs text-muted">{p.summary}</p>}
        {p.topics.length > 0 && <p className="text-xs">Topics: {p.topics.join(" · ")}</p>}
      </Card>
    );

  const field = (label: string, el: React.ReactNode) => (
    <label className="space-y-1 text-xs">
      <span className="font-medium">{label}</span>
      {el}
    </label>
  );
  return (
    <Card className="mt-3 space-y-3 p-3">
      <p className="text-sm font-semibold">Correct what this file is</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {field(
          "Kind",
          <select value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as FileProfile["kind"] })} className={inputClass}>
            {Object.entries(KIND).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>,
        )}
        {field(
          "Exam (past questions)",
          <select value={p.exam ?? ""} onChange={(e) => setP({ ...p, exam: (e.target.value || null) as FileProfile["exam"] })} className={inputClass}>
            <option value="">—</option>
            {Object.entries(EXAM).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>,
        )}
        {field("Set (e.g. 2K23)", <input value={p.set ?? ""} onChange={(e) => setP({ ...p, set: e.target.value || null })} className={inputClass} placeholder="2K23" />)}
        {field("Exam year", <input value={p.exam_year ?? ""} inputMode="numeric" onChange={(e) => setP({ ...p, exam_year: Number(e.target.value.replace(/\D/g, "")) || null })} className={inputClass} placeholder="2023" />)}
        {field("Course", <input value={p.course ?? ""} onChange={(e) => setP({ ...p, course: e.target.value || null })} className={inputClass} />)}
        {field("Posting", <input value={p.posting ?? ""} onChange={(e) => setP({ ...p, posting: e.target.value || null })} className={inputClass} />)}
        {field("Lecturer", <input value={p.lecturer ?? ""} onChange={(e) => setP({ ...p, lecturer: e.target.value || null })} className={inputClass} />)}
        {field(
          "Theory or practical",
          <select value={p.theory_or_practical ?? "theory"} onChange={(e) => setP({ ...p, theory_or_practical: e.target.value as FileProfile["theory_or_practical"] })} className={inputClass}>
            <option value="theory">Theory</option>
            <option value="practical">Practical</option>
            <option value="both">Both</option>
          </select>,
        )}
        <label className={cx("space-y-1 text-xs sm:col-span-3")}>
          <span className="font-medium">Topics (comma-separated)</span>
          <input value={p.topics.join(", ")} onChange={(e) => setP({ ...p, topics: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} className={inputClass} />
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={saving}
          onClick={() =>
            start(async () => {
              await saveFileProfile(fileId, p);
              setP({ ...p, edited: true, set: p.set?.trim().toUpperCase().replace(/\s+/g, "") || null });
              setEditing(false);
            })
          }
        >
          {saving && <Loader2 size={16} className="animate-spin" />} Save
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setP(profile);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </Card>
  );
}
