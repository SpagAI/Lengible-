import { requireUser } from "@/lib/supabase/server";
import { ensureSeeded } from "@/lib/courses";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { SupabaseProvider } from "@/lib/supabase/client";
import { supabaseEnv } from "@/lib/supabase/env";
import { RefreshOnce } from "@/components/refresh-once";
import { BackgroundWorkProvider } from "@/components/background-work";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { supabase, user } = await requireUser();
  const seeded = await ensureSeeded(supabase, user);
  const { url, key } = supabaseEnv();
  return (
    <SupabaseProvider url={url!} anonKey={key!}>
      <BackgroundWorkProvider>
        <AppShell email={user.email ?? ""}>{seeded === "needs_migration" ? <MigrationNotice /> : children}</AppShell>
      </BackgroundWorkProvider>
      {seeded === "changed" && <RefreshOnce />}
    </SupabaseProvider>
  );
}

function MigrationNotice() {
  return (
    <Card className="space-y-2 text-sm">
      <h1 className="text-lg font-semibold">One database update needed</h1>
      <p>This version of Lengible needs the Phase 2 database changes.</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Open Supabase → SQL Editor → New query.</li>
        <li>
          Paste everything from <code>supabase/migrations/0002_library.sql</code> (in your GitHub repo) and click <b>Run</b>.
        </li>
        <li>Reload this page.</li>
      </ol>
    </Card>
  );
}
