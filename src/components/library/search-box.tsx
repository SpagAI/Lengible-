import { Search } from "lucide-react";
import { inputClass, cx } from "@/components/ui";

export function SearchBox({ defaultValue, course }: { defaultValue?: string; course?: string }) {
  return (
    <form action="/library/search" className="relative">
      <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
      {course && <input type="hidden" name="course" value={course} />}
      <input
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="Search all your materials, e.g. sickle cell, omeprazole"
        className={cx(inputClass, "pl-10")}
      />
    </form>
  );
}
