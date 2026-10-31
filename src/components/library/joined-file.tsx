"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { PdfViewer } from "@/components/library/pdf-viewer";

// Big uploads are stored in pieces (see lib/library.ts). These join the pieces back into the original file
// in the browser, byte for byte, to show or download it.
export async function joinParts(urls: string[], type: string) {
  const blobs: Blob[] = [];
  for (const u of urls) {
    const res = await fetch(u);
    if (!res.ok) throw new Error("Couldn't load part of the file.");
    blobs.push(await res.blob());
  }
  return new Blob(blobs, { type });
}

export function JoinedPdfViewer({ urls, startPage }: { urls: string[]; startPage?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let cancelled = false;
    joinParts(urls, "application/pdf")
      .then((b) => {
        made = URL.createObjectURL(b);
        if (!cancelled) setUrl(made);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [urls]);
  if (error) return <p className="p-4 text-sm text-danger">{error}</p>;
  if (!url)
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" /> Loading the full file ({urls.length} parts)…
      </p>
    );
  return <PdfViewer url={url} startPage={startPage} />;
}

export function JoinedDownload({ urls, name, type }: { urls: string[]; name: string; type: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const blob = await joinParts(urls, type);
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download
    </button>
  );
}
