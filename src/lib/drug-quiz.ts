import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Difficulty, Drug, DrugClass, Question, QuizSettings } from "@/lib/supabase/types";
import { syllabusCoverage } from "@/lib/syllabus-coverage";

type DB = SupabaseClient<Database>;

// Drug quizzes are built from your own drug database, so they need no AI and every answer
// can be checked on the drug's page.
export const DRUG_QUIZ_TYPES = [
  { value: "class", label: "Name the class", hint: "Which group does this drug belong to?" },
  { value: "mechanism", label: "Drug ↔ mechanism", hint: "Which drug works this way?" },
  { value: "odd", label: "Odd one out", hint: "Which drug is not like the others?" },
  { value: "side_effects", label: "Side-effect profile", hint: "Which drug causes these effects?" },
  { value: "suffix", label: "Suffix → class", hint: "-olol, -pril, -azole…" },
] as const;
export type DrugQuizType = (typeof DRUG_QUIZ_TYPES)[number]["value"];

type D = Pick<Drug, "id" | "name" | "class_id" | "is_prototype" | "mechanism" | "side_effects" | "brands" | "verified">;
type Row = Database["public"]["Tables"]["questions"]["Insert"];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Hides the drug's own name (and its brands) inside a clue.
function mask(text: string, d: D) {
  // The name, its brands, and for combinations each part ("Co-amoxiclav (amoxicillin + clavulanic acid)").
  const inBrackets = d.name.match(/\((.*)\)/)?.[1] ?? "";
  const names = [d.name.replace(/\s*\(.*\)/, ""), ...inBrackets.split(/\s*[+,/]\s*|\s+and\s+/), ...d.name.replace(/\s*\(.*\)/, "").split(/\s*[+/–-]\s*/), ...d.brands];
  let out = text;
  for (const n of names.map((x) => x.trim()).filter((x) => x.length >= 3).sort((a, b) => b.length - a.length))
    out = out.replace(new RegExp(`\\b${escape(n)}\\b`, "gi"), "this drug");
  return out.replace(/this drug(\s+(plus|and|\+)\s+this drug)+/gi, "this combination");
}
// "-olol", "-pril" … from a group's naming clue.
const suffixesOf = (tip: string | null) => [...(tip ?? "").matchAll(/(?:^|[\s(,/'"“])-([a-z]{3,})\b/gi)].map((m) => `-${m[1].toLowerCase()}`);

export async function buildDrugQuiz(supabase: DB, opts: { types: DrugQuizType[]; scope: string; count: number; difficulty: Difficulty }) {
  const [{ data: classRows }, { data: drugRows }, { data: course }] = await Promise.all([
    supabase.from("drug_classes").select("*"),
    supabase.from("drugs").select("id, name, class_id, is_prototype, mechanism, side_effects, brands, verified").limit(2000),
    supabase.from("courses").select("id").eq("kind", "pharmacology").eq("is_group", false).order("sort_order").limit(1),
  ]);
  const classes = (classRows ?? []) as DrugClass[];
  const allDrugs = (drugRows ?? []) as D[];
  if (!allDrugs.length) throw new Error("Your drug database is empty. Load it on the Drugs page first.");
  const byId = new Map(classes.map((c) => [c.id, c]));
  const kids = new Map<string, string[]>();
  for (const c of classes) if (c.parent_id) kids.set(c.parent_id, [...(kids.get(c.parent_id) ?? []), c.id]);
  const below = (id: string): string[] => [id, ...(kids.get(id) ?? []).flatMap(below)];
  const above = (id: string): string[] => {
    const out: string[] = [];
    for (let c = byId.get(id); c; c = c.parent_id ? byId.get(c.parent_id) : undefined) out.push(c.id);
    return out;
  };
  const related = (a: string, b: string) => above(a).includes(b) || above(b).includes(a);

  // Which groups the quiz covers.
  let inScope: Set<string>;
  if (opts.scope === "all") inScope = new Set(classes.map((c) => c.id));
  else if (opts.scope === "syllabus") {
    const cov = (await syllabusCoverage(supabase)).byClass;
    inScope = new Set(Object.keys(cov));
    if (!inScope.size) throw new Error("No syllabus groups found. Import your Pharmacology topic list, or choose “All drugs”.");
  } else inScope = new Set(below(opts.scope));
  const drugs = allDrugs.filter((d) => inScope.has(d.class_id));
  if (drugs.length < 2) throw new Error("Not enough drugs in this group for a quiz.");
  const system = (classId: string) => byId.get(classId)?.system;
  const hard = opts.difficulty === "hard";
  const easy = opts.difficulty === "easy";

  // Distractor drugs from other groups: hard → same system (close), easy → other systems.
  const otherDrugs = (d: D, n: number) => {
    const pool = allDrugs.filter((x) => x.class_id !== d.class_id && !related(x.class_id, d.class_id));
    const near = pool.filter((x) => system(x.class_id) === system(d.class_id));
    const far = pool.filter((x) => system(x.class_id) !== system(d.class_id));
    const ordered = hard ? [...shuffle(near), ...shuffle(far)] : easy ? [...shuffle(far), ...shuffle(near)] : shuffle(pool);
    const out: D[] = [];
    for (const x of ordered) if (!out.some((o) => o.class_id === x.class_id) && out.length < n) out.push(x);
    return out;
  };
  const otherClasses = (classId: string, n: number, among = classes) => {
    const pool = among.filter((c) => c.id !== classId && !related(c.id, classId) && allDrugs.some((x) => below(c.id).includes(x.class_id)));
    const near = pool.filter((c) => c.system === system(classId));
    const ordered = hard ? [...shuffle(near), ...shuffle(pool)] : easy ? shuffle(pool.filter((c) => c.system !== system(classId))).concat(shuffle(near)) : shuffle(pool);
    return [...new Map(ordered.map((c) => [c.id, c])).values()].slice(0, n);
  };
  const base = (d: D | null, classId: string, type: DrugQuizType): Partial<Row> => ({
    course_id: course?.[0]?.id ?? null,
    format: "mcq",
    difficulty: opts.difficulty,
    source_kind: "drugs",
    source_label: d ? `Your drug database · ${d.name}${d.verified ? " (verified by you)" : " (needs verification)"}` : `Your drug database · ${byId.get(classId)?.name}`,
    topic_name: byId.get(classId)?.name ?? null,
    drug_class_id: classId,
    flag_note: null,
    topic_id: null,
    // why_wrong keeps which kind of drug question this is, for the review screen.
    why_wrong: { type },
  });
  const mcq = (correct: string, wrong: string[]) => {
    const options = shuffle([correct, ...wrong]);
    return { options, answer: options.indexOf(correct) };
  };

  const makers: Record<DrugQuizType, () => Row | null> = {
    class: () => {
      const d = pick(drugs);
      const wrong = otherClasses(d.class_id, 4).map((c) => c.name);
      if (wrong.length < 3) return null;
      const cls = byId.get(d.class_id)!;
      return {
        ...base(d, d.class_id, "class"),
        stem: `${d.name} belongs to which drug group?`,
        ...mcq(cls.name, wrong),
        explanation: `${d.name} is ${d.is_prototype ? "the prototype of" : "a member of"} ${above(d.class_id).reverse().map((id) => byId.get(id)?.name).join(" › ")}.${cls.recognition_tip ? ` Spot it: ${cls.recognition_tip}` : ""}`,
      } as Row;
    },
    mechanism: () => {
      const d = pick(drugs.filter((x) => x.mechanism));
      if (!d) return null;
      const wrong = otherDrugs(d, 4).map((x) => x.name);
      if (wrong.length < 3) return null;
      return {
        ...base(d, d.class_id, "mechanism"),
        stem: `Which drug works like this? “${mask(d.mechanism!, d)}”`,
        ...mcq(d.name, wrong),
        explanation: `${d.name} (${byId.get(d.class_id)?.name}): ${d.mechanism}`,
      } as Row;
    },
    odd: () => {
      // Four from one group (with its subgroups), one from elsewhere.
      const groups = classes.filter((c) => inScope.has(c.id) && allDrugs.filter((x) => below(c.id).includes(x.class_id)).length >= 3);
      if (!groups.length) return null;
      const g = pick(groups);
      const members = shuffle(allDrugs.filter((x) => below(g.id).includes(x.class_id))).slice(0, 4);
      const odd = otherDrugs(members[0], 1)[0];
      if (!odd || members.length < 3) return null;
      return {
        ...base(odd, g.id, "odd"),
        stem: "Which drug is the odd one out?",
        ...mcq(odd.name, members.map((m) => m.name)),
        explanation: `${odd.name} is ${byId.get(odd.class_id)?.name}; the others are all ${g.name}.`,
      } as Row;
    },
    side_effects: () => {
      const d = pick(drugs.filter((x) => x.side_effects.length >= 2));
      if (!d) return null;
      const wrong = otherDrugs(d, 4).map((x) => x.name);
      if (wrong.length < 3) return null;
      const effects = d.side_effects.slice(0, hard ? 2 : 3).map((x) => mask(x, d));
      return {
        ...base(d, d.class_id, "side_effects"),
        stem: `Which drug is most likely to cause: ${effects.join("; ")}?`,
        ...mcq(d.name, wrong),
        explanation: `${d.name} (${byId.get(d.class_id)?.name}). Important side effects: ${d.side_effects.join("; ")}.`,
      } as Row;
    },
    suffix: () => {
      // Only suffixes that point to one group.
      const owners = new Map<string, Set<string>>();
      for (const c of classes) for (const s of suffixesOf(c.recognition_tip)) owners.set(s, new Set([...(owners.get(s) ?? []), c.id]));
      const usable = [...owners.entries()].filter(([, ids]) => ids.size === 1).map(([s, ids]) => ({ s, c: byId.get([...ids][0])! }));
      const pool = usable.filter((u) => below(u.c.id).some((id) => inScope.has(id)) || inScope.has(u.c.id));
      const u = pick(pool.length ? pool : usable);
      if (!u) return null;
      const withSuffix = usable.map((x) => x.c);
      const wrong = otherClasses(u.c.id, 4, withSuffix).map((c) => c.name);
      if (wrong.length < 3) return null;
      const examples = allDrugs.filter((x) => below(u.c.id).includes(x.class_id) && x.name.toLowerCase().includes(u.s.slice(1))).slice(0, 3).map((x) => x.name);
      return {
        ...base(null, u.c.id, "suffix"),
        stem: `A drug whose name ends in “${u.s}” is most likely in which group?`,
        ...mcq(u.c.name, wrong),
        explanation: `${u.c.recognition_tip ?? ""}${examples.length ? ` Examples: ${examples.join(", ")}.` : ""}`.trim(),
      } as Row;
    },
  };

  const types = opts.types.length ? opts.types : DRUG_QUIZ_TYPES.map((t) => t.value);
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (let tries = 0; rows.length < opts.count && tries < opts.count * 12; tries++) {
    // Rotate through the types; a type that can't make a question this time is skipped.
    const r = makers[types[tries % types.length]]();
    const key = r && `${r.stem}|${[...(r.options as string[])].sort().join("|")}`;
    if (!r || !key || seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
  }
  if (!rows.length) throw new Error("Couldn't build questions for this choice. Try another group or quiz type.");
  return rows;
}

export async function createDrugQuizSession(
  supabase: DB,
  opts: { types: DrugQuizType[]; scope: string; count: number; difficulty: Difficulty; mode?: "drugs" | "group"; title?: string },
) {
  const rows = await buildDrugQuiz(supabase, opts);
  const { data: saved, error } = await supabase.from("questions").insert(rows).select("id");
  if (error) throw new Error(error.message);
  const settings: QuizSettings = {
    formats: ["mcq"],
    difficulty: opts.difficulty,
    course_ids: [],
    topics: [],
    source: "mixed",
    count: rows.length,
    timed: false,
    negative_marking: false,
    drug_types: opts.types,
    scope: opts.scope,
  };
  const { data, error: e2 } = await supabase
    .from("quiz_sessions")
    .insert({ mode: opts.mode ?? "drugs", title: opts.title ?? "Drug quiz", settings, question_ids: (saved ?? []).map((r) => r.id) })
    .select("id")
    .single();
  if (e2) throw new Error(e2.message);
  return data.id;
}

export const drugQuizKind = (q: Pick<Question, "why_wrong">) => (q.why_wrong as { type?: string } | null)?.type;
