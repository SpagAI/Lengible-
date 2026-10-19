// Search snippets come back with <<matched words>>; show them in bold.
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/<<|>>/);
  return (
    <span className="text-sm text-muted">
      …
      {parts.map((p, i) =>
        i % 2 ? (
          <mark key={i} className="rounded bg-brand-soft px-0.5 font-medium text-text">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
      …
    </span>
  );
}
