import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="mt-2 text-sm text-muted">Pages you opened recently still work. Reconnect to sync and load new pages.</p>
    </main>
  );
}
