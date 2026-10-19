import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { CourseNode } from "@/lib/courses";
import { Card, colorFor, cx } from "@/components/ui";
import { CourseCard } from "@/components/course-card";

// Courses with their sub-courses nested under the group (Pathology → its four departments).
export function CourseList({ tree }: { tree: CourseNode[] }) {
  return (
    <div className="space-y-3">
      {tree.map((c) =>
        c.is_group ? (
          <Card key={c.id} className="p-3">
            <Link href={`/courses/${c.id}`} className="mb-2 flex items-center gap-2 px-1">
              <span className={cx("size-3 rounded-full", colorFor(c.color).dot)} />
              <span className="flex-1 font-semibold">{c.name}</span>
              <span className="text-xs text-muted">{c.children.length} courses</span>
              <ChevronRight size={18} className="text-muted" />
            </Link>
            <div className="space-y-2">
              {c.children.map((k) => (
                <CourseCard key={k.id} course={k} nested />
              ))}
            </div>
          </Card>
        ) : (
          <CourseCard key={c.id} course={c} />
        ),
      )}
    </div>
  );
}
