// Shape of Lengible's starting drug database. Every entry is loaded into your own account marked
// "reference: needs verification" until you confirm it, and you can edit any of it.

export type SeedClass = {
  key: string; // stable id, never changes, so later updates can find the entry
  name: string;
  system: string; // e.g. "Autonomic", "Cardiovascular"
  parent?: string; // key of the parent class (subclasses)
  description: string; // one or two lines: what the group does
  mnemonic?: string; // a memory aid for the group
  tip?: string; // how to recognise the class, e.g. naming suffix
};

export type SeedDrug = {
  key: string;
  name: string;
  cls: string; // key of its class or subclass
  proto?: boolean; // prototype drug of its group
  moa: string;
  uses: string[];
  se: string[]; // important side effects
  ci?: string[]; // contraindications / cautions
  ix?: string[]; // key interactions
  pk?: string; // exam-relevant pharmacokinetics
  brands?: string[]; // common brand names (Nigerian ones where known)
  ng?: string; // relevance to the Nigerian context
};

export const SYSTEMS = [
  "Autonomic",
  "Cardiovascular & renal",
  "Blood",
  "Respiratory",
  "Gastrointestinal",
  "Central nervous system",
  "Analgesics & anti-inflammatory",
  "Antibacterials",
  "Antimycobacterials",
  "Antifungals",
  "Antimalarials & antiprotozoals",
  "Anthelmintics",
  "Antivirals",
  "Cancer chemotherapy",
  "Endocrine",
  "Immunopharmacology",
  "Toxicology & antidotes",
] as const;
