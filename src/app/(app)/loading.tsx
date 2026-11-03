// Shown the moment you tap a link or button that opens another page, while that page is fetched,
// so every tap answers straight away (the menu and processing panel stay in place).
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full w-1/3 animate-[loading_1s_ease-in-out_infinite] rounded-full bg-brand" />
      </div>
      <div className="h-7 w-48 animate-pulse rounded-lg bg-surface-2" />
      <div className="h-4 w-72 max-w-full animate-pulse rounded bg-surface-2" />
      <div className="space-y-2 pt-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
