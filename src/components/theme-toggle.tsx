"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { applyTheme, readTheme, type ThemePref } from "@/components/theme";
import { cx } from "@/components/ui";

const options: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Monitor },
];

// Three-way switch: Light / Dark / Auto (follow the device).
export function ThemeToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const [pref, setPref] = useState<ThemePref>("system");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read the saved choice after mount
  useEffect(() => setPref(readTheme()), []);

  if (compact) {
    const next = pref === "light" ? "dark" : pref === "dark" ? "system" : "light";
    const Icon = options.find((o) => o.value === pref)!.icon;
    return (
      <button
        type="button"
        title={`Theme: ${pref}. Tap for ${next}.`}
        onClick={() => {
          applyTheme(next);
          setPref(next);
        }}
        className={cx("grid size-10 place-items-center rounded-xl hover:bg-white/10", className)}
      >
        <Icon size={18} />
      </button>
    );
  }

  return (
    <div role="radiogroup" aria-label="Theme" className={cx("grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1", className)}>
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          onClick={() => {
            applyTheme(value);
            setPref(value);
          }}
          className={cx(
            "flex min-h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium",
            pref === value ? "bg-surface text-brand shadow-sm" : "text-muted",
          )}
        >
          <Icon size={16} /> {label}
        </button>
      ))}
    </div>
  );
}
