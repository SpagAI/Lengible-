"use client";

import { useState, useTransition } from "react";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { setDrugVerified } from "@/app/(app)/drugs/actions";
import { cx } from "@/components/ui";

// "Reference: needs verification" until you've checked the entry yourself.
export function VerifyToggle({ id, verified }: { id: string; verified: boolean }) {
  const [on, setOn] = useState(verified);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          setOn(!on);
          await setDrugVerified(id, !on);
        })
      }
      title={on ? "Tap to mark as not verified" : "Tap once you've checked this entry against your notes or a textbook"}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
        on ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn",
      )}
    >
      {on ? <BadgeCheck size={14} /> : <ShieldAlert size={14} />}
      {on ? "Verified by you" : "Reference: needs verification — tap when checked"}
    </button>
  );
}
