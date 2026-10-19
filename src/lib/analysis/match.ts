// Small, testable helpers for turning what the AI read into Lengible's structure.

export type CourseRef = { id: string; name: string; short_name: string | null };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Common ways timetables name each department.
const SYNONYMS: [RegExp, string][] = [
  [/histo|anatomic|morbid/, "histopathology"],
  [/chem(ical)? ?path|clinical chem|immunolog/, "chemical pathology"],
  [/ha?ematolog|blood transfusion|\bhaem\b/, "haematology"],
  [/microbio|parasitolog|\bmmp\b|\bmcb\b/, "medical microbiology and parasitology"],
  [/pharmacolog|therapeutic|\bpharm\b/, "pharmacology and therapeutics"],
];

// Finds the course a timetable or topic list is talking about; null when unsure.
export function matchCourse(label: string | null | undefined, courses: CourseRef[]): string | null {
  if (!label) return null;
  const l = norm(label);
  const exact = courses.find((c) => norm(c.name) === l || (c.short_name && norm(c.short_name) === l));
  if (exact) return exact.id;
  for (const [re, canonical] of SYNONYMS) {
    if (re.test(l)) {
      const hit = courses.find((c) => norm(c.name).includes(canonical) || canonical.includes(norm(c.name)));
      if (hit) return hit.id;
    }
  }
  const partial = courses.find((c) => l.includes(norm(c.name)) || norm(c.name).includes(l));
  return partial?.id ?? null;
}

// "9:00 AM" / "14:00" / "2pm" → "09:00" / "14:00" / "14:00"; anything else → null.
export function normalizeTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = t.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// "Block II", "block 2 posting" → "Block 2".
export function normalizeBlock(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = name.match(/block\s*([0-9]+|[ivx]+)/i);
  if (!m) return null;
  const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : roman[m[1].toLowerCase()];
  return n ? `Block ${n}` : null;
}

// Lecturer cells like "Prof. Grace O. Gbotosho / Dr. T. O. Omotoso" → separate names.
export function splitLecturers(s: string | null | undefined): string[] {
  if (!s) return [];
  if (/group|all departmental|technical staff|facilitators/i.test(s)) return [];
  return s
    .split(/\s*(?:\/|;|,| and )\s*/)
    .map((x) => x.replace(/\(.*?\)/g, "").trim())
    .filter((x) => /^(prof|dr|mr|mrs|ms|miss)\.?\s/i.test(x) && x.length < 60);
}

export const examKindFrom = (title: string, hint?: string | null) => {
  const t = `${hint ?? ""} ${title}`.toLowerCase();
  if (/eopt|end of (block|posting)/.test(t)) return "eopt" as const;
  if (/\bmb\b|professional exam/.test(t)) return "mb" as const;
  if (/test|cbt|assessment|ca\b/.test(t)) return "test" as const;
  return "exam" as const;
};
