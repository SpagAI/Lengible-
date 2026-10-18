import { requireUser } from "@/lib/supabase/server";
import { ensureSeeded } from "@/lib/courses";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { supabase, user } = await requireUser();
  await ensureSeeded(supabase, user);
  return <AppShell email={user.email ?? ""}>{children}</AppShell>;
}
