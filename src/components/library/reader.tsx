"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentProps } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText, Minus, MonitorPlay, Plus, Sparkles, X } from "lucide-react";
import { PdfViewer } from "@/components/library/pdf-viewer";
import { JoinedPdfViewer } from "@/components/library/joined-file";
import { BackButton } from "@/components/back-button";
import { cx } from "@/components/ui";

type Page = { page: number; text: string };
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

// The reading view: the file itself (slides) or its text page by page, in a clean full-screen layout.
// Remembers where you stopped in each file and your text size; reads several selected files in a row.
// Drawn in the browser only, since where you stopped is kept on this device.
export function Reader(props: ComponentProps<typeof ReaderInner>) {
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return ready ? <ReaderInner {...props} /> : <div className="h-[60dvh]" aria-busy="true" />;
}

function ReaderInner({
  ids,
  names,
  index,
  file,
  pages,
  visual,
  startPage,
}: {
  ids: string[];
  names: string[];
  index: number;
  file: { id: string; name: string; status: string; pageCount: number; slides: boolean };
  pages: Page[];
  visual: { kind: "pdf" | "image" | "drive"; url: string; parts?: string[] } | null;
  startPage: number;
}) {
  const router = useRouter();
  const unit = file.slides ? "Slide" : "Page";
  // Where you stopped last time in this file (unless a page was asked for).
  const [at, setAt] = useState(() => {
    const saved = Number(store.get(`lengible:read:${file.id}`)) || 0;
    const want = startPage || saved;
    const k = want ? pages.findIndex((p) => p.page >= want) : 0;
    return Math.max(0, k);
  });
  const [mode, setMode] = useState<"text" | "slides">(() => (visual && (store.get("lengible:read-mode") ?? "text") === "slides" ? "slides" : "text"));
  const [size, setSize] = useState(() => Number(store.get("lengible:read-size")) || 18);
  const current = pages[at];

  useEffect(() => {
    if (current) store.set(`lengible:read:${file.id}`, String(current.page));
  }, [current, file.id]);
  useEffect(() => store.set("lengible:read-size", String(size)), [size]);
  useEffect(() => store.set("lengible:read-mode", mode), [mode]);

  const go = (k: number) => setAt(Math.max(0, Math.min(pages.length - 1, k)));
  const openFile = (k: number) => router.push(`/read?files=${ids.join(",")}&i=${k}`);
  // Arrow keys turn pages; at the end of a file, on to the next selected one.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") {
        if (at < pages.length - 1) go(at + 1);
        else if (index < ids.length - 1) openFile(index + 1);
      }
      if (e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // Paragraphs and bullet lines kept as written.
  const blocks = useMemo(() => (current?.text ?? "").split(/\n{2,}/).map((b) => b.split("\n")), [current]);
  const progress = pages.length ? Math.round(((at + 1) / pages.length) * 100) : 0;

  return (
    <div className="flex h-[calc(100dvh-56px-64px-env(safe-area-inset-bottom,0px))] flex-col overflow-hidden bg-bg md:h-[calc(100dvh-2rem)] md:rounded-2xl md:border md:border-border">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <BackButton />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{file.name}</p>
          <p className="text-xs text-muted">
            {ids.length > 1 ? `File ${index + 1} of ${ids.length} · ` : ""}
            {mode === "text" && current ? `${unit} ${current.page}${file.pageCount ? ` of ${file.pageCount}` : ""}` : visual ? "Original" : ""}
          </p>
        </div>
        {visual && (
          <div className="flex rounded-full bg-surface-2 p-0.5 text-xs font-medium">
            <button type="button" onClick={() => setMode("text")} className={cx("inline-flex items-center gap-1 rounded-full px-3 py-1", mode === "text" ? "bg-surface text-brand shadow-sm" : "text-muted")} aria-pressed={mode === "text"}>
              <FileText size={13} /> Text
            </button>
            <button type="button" onClick={() => setMode("slides")} className={cx("inline-flex items-center gap-1 rounded-full px-3 py-1", mode === "slides" ? "bg-surface text-brand shadow-sm" : "text-muted")} aria-pressed={mode === "slides"}>
              <MonitorPlay size={13} /> {file.slides ? "Slides" : "Original"}
            </button>
          </div>
        )}
        {mode === "text" && (
          <div className="flex items-center rounded-full bg-surface-2 text-muted">
            <button type="button" onClick={() => setSize((s) => Math.max(14, s - 2))} className="grid size-8 place-items-center rounded-full hover:text-text" aria-label="Smaller text">
              <Minus size={14} />
            </button>
            <span className="w-7 text-center text-xs">{size}</span>
            <button type="button" onClick={() => setSize((s) => Math.min(30, s + 2))} className="grid size-8 place-items-center rounded-full hover:text-text" aria-label="Bigger text">
              <Plus size={14} />
            </button>
          </div>
        )}
        <Link
          href={`/ally?q=${encodeURIComponent(current ? `Explain ${unit.toLowerCase()} ${current.page} of “${file.name}” in simple terms, and how it links to other topics.` : `Summarise “${file.name}”.`)}`}
          className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand-strong"
        >
          <Sparkles size={13} /> Ask Ally
        </Link>
        <Link href={`/library/file/${file.id}`} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2" aria-label="Close reader" title="Close reader">
          <X size={16} />
        </Link>
      </header>
      {/* How far through the file you are. */}
      <div className="h-1 bg-surface-2">
        <div className="h-full bg-brand transition-[width]" style={{ width: `${mode === "text" ? progress : 0}%` }} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === "slides" && visual ? (
          visual.kind === "pdf" && visual.parts?.length ? (
            <JoinedPdfViewer urls={visual.parts} startPage={current?.page ?? 1} />
          ) : visual.kind === "pdf" ? (
            <PdfViewer url={visual.url} startPage={current?.page ?? 1} />
          ) : visual.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={visual.url} alt={file.name} className="mx-auto max-h-full w-auto" />
          ) : (
            <iframe src={visual.url} title={file.name} className="h-full w-full border-0" allow="autoplay" />
          )
        ) : current ? (
          <article className="mx-auto max-w-2xl px-5 py-8" style={{ fontSize: size, lineHeight: 1.65 }}>
            <p className="mb-4 text-xs font-semibold tracking-wide text-muted uppercase" style={{ fontSize: 12 }}>
              {unit} {current.page}
            </p>
            {blocks.map((lines, k) => (
              <p key={k} className={cx("mb-4", k === 0 && "font-semibold")}>
                {lines.map((l, j) => (
                  <span key={j} className={cx("block", /^Image:/.test(l) && "mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[0.85em] text-muted", /^Notes:/.test(l) && "mt-2 border-l-2 border-brand pl-3 text-[0.9em] text-muted")}>
                    {l}
                  </span>
                ))}
              </p>
            ))}
          </article>
        ) : (
          <div className="mx-auto max-w-md px-5 py-16 text-center text-sm text-muted">
            {file.status === "uploaded" ? "This file isn't processed yet, so there's no text to read. Process it, or switch to the original." : "No text on this file."}
          </div>
        )}
      </div>

      {mode === "text" && pages.length > 0 && (
        <footer className="flex items-center gap-2 border-t border-border px-3 py-2">
          <button type="button" onClick={() => go(at - 1)} disabled={at === 0} className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-40">
            <ChevronLeft size={16} /> Previous
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, pages.length - 1)}
            value={at}
            onChange={(e) => go(Number(e.target.value))}
            className="min-w-0 flex-1 accent-[var(--brand)]"
            aria-label={`Go to ${unit.toLowerCase()}`}
          />
          {at < pages.length - 1 ? (
            <button type="button" onClick={() => go(at + 1)} className="inline-flex items-center gap-1 rounded-full bg-brand px-4 py-2 text-sm font-medium text-on-brand">
              Next <ChevronRight size={16} />
            </button>
          ) : index < ids.length - 1 ? (
            <button type="button" onClick={() => openFile(index + 1)} className="inline-flex max-w-[50%] items-center gap-1 truncate rounded-full bg-brand px-4 py-2 text-sm font-medium text-on-brand">
              Next file: {names[index + 1]} <ChevronRight size={16} className="shrink-0" />
            </button>
          ) : (
            <span className="px-3 text-sm text-ok">Finished</span>
          )}
        </footer>
      )}
      {ids.length > 1 && mode === "slides" && (
        <footer className="flex items-center justify-between border-t border-border px-3 py-2 text-sm">
          <button type="button" disabled={index === 0} onClick={() => openFile(index - 1)} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 hover:bg-surface-2 disabled:opacity-40">
            <ChevronLeft size={16} /> Previous file
          </button>
          <button type="button" disabled={index >= ids.length - 1} onClick={() => openFile(index + 1)} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 hover:bg-surface-2 disabled:opacity-40">
            Next file <ChevronRight size={16} />
          </button>
        </footer>
      )}
    </div>
  );
}
