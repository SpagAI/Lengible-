"use client";

import { useActionState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { addDriveLink } from "@/app/(app)/library/drive/actions";
import { Button, inputClass, cx } from "@/components/ui";

export function AddLinkForm() {
  const [state, action, pending] = useActionState(addDriveLink, undefined);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <span className="relative flex-1">
          <Link2 size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            name="link"
            required
            placeholder="https://drive.google.com/drive/folders/…"
            className={cx(inputClass, "pl-9")}
            autoComplete="off"
            inputMode="url"
          />
        </span>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Looking inside…
            </>
          ) : (
            "Add link"
          )}
        </Button>
      </div>
      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      <p className="text-xs text-muted">Paste a shared folder (or file) link. Big folders can take up to a minute to list.</p>
    </form>
  );
}
