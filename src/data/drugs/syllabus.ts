// Links Pharmacology syllabus topics (as imported from your topic list / timetable) to drug groups.
// Each rule matches words in a topic title; a topic can match several rules.

type Rule = { match: RegExp; groups: string[] };

// Topics about principles rather than drug groups.
export const PRINCIPLES = /basic concept|pharmacokinetic|pharmacodynamic|drug interaction|development and regulation|bioassay|adverse drug|pharmacovigilance|routes? of|absorption|acute toxicity|small group|practical|tutorial|revision of basics|pharmacotherapy|assessment|posting test/;

export const SYLLABUS_RULES: Rule[] = [
  { match: /acetylcholine|cholinergic|cholinesterase/, groups: ["cholinergic", "antimuscarinic"] },
  { match: /neuromuscular/, groups: ["nm-blocker"] },
  { match: /noradrenaline|norepinephrine|adreno|adrenergic|catechol/, groups: ["adrenergic-agonist", "alpha-blocker", "beta-blocker"] },
  { match: /renin|angiotensin|antihypertensive|hypertension/, groups: ["raas", "ccb", "diuretics", "beta-blocker", "vasodilator", "alpha-agonist"] },
  { match: /diuretic|renal pharmacology/, groups: ["diuretics"] },
  { match: /antianginal|angina/, groups: ["antianginal", "beta-blocker", "ccb"] },
  { match: /antiarrhythmic|arrhythmi|cvs pharmacology/, groups: ["antiarrhythmic"] },
  { match: /heart failure/, groups: ["heart-failure", "raas", "beta-blocker", "diuretics"] },
  { match: /autacoid/, groups: ["histamine-bradykinin", "antihistamine", "serotonin-drugs", "prostaglandin-drugs"] },
  { match: /histamine|bradykinin/, groups: ["histamine-bradykinin", "antihistamine", "h2-blocker"] },
  { match: /serotonin|5-ht|migraine/, groups: ["serotonin-drugs"] },
  { match: /antiemetic|antimetic|emesis|vomiting/, groups: ["antiemetic"] },
  { match: /prostaglandin|leukotriene|lipid derived|eicosanoid/, groups: ["prostaglandin-drugs", "leukotriene"] },
  { match: /nsaid|non-?opioid|analgesic|anti-?inflammatory drug/, groups: ["nsaid"] },
  { match: /gout/, groups: ["gout-drugs"] },
  { match: /immune modulating|immunosuppress|immunotherap|immunopharmacolog/, groups: ["immunosuppressant", "corticosteroid"] },
  { match: /chemotherapy of infection|drug resistance|antimicrobial/, groups: ["beta-lactam", "aminoglycoside", "quinolone", "macrolide"] },
  { match: /beta.?lactam|penicillin|cephalosporin/, groups: ["beta-lactam"] },
  { match: /quinolone/, groups: ["quinolone"] },
  { match: /aminoglycoside/, groups: ["aminoglycoside"] },
  { match: /tetracycline/, groups: ["tetracycline"] },
  { match: /chloramphenicol/, groups: ["chloramphenicol-class"] },
  { match: /sulphonamide|sulfonamide|trimethoprim/, groups: ["folate-antagonist"] },
  { match: /macrolide|lincosamide/, groups: ["macrolide"] },
  { match: /glycopeptide/, groups: ["glycopeptide"] },
  { match: /newer antibacterial/, groups: ["newer-antibacterial", "nitroimidazole"] },
  { match: /antimycobacterial|antitubercul|anti-?tb|tuberculosis/, groups: ["anti-tb"] },
  { match: /lepros/, groups: ["anti-leprosy"] },
  { match: /antifungal|mycos/, groups: ["antifungal"] },
  { match: /malaria/, groups: ["antimalarial"] },
  { match: /amoebiasis|giardia|trichomon/, groups: ["nitroimidazole", "antiprotozoal"] },
  { match: /leishmania|trypanosom|antiprotozo/, groups: ["antiprotozoal"] },
  { match: /antiviral|interferon|hbv|hepatitis|herpes|non-hiv/, groups: ["anti-herpes", "anti-influenza-hepatitis"] },
  { match: /antiretroviral|(?<!non-)\bhiv\b/, groups: ["antiretroviral"] },
  { match: /anthelmin|antihelmin|worm/, groups: ["anthelmintic"] },
  { match: /cancer|cytotoxic|alkylating|microtubule|antimetabolite|cell cycle|chemotherapy$/, groups: ["alkylating", "antimetabolite", "microtubule", "cytotoxic-antibiotic", "hormonal-cancer", "chemo-supportive"] },
  { match: /hypothalamic|pituitary/, groups: ["pituitary-drugs"] },
  { match: /adrenocortical|corticosteroid|adrenal/, groups: ["corticosteroid"] },
  { match: /gonadal|sex hormone|contracept/, groups: ["sex-hormones"] },
  { match: /pancreatic hormone|antidiabetic|diabet|insulin/, groups: ["insulin", "oral-hypoglycaemic"] },
  { match: /thyroid/, groups: ["thyroid-drugs"] },
  { match: /endocrine|metabolism/, groups: ["insulin", "oral-hypoglycaemic", "thyroid-drugs", "corticosteroid", "bone-drugs"] },
  { match: /introduction to cns|sedative|hypnotic|anxiolytic/, groups: ["sedative-hypnotic"] },
  { match: /anticonvulsant|antiepileptic|epilep/, groups: ["antiepileptic"] },
  { match: /opioid/, groups: ["opioid"] },
  { match: /anaesthetic|anesthetic|anaesthesia|anesthesia/, groups: ["general-anaesthetic", "local-anaesthetic"] },
  { match: /antidepressant/, groups: ["antidepressant", "mood-stabiliser"] },
  { match: /antipsychotic/, groups: ["antipsychotic"] },
  { match: /muscle relaxant/, groups: ["muscle-relaxant", "nm-blocker"] },
  { match: /alzheimer|dementia/, groups: ["dementia-drugs"] },
  { match: /parkinson/, groups: ["antiparkinson"] },
  { match: /anticoagulant|antiplatelet|thrombo/, groups: ["anticoagulant", "antiplatelet", "fibrinolytic"] },
  { match: /lipid metabolism|lipid|cholesterol/, groups: ["lipid"] },
  { match: /inflammatory bowel|\bibd/, groups: ["ibd-drugs"] },
  { match: /\bgit\b|gastro|peptic|ulcer|laxative|diarrhoea/, groups: ["ppi", "h2-blocker", "mucosal-protectant", "laxative", "antidiarrhoeal"] },
  { match: /\bresp|asthma|copd/, groups: ["inhaled-steroid", "beta2-agonist", "methylxanthine", "leukotriene", "antitussive"] },
  { match: /anaemia|haematinic/, groups: ["haematinic"] },
  { match: /toxicolog|poison|heavy metal|decontamination|pollutant|radiation/, groups: ["antidote"] },
  { match: /insecticide|herbicide|organophosph/, groups: ["anticholinesterase", "cholinesterase-reactivator", "antidote"] },
];

// Drug-group keys for one topic title; [] for principles topics or no match.
export function groupsForTopic(title: string) {
  const t = title.toLowerCase();
  const out = new Set<string>();
  for (const r of SYLLABUS_RULES) if (r.match.test(t)) r.groups.forEach((g) => out.add(g));
  return [...out];
}
