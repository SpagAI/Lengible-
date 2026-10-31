import { cx } from "@/components/ui";

// A small horizontal bar that fills with how much is done, with the percentage beside it:
// green at 100%, red when nothing is processed yet (or it failed), blue in between.
export function ProgressPct({ pct, failed, className, label }: { pct: number; failed?: boolean; className?: string; label?: string }) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const tone = failed || p === 0 ? "danger" : p === 100 ? "ok" : "brand";
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1.5", className)} title={label ?? `${p}% processed`}>
      <span
        className={cx("relative h-1.5 w-14 overflow-hidden rounded-full", tone === "danger" ? "bg-danger/25" : "bg-surface-2 ring-1 ring-border")}
        role="progressbar"
        aria-valuenow={p}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Processed"}
      >
        <span
          className={cx("absolute inset-y-0 left-0 rounded-full transition-[width] duration-500", tone === "ok" ? "bg-ok" : tone === "brand" ? "bg-brand" : "bg-danger")}
          style={{ width: `${p}%` }}
        />
      </span>
      <span className={cx("w-9 text-right text-[11px] font-semibold tabular-nums", tone === "ok" ? "text-ok" : tone === "brand" ? "text-brand" : "text-danger")}>
        {failed ? "Failed" : `${p}%`}
      </span>
    </span>
  );
}
