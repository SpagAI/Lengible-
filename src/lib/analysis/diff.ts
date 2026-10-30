// Compares a new version of a timetable or topic list with what is already in your courses,
// so a re-import shows exactly what changed (and small topic corrections rename instead of duplicate).

export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/(\w)-(\w)/g, "$1$2")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|of|and|in|to|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// How alike two names are, 0–1 (shared words, allowing small spelling differences).
export function similarity(a: string, b: string) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const wa = x.split(" ");
  const wb = y.split(" ");
  const close = (p: string, q: string) => p === q || (p.length > 4 && q.length > 4 && (p.startsWith(q.slice(0, -1)) || q.startsWith(p.slice(0, -1)) || editDistance(p, q) <= 1));
  const hits = wa.filter((w) => wb.some((v) => close(w, v))).length;
  return (2 * hits) / (wa.length + wb.length);
}

// Share of the shorter name's words found (allowing small spelling differences) in the longer one.
// 1 means one name is the other with words added or corrected, e.g. "Antiviral agents" → "Antiviral agents (non-HIV)".
export function containment(a: string, b: string) {
  const [x, y] = [normName(a).split(" ").filter(Boolean), normName(b).split(" ").filter(Boolean)].sort((p, q) => p.length - q.length);
  if (!x.length) return 0;
  const close = (p: string, q: string) => p === q || (p.length > 4 && q.length > 4 && editDistance(p, q) <= Math.max(1, Math.floor(Math.min(p.length, q.length) / 6)));
  return x.filter((w) => y.some((v) => close(w, v))).length / x.length;
}

function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// ——— Timetables ———

export type OldSession = { id: string; course_id: string; session_date: string; start_time: string | null; end_time: string | null; title: string; venue: string | null; lecturer: string | null; topic_id: string | null };
export type NewSession = { i: number; courseId: string | null; date: string | null; start: string | null; end: string | null; title: string; venue: string | null; lecturer: string | null };
export type SessionChange =
  | { kind: "same"; i: number }
  | { kind: "new"; i: number }
  | { kind: "changed"; i: number; old: OldSession; what: string[] }
  | { kind: "moved"; i: number; old: OldSession; what: string[] }
  | { kind: "renamed"; i: number; old: OldSession; what: string[] };

const t = (x: string | null | undefined) => (x ?? "").slice(0, 5);

export function diffSessions(next: NewSession[], old: OldSession[]) {
  const left = new Set(old.map((o) => o.id));
  const take = (o: OldSession | undefined) => (o && left.has(o.id) ? (left.delete(o.id), o) : undefined);
  const details = (o: OldSession, s: NewSession) => {
    const what: string[] = [];
    if (o.session_date !== s.date) what.push(`date ${o.session_date} → ${s.date}`);
    if (t(o.start_time) !== t(s.start) || t(o.end_time) !== t(s.end)) what.push(`time ${t(o.start_time) || "?"}–${t(o.end_time) || "?"} → ${t(s.start) || "?"}–${t(s.end) || "?"}`);
    if ((o.venue ?? "") !== (s.venue ?? "") && s.venue) what.push(`venue → ${s.venue}`);
    if ((o.lecturer ?? "") !== (s.lecturer ?? "") && s.lecturer) what.push(`lecturer → ${s.lecturer}`);
    return what;
  };
  const changes: SessionChange[] = next.map((s) => {
    const pool = old.filter((o) => left.has(o.id) && o.course_id === s.courseId);
    // Same day and title.
    const same = take(pool.find((o) => o.session_date === s.date && normName(o.title) === normName(s.title)));
    if (same) {
      const what = details(same, s);
      return what.length ? { kind: "changed", i: s.i, old: same, what } : { kind: "same", i: s.i };
    }
    // Same title, another day: moved.
    const moved = take(pool.find((o) => normName(o.title) === normName(s.title)));
    if (moved) return { kind: "moved", i: s.i, old: moved, what: details(moved, s) };
    // Same day and start time, a slightly different title: renamed or corrected.
    const renamed = take(pool.find((o) => o.session_date === s.date && t(o.start_time) === t(s.start) && similarity(o.title, s.title) >= 0.4));
    if (renamed) return { kind: "renamed", i: s.i, old: renamed, what: [`“${renamed.title}” → “${s.title}”`, ...details(renamed, s)] };
    return { kind: "new", i: s.i };
  });
  return { changes, removed: old.filter((o) => left.has(o.id)) };
}

// ——— Topic lists ———

export type OldTopic = { id: string; course_id: string; name: string; source: string };
export type TopicChange = { i: number; kind: "same" | "new" | "renamed"; old?: OldTopic; score?: number };

export function diffTopics(next: { i: number; courseId: string | null; name: string }[], old: OldTopic[]) {
  const used = new Set<string>();
  const changes: TopicChange[] = next.map((n) => {
    const pool = old.filter((o) => o.course_id === n.courseId && !used.has(o.id));
    const exact = pool.find((o) => normName(o.name) === normName(n.name));
    if (exact) {
      used.add(exact.id);
      // Only punctuation or "&"/"and" differ: the same topic, keep its name.
      return { i: n.i, kind: "same", old: exact, score: 1 };
    }
    let best: OldTopic | undefined;
    let score = 0;
    for (const o of pool) {
      // Every word of one name in the other (spelling fixes, added qualifiers), not just some shared words.
      const sc = containment(o.name, n.name) === 1 ? similarity(o.name, n.name) + 0.5 : similarity(o.name, n.name) >= 0.85 ? similarity(o.name, n.name) : 0;
      if (sc > score) [best, score] = [o, sc];
    }
    // The same topic with a correction, not a new one.
    if (best && score > 0) {
      used.add(best.id);
      return { i: n.i, kind: "renamed", old: best, score };
    }
    return { i: n.i, kind: "new" };
  });
  const courses = new Set(next.map((n) => n.courseId));
  // Topics from earlier lists for these courses that this list no longer has.
  const missing = old.filter((o) => courses.has(o.course_id) && o.source === "list" && !used.has(o.id));
  return { changes, missing };
}
