import Link from "next/link";
import type { Concept } from "@/lib/supabase/types";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Shows extracted text with every known drug/disease/organism turned into a link to its cross-course page.
export function LinkedText({ text, concepts }: { text: string; concepts: Concept[] }) {
  const terms = concepts
    .flatMap((c) => [c.name, ...c.aliases].map((t) => ({ t: t.toLowerCase(), id: c.id })))
    .filter((x) => x.t.length > 2)
    .sort((a, b) => b.t.length - a.t.length);
  if (!terms.length) return <p className="text-sm whitespace-pre-wrap">{text}</p>;
  const idFor = new Map(terms.map((x) => [x.t, x.id]));
  const re = new RegExp(`\\b(${terms.map((x) => escape(x.t)).join("|")})\\b`, "gi");
  const parts = text.split(re);
  return (
    <p className="text-sm whitespace-pre-wrap">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Link key={i} href={`/library/concept/${idFor.get(part.toLowerCase())}`} className="font-medium text-brand underline decoration-brand/40 underline-offset-2">
            {part}
          </Link>
        ) : (
          part
        ),
      )}
    </p>
  );
}
