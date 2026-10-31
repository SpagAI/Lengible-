"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cx } from "@/components/ui";

// Goes back to the previous screen (or up one level when there's nothing to go back to, e.g. a shared link).
export function BackButton({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(pathname.split("/").slice(0, -1).join("/") || "/");
      }}
      className={cx("inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-text", className)}
      aria-label="Back"
      title="Back"
    >
      <ArrowLeft size={20} />
    </button>
  );
}
