import { saveDrug } from "@/app/(app)/drugs/actions";
import { listToText } from "@/lib/drugs";
import type { Drug, DrugClass } from "@/lib/supabase/types";
import { Button, Card, Field, inputClass, cx } from "@/components/ui";

const area = cx(inputClass, "py-2");

// Lists are one item per line.
export function DrugForm({ drug, classes, defaultClassId }: { drug?: Drug; classes: DrugClass[]; defaultClassId?: string }) {
  const label = (c: DrugClass) => {
    const parent = classes.find((p) => p.id === c.parent_id);
    return `${c.system} › ${parent ? `${parent.name} › ` : ""}${c.name}`;
  };
  return (
    <form action={saveDrug} className="space-y-4">
      {drug && <input type="hidden" name="id" value={drug.id} />}
      <Card className="space-y-4">
        <Field label="Name">
          <input name="name" required defaultValue={drug?.name} className={inputClass} />
        </Field>
        <Field label="Class / subclass">
          <select name="class_id" required defaultValue={drug?.class_id ?? defaultClassId ?? ""} className={inputClass}>
            <option value="" disabled>
              Choose…
            </option>
            {[...classes].sort((a, b) => label(a).localeCompare(label(b))).map((c) => (
              <option key={c.id} value={c.id}>
                {label(c)}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_prototype" defaultChecked={drug?.is_prototype} className="size-4 accent-[var(--brand)]" /> Prototype of its group
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="verified" defaultChecked={drug?.verified} className="size-4 accent-[var(--brand)]" /> I have verified this entry
          </label>
        </div>
      </Card>
      <Card className="space-y-4">
        <Field label="Mechanism of action">
          <textarea name="mechanism" rows={3} defaultValue={drug?.mechanism ?? ""} className={area} />
        </Field>
        <Field label="Uses (one per line)">
          <textarea name="indications" rows={4} defaultValue={listToText(drug?.indications ?? [])} className={area} />
        </Field>
        <Field label="Side effects (one per line)">
          <textarea name="side_effects" rows={4} defaultValue={listToText(drug?.side_effects ?? [])} className={area} />
        </Field>
        <Field label="Contraindications & cautions (one per line)">
          <textarea name="contraindications" rows={3} defaultValue={listToText(drug?.contraindications ?? [])} className={area} />
        </Field>
        <Field label="Key interactions (one per line)">
          <textarea name="interactions" rows={3} defaultValue={listToText(drug?.interactions ?? [])} className={area} />
        </Field>
        <Field label="Pharmacokinetics (exam points)">
          <textarea name="pharmacokinetics" rows={2} defaultValue={drug?.pharmacokinetics ?? ""} className={area} />
        </Field>
        <Field label="Brand names" hint="Separate with commas or new lines.">
          <input name="brands" defaultValue={(drug?.brands ?? []).join(", ")} className={inputClass} />
        </Field>
        <Field label="Relevance in Nigeria">
          <textarea name="nigerian_context" rows={2} defaultValue={drug?.nigerian_context ?? ""} className={area} />
        </Field>
        <Field label="My notes" hint="What your lecturer emphasised, exam tips…">
          <textarea name="notes" rows={3} defaultValue={drug?.notes ?? ""} className={area} />
        </Field>
      </Card>
      <Button type="submit">{drug ? "Save changes" : "Add drug"}</Button>
    </form>
  );
}
