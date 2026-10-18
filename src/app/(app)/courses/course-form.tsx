"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { saveCourse, type CourseFormState } from "./actions";
import { Button, Card, Field, inputClass, courseColors, cx } from "@/components/ui";
import { courseModules } from "@/modules/registry";
import type { CourseWithDetails } from "@/lib/courses";

type ExamRow = { key: string; label: string; exam_date: string };
type LecturerRow = { key: string; id: string; name: string; notes: string };
let nextKey = 0;
const newKey = () => `new-${nextKey++}`;

export function CourseForm({ course }: { course?: CourseWithDetails }) {
  const [state, action, pending] = useActionState<CourseFormState, FormData>(saveCourse, {});
  const [color, setColor] = useState(course?.color ?? "teal");
  const [exams, setExams] = useState<ExamRow[]>(
    course?.course_exams.map((e) => ({ key: e.id, label: e.label, exam_date: e.exam_date })) ?? [],
  );
  const [lecturers, setLecturers] = useState<LecturerRow[]>(
    course?.lecturers.map((l) => ({ key: l.id, id: l.id, name: l.name, notes: l.notes ?? "" })) ?? [],
  );

  return (
    <form action={action} className="space-y-5">
      {course && <input type="hidden" name="id" value={course.id} />}

      <Card className="space-y-4">
        <Field label="Course name">
          <input name="name" required defaultValue={course?.name} placeholder="e.g. Medicine" className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Course code">
            <input name="code" defaultValue={course?.code ?? ""} placeholder="e.g. PHA 401" className={inputClass} />
          </Field>
          <Field label="Course type" hint="Decides which special tools the course gets.">
            <select name="kind" defaultValue={course?.kind ?? "general"} className={inputClass}>
              {Object.values(courseModules).map((m) => (
                <option key={m.kind} value={m.kind}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium">Colour</span>
          <input type="hidden" name="color" value={color} />
          <div className="flex gap-2">
            {Object.entries(courseColors).map(([name, c]) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                onClick={() => setColor(name)}
                className={cx("size-9 rounded-full", c.dot, color === name && "ring-2 ring-text ring-offset-2 ring-offset-surface")}
              />
            ))}
          </div>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Exam dates</h2>
          <Button type="button" variant="ghost" onClick={() => setExams([...exams, { key: newKey(), label: "", exam_date: "" }])}>
            <Plus size={16} /> Add
          </Button>
        </div>
        {exams.length === 0 && <p className="text-sm text-muted">No exam dates yet.</p>}
        {exams.map((e) => (
          <div key={e.key} className="flex gap-2">
            <input name="exam_label" defaultValue={e.label} placeholder="e.g. MB, CA test" className={cx(inputClass, "flex-1")} />
            <input name="exam_date" type="date" required defaultValue={e.exam_date} className={cx(inputClass, "w-40 shrink-0")} />
            <Button type="button" variant="ghost" aria-label="Remove exam" onClick={() => setExams(exams.filter((x) => x.key !== e.key))}>
              <X size={16} />
            </Button>
          </div>
        ))}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Lecturers</h2>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setLecturers([...lecturers, { key: newKey(), id: "", name: "", notes: "" }])}
          >
            <Plus size={16} /> Add
          </Button>
        </div>
        {lecturers.length === 0 && <p className="text-sm text-muted">No lecturers yet.</p>}
        {lecturers.map((l) => (
          <div key={l.key} className="space-y-2 rounded-xl bg-surface-2 p-3">
            <input type="hidden" name="lecturer_id" value={l.id} />
            <div className="flex gap-2">
              <input name="lecturer_name" required defaultValue={l.name} placeholder="Name, e.g. Prof. Adeyemi" className={cx(inputClass, "flex-1")} />
              <Button
                type="button"
                variant="ghost"
                aria-label="Remove lecturer"
                onClick={() => setLecturers(lecturers.filter((x) => x.key !== l.key))}
              >
                <X size={16} />
              </Button>
            </div>
            <textarea
              name="lecturer_notes"
              defaultValue={l.notes}
              rows={2}
              placeholder="What do they emphasise? (optional)"
              className={cx(inputClass, "py-2")}
            />
          </div>
        ))}
      </Card>

      <Card>
        <Field label="Notes">
          <textarea name="notes" rows={4} defaultValue={course?.notes ?? ""} placeholder="Anything to remember about this course" className={cx(inputClass, "py-2")} />
        </Field>
      </Card>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Saving…" : course ? "Save changes" : "Create course"}
      </Button>
    </form>
  );
}
