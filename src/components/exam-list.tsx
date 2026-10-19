import { Check, X } from "lucide-react";
import type { CourseExam } from "@/lib/supabase/types";
import { confirmExam } from "@/app/(app)/courses/actions";
import { examKindLabel } from "@/lib/courses";
import { countdownLabel, daysUntil, formatDate } from "@/lib/dates";
import { cx } from "@/components/ui";

// Exams for one or more courses. Past dates are struck through and never count down;
// dates detected from a timetable wait for a tap to confirm or remove them.
export function ExamList({ exams, courseNames }: { exams: CourseExam[]; courseNames?: Record<string, string> }) {
  const sorted = [...exams].sort((a, b) => a.exam_date.localeCompare(b.exam_date) || (a.start_time ?? "").localeCompare(b.start_time ?? ""));
  if (!sorted.length) return <p className="text-sm text-muted">No exams or EOPTs yet.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {sorted.map((e) => {
        const d = daysUntil(e.exam_date);
        const past = d < 0;
        return (
          <li key={e.id} className={cx("flex items-center gap-3", past && "text-muted")}>
            <span className="w-12 shrink-0 rounded-md bg-brand-soft px-1.5 py-0.5 text-center text-[11px] font-semibold text-brand-strong">
              {examKindLabel[e.kind]}
            </span>
            <span className={cx("min-w-0 flex-1", past && "line-through")}>
              <span className="block truncate">
                {courseNames?.[e.course_id] ? `${courseNames[e.course_id]} · ` : ""}
                {e.label}
              </span>
              <span className="block text-xs text-muted">
                {formatDate(e.exam_date)}
                {e.start_time ? ` · ${e.start_time}` : ""}
                {e.venue ? ` · ${e.venue}` : ""}
              </span>
            </span>
            {e.confirmed ? (
              <span className="shrink-0 font-medium">{past ? "Done" : countdownLabel(d)}</span>
            ) : (
              <form action={confirmExam} className="flex shrink-0 items-center gap-1">
                <input type="hidden" name="id" value={e.id} />
                <span className="mr-1 text-xs text-warn">Detected</span>
                <button name="decision" value="confirm" title="Confirm this date" className="grid size-8 place-items-center rounded-lg bg-brand text-on-brand">
                  <Check size={16} />
                </button>
                <button name="decision" value="remove" title="Remove" className="grid size-8 place-items-center rounded-lg border border-border">
                  <X size={16} />
                </button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
