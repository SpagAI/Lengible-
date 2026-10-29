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
    defaultSections: [],
    essayStructure: ["Definition", "Aetiology", "Pathogenesis", "Morphology (gross & micro)", "Clinical features", "Complications"],
    features: [{ href: "/pathology/picture-tests", label: "Picture tests", phase: 7 }],
  },
  pharmacology: {
    kind: "pharmacology",
    label: "Pharmacology",
    defaultSections: [],
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

// The starting structure: Pathology is a group of four departments, each with lectures,
// tutorials and practicals; Pharmacology & Therapeutics stands alone. More courses get added in the app.
export type StarterCourse = { name: string; short: string; code?: string; kind: CourseKind; color: string; children?: StarterCourse[] };

export const defaultCourses: StarterCourse[] = [
  {
    name: "Pathology",
    short: "Path",
    kind: "pathology",
    color: "rose",
    children: [
      { name: "Histopathology", short: "Histo", kind: "pathology", color: "rose" },
      { name: "Chemical Pathology", short: "Chem Path", kind: "pathology", color: "amber" },
      { name: "Haematology", short: "Haem", kind: "pathology", color: "violet" },
      { name: "Medical Microbiology & Parasitology", short: "MMP", kind: "pathology", color: "sky" },
    ],
  },
  { name: "Pharmacology & Therapeutics", short: "Pharm", kind: "pharmacology", color: "teal" },
];

export const STRUCTURE_VERSION = 2;

// Features from later build phases show as "coming soon" until their phase is built.
export const BUILT_PHASE = 5;
