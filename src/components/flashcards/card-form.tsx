"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X } from "lucide-react";
import { useSupabase } from "@/lib/supabase/client";
import { saveCard } from "@/app/(app)/flashcards/actions";
import type { CardKind } from "@/lib/supabase/types";
import { Button, Field, inputClass, cx } from "@/components/ui";

type Initial = { id?: string; kind: CardKind; front: string; back: string; extra: string | null; image_path: string | null; image_url?: string | null };

// Add a card to a deck, or edit one. "Fill in the blank" cards hide words written as {{word}}.
export function CardForm({ deckId, initial, doneHref }: { deckId: string; initial?: Initial; doneHref?: string }) {
  const supabase = useSupabase();
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<CardKind>(initial?.kind === "cloze" ? "cloze" : "basic");
  const [image, setImage] = useState<{ path: string; url: string } | null>(
    initial?.image_path ? { path: initial.image_path, url: initial.image_url ?? "" } : null,
  );
  const [busy, setBusy] = useState<"save" | "upload" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();

  async function upload(file: File) {
    setBusy("upload");
    setMessage(undefined);
    const { data: auth } = await supabase.auth.getUser();
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${auth.user!.id}/cards/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("library").upload(path, file, { contentType: file.type || "image/jpeg" });
    setBusy(null);
    if (error) return setMessage({ ok: false, text: error.message });
    setImage({ path, url: URL.createObjectURL(file) });
  }

  return (
    <form
      ref={form}
      className="space-y-3"
      action={async (fd) => {
        setBusy("save");
        setMessage(undefined);
        const r = await saveCard(fd);
        setBusy(null);
        if ("error" in r && r.error) return setMessage({ ok: false, text: r.error });
        if (doneHref) return router.push(doneHref);
        form.current?.reset();
        setImage(null);
        setMessage({ ok: true, text: "Card added. Add another?" });
        router.refresh();
      }}
    >
      <input type="hidden" name="id" value={initial?.id ?? ""} />
      <input type="hidden" name="deck_id" value={deckId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="image_path" value={image?.path ?? ""} />

      <div className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm font-medium">
        {(
          [
            ["basic", "Question & answer"],
            ["cloze", "Fill in the blank"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cx("flex-1 rounded-lg py-2", kind === k ? "bg-surface text-brand shadow-sm" : "text-muted")}
          >
            {label}
          </button>
        ))}
      </div>

      <Field
        label={kind === "cloze" ? "Sentence" : "Front (question)"}
        hint={kind === "cloze" ? "Wrap the hidden word in double braces: Caseous necrosis is typical of {{tuberculosis}}" : undefined}
      >
        <textarea name="front" defaultValue={initial?.front} rows={3} className={inputClass} />
      </Field>

      <div>
        {image ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt="" className="max-h-48 rounded-xl border border-border" />
            <button
              type="button"
              onClick={() => setImage(null)}
              className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white"
              aria-label="Remove picture"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted hover:bg-surface-2">
            {busy === "upload" ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
            Add a picture to the front (slide, specimen, film…)
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        )}
      </div>

      {kind === "basic" && (
        <Field label="Back (answer)">
          <textarea name="back" defaultValue={initial?.back} rows={4} className={inputClass} />
        </Field>
      )}
      {kind === "cloze" && <input type="hidden" name="back" value={initial?.back ?? ""} />}
      <Field label="Extra note (optional)" hint="Shown under the answer: a mnemonic, a source, a picture description.">
        <textarea name="extra" defaultValue={initial?.extra ?? ""} rows={2} className={inputClass} />
      </Field>

      {message && <p className={cx("text-sm", message.ok ? "text-ok" : "text-danger")}>{message.text}</p>}
      <Button type="submit" disabled={!!busy}>
        {busy === "save" && <Loader2 size={16} className="animate-spin" />} {initial?.id ? "Save changes" : "Add card"}
      </Button>
    </form>
  );
}
