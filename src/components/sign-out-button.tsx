"use client";

import { LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { Button, cx } from "@/components/ui";

export function SignOutButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  async function handleSignOut() {
    // Remove pages the service worker saved for offline use, so the next person on this device can't see them.
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("pages-")).map((k) => caches.delete(k)));
    }
    await signOut();
  }
  if (compact) {
    return (
      <button type="button" title="Sign out" onClick={handleSignOut} className={cx("grid size-10 place-items-center rounded-xl", className)}>
        <LogOut size={18} />
      </button>
    );
  }
  return (
    <Button variant="ghost" className={className} onClick={handleSignOut}>
      <LogOut size={16} /> Sign out
    </Button>
  );
}
