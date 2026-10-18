import type { Metadata } from "next";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Setup needed" };

// Shown when the Supabase environment variables are missing.
export default function SetupPage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold">Almost there</h1>
      <Card className="mt-4 space-y-2 text-sm">
        <p>Lengible can&apos;t find its Supabase settings yet.</p>
        <p>
          Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to your environment (Vercel →
          Project → Settings → Environment Variables, or <code>.env.local</code> on your computer), then redeploy.
        </p>
        <p className="text-muted">See README.md for the step-by-step guide.</p>
      </Card>
    </main>
  );
}
