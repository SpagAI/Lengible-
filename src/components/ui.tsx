import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

// Joins class names; later classes win over earlier ones (e.g. a custom background on a Card).
export function cx(...classes: (string | false | null | undefined)[]) {
  return twMerge(classes.filter(Boolean).join(" "));
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-2xl border border-border bg-surface p-4", className)} {...props} />;
}

const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors disabled:opacity-50";
const buttonVariants = {
  primary: "bg-brand text-on-brand hover:bg-brand-strong",
  secondary: "border border-border bg-surface hover:bg-surface-2",
  ghost: "hover:bg-surface-2",
  danger: "border border-border bg-surface text-danger hover:bg-surface-2",
};
type Variant = keyof typeof buttonVariants;

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(buttonBase, buttonVariants[variant], className)} {...props} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(buttonBase, buttonVariants[variant], className)} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full min-h-11 rounded-xl border border-border bg-surface px-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

// Accent colours for courses. Class names are spelled out so Tailwind keeps them.
export const courseColors: Record<string, { dot: string; soft: string }> = {
  teal: { dot: "bg-teal-500", soft: "bg-teal-500/10 text-teal-700 dark:text-teal-300" },
  rose: { dot: "bg-rose-500", soft: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  indigo: { dot: "bg-indigo-500", soft: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  amber: { dot: "bg-amber-500", soft: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  sky: { dot: "bg-sky-500", soft: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  violet: { dot: "bg-violet-500", soft: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
};
export const colorFor = (c: string) => courseColors[c] ?? courseColors.teal;
