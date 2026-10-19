"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { inputClass, cx } from "@/components/ui";

type Option = { id: string; label: string };

// Pick up to 4 drugs (or groups) to compare; the choice lives in the URL so it can be bookmarked.
export function ComparePicker({ mode, selected, options }: { mode: "drugs" | "classes"; selected: Option[]; options: Option[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const param = mode === "drugs" ? "ids" : "classes";
  const go = (ids: string[]) => router.push(`/drugs/compare?${param}=${ids.join(",")}`);
  const listId = `compare-${mode}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {selected.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1 text-sm text-brand-strong">
            {s.label}
            <button type="button" aria-label={`Remove ${s.label}`} onClick={() => go(selected.filter((x) => x.id !== s.id).map((x) => x.id))}>
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      {selected.length < 4 && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const hit = options.find((o) => o.label.toLowerCase() === text.trim().toLowerCase());
            if (hit && !selected.some((s) => s.id === hit.id)) go([...selected.map((s) => s.id), hit.id]);
            setText("");
          }}
        >
          <input
            list={listId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === "drugs" ? "Type a drug name, e.g. atenolol" : "Type a group, e.g. ACE inhibitors"}
            className={cx(inputClass, "flex-1")}
          />
          <datalist id={listId}>
            {options.map((o) => (
              <option key={o.id} value={o.label} />
            ))}
          </datalist>
          <button type="submit" className="grid min-h-11 place-items-center rounded-xl bg-brand px-4 text-on-brand" aria-label="Add">
            <Plus size={18} />
          </button>
        </form>
      )}
    </div>
  );
}
