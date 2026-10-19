"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";

// Renders a PDF with PDF.js, one canvas per page, drawing pages only as they scroll into view
// so long textbooks stay fast on a phone.
export function PdfViewer({ url, startPage = 1 }: { url: string; startPage?: number }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ url });
        destroy = () => void task.destroy();
        const d = await task.promise;
        if (!cancelled) setDoc(d);
      } catch {
        if (!cancelled) setError("Couldn't open this PDF here. Use “Open in another app” instead.");
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url]);

  useEffect(() => {
    if (doc && startPage > 1) {
      setTimeout(() => box.current?.querySelector(`[data-page="${startPage}"]`)?.scrollIntoView({ block: "start" }), 300);
    }
  }, [doc, startPage]);

  if (error) return <p className="p-4 text-sm text-danger">{error}</p>;
  if (!doc)
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" /> Opening PDF…
      </p>
    );

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-end gap-1 border-b border-border bg-surface/95 px-2 py-1 backdrop-blur">
        <span className="mr-auto pl-2 text-xs text-muted">{doc.numPages} pages</span>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))} className="grid size-9 place-items-center rounded-lg hover:bg-surface-2">
          <ZoomOut size={18} />
        </button>
        <span className="w-12 text-center text-xs">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.2))} className="grid size-9 place-items-center rounded-lg hover:bg-surface-2">
          <ZoomIn size={18} />
        </button>
      </div>
      <div ref={box} className="max-h-[75dvh] overflow-auto bg-surface-2 p-2">
        {Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={i} doc={doc} n={i + 1} zoom={zoom} />
        ))}
      </div>
    </div>
  );
}

function PdfPage({ doc, n, zoom }: { doc: PDFDocumentProxy; n: number; zoom: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [aspect, setAspect] = useState(1.414);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let task: { cancel(): void } | undefined;
    (async () => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      setAspect(base.height / base.width);
      const width = (holder.current?.clientWidth ?? 600) * zoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (width / base.width) * dpr });
      const c = canvas.current;
      if (!c) return;
      c.width = viewport.width;
      c.height = viewport.height;
      c.style.width = `${width}px`;
      task = page.render({ canvas: c, viewport });
      await (task as unknown as { promise: Promise<void> }).promise.catch(() => {});
    })();
    return () => task?.cancel();
  }, [visible, zoom, doc, n]);

  return (
    <div ref={holder} data-page={n} className="mx-auto mb-2 w-full">
      <div className="overflow-x-auto">
        <canvas
          ref={canvas}
          className="mx-auto block bg-white shadow"
          style={{ aspectRatio: visible ? undefined : `1 / ${aspect}`, width: visible ? undefined : `${zoom * 100}%` }}
        />
      </div>
      <p className="mt-1 text-center text-[11px] text-muted">Page {n}</p>
    </div>
  );
}
