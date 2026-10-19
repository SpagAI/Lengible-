import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, colorFor, cx } from "@/components/ui";
import { nextExam, examKindLabel, type CourseWithDetails } from "@/lib/courses";
import { countdownLabel } from "@/lib/dates";

export function CourseCard({ course, subtitle, nested = false }: { course: CourseWithDetails; subtitle?: string; nested?: boolean }) {
  const exam = nextExam(course.course_exams);
  const color = colorFor(course.color);
  const details = subtitle ?? ([course.code, course.lecturers.map((l) => l.name).join(", ")].filter(Boolean).join(" · ") || "");
  return (
    <Link href={`/courses/${course.id}`} className="block">
      <Card className={cx("flex items-center gap-3 transition-colors hover:bg-surface-2", nested && "rounded-xl py-3")}>
        <span className={cx("size-3 shrink-0 rounded-full", color.dot)} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{course.name}</p>
          {details && <p className="truncate text-sm text-muted">{details}</p>}
        </div>
        {exam && (
          <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", color.soft)}>
            {examKindLabel[exam.kind]} · {countdownLabel(exam.days)}
          </span>
        )}
        <ChevronRight size={18} className="shrink-0 text-muted" />
      </Card>
    </Link>
  );
}
