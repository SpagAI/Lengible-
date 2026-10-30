"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cx } from "@/components/ui";

// A small ⓘ next to a control: tap (or hover, or focus) to see a short explanation.
// Tapping outside or pressing Escape closes it.
export function InfoTip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  // Shifted sideways (in px, from the icon's left edge) so the box always fits on screen.
  const [shift, setShift] = useState(0);
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = pinned || hover;

  useEffect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setPinned(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [pinned]);

  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(288, window.innerWidth - 32);
    const left = Math.min(Math.max(r.left, 16), window.innerWidth - 16 - width);
    setShift(left - r.left);
  };

  return (
    <span
      ref={box}
      className={cx("relative inline-flex align-middle", className)}
      onMouseEnter={() => {
        place();
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={() => {
          place();
          setPinned((p) => !p);
        }}
        onBlur={() => setHover(false)}
        className="grid size-6 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-brand focus-visible:text-brand"
        aria-label={`What does “${label}” do?`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
      >
        <Info size={15} />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          style={{ left: shift }}
          className="absolute top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-3 text-left text-xs leading-relaxed font-normal text-text shadow-lg"
        >
          <b className="mb-0.5 block text-sm">{label}</b>
          {children}
        </span>
      )}
    </span>
  );
}
