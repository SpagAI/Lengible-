"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The page loads alongside first-time setup; reload its data once setup has finished.
export function RefreshOnce() {
  const router = useRouter();
  useEffect(() => router.refresh(), [router]);
  return null;
}
