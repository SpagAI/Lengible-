import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, colorFor, cx } from "@/components/ui";
import { nextExam, type CourseWithDetails } from "@/lib/courses";
import { countdownLabel } from "@/lib/dates";

export function CourseCard({ course }: { course: CourseWithDetails }) {
  const exam = nextExam(course.course_exams);
  const color = colorFor(course.color);
  return (
    <Link href={`/courses/${course.id}`} className="block">
      <Card className="flex items-center gap-3 transition-colors hover:bg-surface-2">
        <span className={cx("size-3 shrink-0 rounded-full", color.dot)} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{course.name}</p>
          <p className="truncate text-sm text-muted">
            {[course.code, course.lecturers.map((l) => l.name).join(", ")].filter(Boolean).join(" · ") || "No details yet"}
          </p>
        </div>
        {exam && (
          <span className={cx("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", color.soft)}>
            {countdownLabel(exam.days)}
          </span>
        )}
        <ChevronRight size={18} className="shrink-0 text-muted" />
      </Card>
    </Link>
  );
}
