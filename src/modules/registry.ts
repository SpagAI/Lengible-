import type { CourseKind } from "@/lib/supabase/types";

// Course-specific features plug in here. A new course kind (or the Clinic section)
// adds an entry; pages read from this registry instead of hard-coding course names.
export type CourseModule = {
  kind: CourseKind;
  label: string;
  // Sections that start the topic tree for a new course of this kind.
  defaultSections: string[];
  // Essay skeleton used for essay practice and marking (Phases 5–6).
  essayStructure: string[];
  // Extra feature links shown on the course dashboard.
  features: { href: string; label: string; phase: number }[];
};

export const courseModules: Record<CourseKind, CourseModule> = {
  pathology: {
    kind: "pathology",
    label: "Pathology",
    defaultSections: ["General Pathology", "Systemic Pathology"],
    essayStructure: ["Definition", "Aetiology", "Pathogenesis", "Morphology (gross & micro)", "Clinical features", "Complications"],
    features: [{ href: "/pathology/picture-tests", label: "Picture tests", phase: 7 }],
  },
  pharmacology: {
    kind: "pharmacology",
    label: "Pharmacology",
    defaultSections: ["General Pharmacology", "Systemic Pharmacology"],
    essayStructure: ["Class", "Mechanism of action", "Uses", "Side effects", "Contraindications"],
    features: [{ href: "/drugs", label: "Drug mastery", phase: 3 }],
  },
  general: {
    kind: "general",
    label: "General",
    defaultSections: [],
    essayStructure: ["Definition", "Causes", "Features", "Management", "Complications"],
    features: [],
  },
};

export const defaultCourses: { name: string; code: string; kind: CourseKind; color: string }[] = [
  { name: "Pathology", code: "PATH", kind: "pathology", color: "rose" },
  { name: "Pharmacology", code: "PHARM", kind: "pharmacology", color: "teal" },
];
