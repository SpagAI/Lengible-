import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { navItems } from "@/config/nav";
import { requireUser } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata: Metadata = { title: "More" };

export default async function MorePage() {
  const { user } = await requireUser();
  const items = navItems.filter((i) => !i.primary);
  return (
    <>
      <PageHeader title="More" subtitle={user.email} />
      <Card className="divide-y divide-border p-0">
        {items.map((item) => {
          const Icon = item.icon;
          return item.disabled ? (
            <div key={item.href} aria-disabled className="flex items-center gap-3 px-4 py-3.5 text-muted opacity-60">
              <Icon size={20} />
              <span className="flex-1">{item.label}</span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{item.note}</span>
            </div>
          ) : (
            <Link key={item.href} href={item.href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2">
              <Icon size={20} />
              <span className="flex-1">{item.label}</span>
              <ChevronRight size={18} className="text-muted" />
            </Link>
          );
        })}
      </Card>
      <SignOutButton className="mt-4" />
    </>
  );
}
