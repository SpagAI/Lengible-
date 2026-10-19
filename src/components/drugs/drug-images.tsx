"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ExternalLink, Loader2, Search, Trash2 } from "lucide-react";
import { useSupabase } from "@/lib/supabase/client";
import { addDrugImage, deleteDrugImage } from "@/app/(app)/drugs/actions";
import { Button, Card } from "@/components/ui";
import type { DrugImage } from "@/lib/supabase/types";

type Shown = DrugImage & { src: string };
type Candidate = { url: string; name: string; title: string; sourceUrl: string };

// Real pill and packaging photos: official images from NIH DailyMed, or your own pictures
// (e.g. Nigerian brands from the pharmacy shelf). Every image shows where it came from.
export function DrugImages({ drugId, drugName, images }: { drugId: string; drugName: string; images: Shown[] }) {
  const supabase = useSupabase();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  async function findOfficial() {
    setBusy("search");
    setMessage(null);
    const res = await fetch(`/api/drugs/images?name=${encodeURIComponent(drugName)}`);
    const body = await res.json().catch(() => ({ status: "error", message: "No answer from the server." }));
    setBusy(null);
    if (body.status !== "ok") return setMessage(body.message);
    setCandidates(body.images);
    if (!body.images.length) setMessage("DailyMed has no label images for this name (common for drugs not sold in the US). Add your own photo instead.");
  }

  async function upload(file: File) {
    setBusy("upload");
    setMessage(null);
    const { data: auth } = await supabase.auth.getUser();
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${auth.user!.id}/drug-images/${drugId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("library").upload(path, file, { contentType: file.type || "image/jpeg" });
    if (error) {
      setBusy(null);
      return setMessage(`Upload failed: ${error.message}`);
    }
    const caption = prompt("Caption (optional), e.g. brand and where you saw it") ?? "";
    await addDrugImage({ drugId, storagePath: path, source: "My photo", caption: caption || undefined });
    setBusy(null);
    router.refresh();
  }

  return (
    <Card className="mt-3">
      <h2 className="mb-3 text-sm font-semibold text-muted">Pill & packaging images</h2>
      {images.length > 0 ? (
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((img) => (
            <figure key={img.id} className="overflow-hidden rounded-xl border border-border bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt={img.caption ?? drugName} className="aspect-square w-full bg-white object-contain" loading="lazy" />
              <figcaption className="space-y-0.5 p-2 text-[11px]">
                {img.caption && <p className="font-medium">{img.caption}</p>}
                <p className="text-muted">
                  Source:{" "}
                  {img.source_url ? (
                    <a href={img.source_url} target="_blank" rel="noreferrer" className="text-brand underline">
                      {img.source}
                    </a>
                  ) : (
                    img.source
                  )}
                </p>
                <form action={deleteDrugImage}>
                  <input type="hidden" name="id" value={img.id} />
                  <button className="inline-flex items-center gap-1 text-danger" onClick={(e) => !confirm("Remove this image?") && e.preventDefault()}>
                    <Trash2 size={12} /> Remove
                  </button>
                </form>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-sm text-muted">No images yet. Lengible never makes up pill pictures — only official label images or your own photos.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={findOfficial} disabled={!!busy}>
          {busy === "search" ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Find official images (DailyMed)
        </Button>
        <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={!!busy}>
          {busy === "upload" ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} Add my own photo
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) upload(f);
          }}
        />
      </div>
      {message && <p className="mt-2 text-sm text-muted">{message}</p>}

      {candidates && candidates.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-muted">From NIH DailyMed (US labels). Tap “Save” on the ones you want to keep.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {candidates.map((c) => (
              <figure key={c.url} className="overflow-hidden rounded-xl border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.url} alt={c.name} className="aspect-square w-full bg-white object-contain" loading="lazy" />
                <figcaption className="space-y-1 p-2 text-[11px]">
                  <p className="line-clamp-2 text-muted">{c.title}</p>
                  <div className="flex items-center justify-between">
                    <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand">
                      Label <ExternalLink size={10} />
                    </a>
                    <button
                      type="button"
                      className="rounded-lg bg-brand px-2 py-1 font-medium text-on-brand"
                      onClick={async () => {
                        await addDrugImage({ drugId, url: c.url, source: "NIH DailyMed", sourceUrl: c.sourceUrl, caption: c.title.slice(0, 120) });
                        setCandidates(candidates.filter((x) => x.url !== c.url));
                        router.refresh();
                      }}
                    >
                      Save
                    </button>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
