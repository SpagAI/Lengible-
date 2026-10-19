import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { Card } from "@/components/ui";
import { checkSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Setup needed" };

// Shown when the Supabase settings are missing or look wrong. Checked on every visit, never cached.
export default async function SetupPage() {
  await connection();
  const checks = checkSupabaseEnv();
  if (checks.every((c) => c.status === "ok")) redirect("/login");

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold">Almost there</h1>
      <p className="mt-1 text-sm text-muted">Lengible can&apos;t connect to Supabase yet. Here&apos;s what it sees:</p>
      <Card className="mt-4 space-y-3 text-sm">
        {checks.map((c) => (
          <div key={c.name} className="flex gap-2">
            {c.status === "ok" ? (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-brand" />
            ) : (
              <XCircle size={18} className="mt-0.5 shrink-0 text-danger" />
            )}
            <div className="min-w-0">
              <code className="break-all">{c.name}</code>
              <p className={c.status === "ok" ? "text-muted" : "text-danger"}>
                {c.status === "ok" ? "Found" : c.status === "missing" ? "Missing — not set for this deployment" : "Set, but looks wrong"}
              </p>
              {c.hint && <p className="text-muted">{c.hint}</p>}
            </div>
          </div>
        ))}
      </Card>
      <p className="mt-4 text-sm text-muted">
        Fix them in Vercel → your project → Settings → Environment Variables (tick Production), then reload this page.
      </p>
    </main>
  );
}
