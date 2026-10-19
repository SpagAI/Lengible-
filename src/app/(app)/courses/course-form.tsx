"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { saveCourse, type CourseFormState } from "./actions";
import { Button, Card, Field, inputClass, courseColors, cx } from "@/components/ui";
import { courseModules } from "@/modules/registry";
import type { CourseWithDetails } from "@/lib/courses";

type ExamRow = { key: string; id: string; kind: string; label: string; exam_date: string; start_time: string };
type LecturerRow = { key: string; id: string; name: string; notes: string };
let nextKey = 0;
const newKey = () => `new-${nextKey++}`;

export function CourseForm({ course, groups }: { course?: CourseWithDetails; groups: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<CourseFormState, FormData>(saveCourse, {});
  const [color, setColor] = useState(course?.color ?? "teal");
  const [exams, setExams] = useState<ExamRow[]>(
    [...(course?.course_exams ?? [])]
      .sort((a, b) => a.exam_date.localeCompare(b.exam_date))
      .map((e) => ({ key: e.id, id: e.id, kind: e.kind, label: e.label, exam_date: e.exam_date, start_time: e.start_time ?? "" })),
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
          <Field label="Short name" hint="Shown where space is tight, e.g. Haem, MMP.">
            <input name="short_name" defaultValue={course?.short_name ?? ""} placeholder="e.g. Haem" className={inputClass} />
          </Field>
          <Field label="Part of">
            <select name="parent_id" defaultValue={course?.parent_id ?? ""} className={inputClass}>
              <option value="">— Nothing (stand-alone course) —</option>
              {groups
                .filter((g) => g.id !== course?.id)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_group" defaultChecked={course?.is_group} className="size-4 accent-[var(--brand)]" />
          This is a group of courses (like Pathology)
        </label>
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
          <h2 className="font-semibold">Exams, tests & EOPTs</h2>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setExams([...exams, { key: newKey(), id: "", kind: "eopt", label: "", exam_date: "", start_time: "" }])}
          >
            <Plus size={16} /> Add
          </Button>
        </div>
        {exams.length === 0 && <p className="text-sm text-muted">No exam dates yet.</p>}
        {exams.map((e) => (
          <div key={e.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl bg-surface-2 p-3 sm:grid-cols-[7rem_1fr_10rem_7rem_auto]">
            <input type="hidden" name="exam_id" value={e.id} />
            <select name="exam_kind" defaultValue={e.kind} className={cx(inputClass, "col-span-1")}>
              <option value="eopt">EOPT</option>
              <option value="exam">Exam</option>
              <option value="test">Test</option>
              <option value="mb">MB</option>
              <option value="other">Other</option>
            </select>
            <Button
              type="button"
              variant="ghost"
              aria-label="Remove"
              className="sm:order-last"
              onClick={() => setExams(exams.filter((x) => x.key !== e.key))}
            >
              <X size={16} />
            </Button>
            <input name="exam_label" defaultValue={e.label} placeholder="Name, e.g. Block 2 EOPT" className={cx(inputClass, "col-span-2 sm:col-span-1")} />
            <input name="exam_date" type="date" required defaultValue={e.exam_date} className={inputClass} />
            <input name="exam_time" type="time" defaultValue={e.start_time} className={inputClass} />
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
