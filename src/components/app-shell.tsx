"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { navItems, type NavItem } from "@/config/nav";
import { cx } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function SideLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  if (item.disabled) {
    return (
      <span aria-disabled className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted opacity-60">
        <Icon size={18} />
        <span className="flex-1 whitespace-nowrap">{item.label}</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap">{item.note}</span>
      </span>
    );
  }
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      className={cx(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
        active ? "bg-brand-soft text-brand-strong" : "text-text hover:bg-surface-2",
      )}
    >
      <Icon size={18} />
      {item.label}
    </Link>
  );
}

export function AppShell({ children, email }: { children: React.ReactNode; email: string }) {
  const pathname = usePathname();
  const primary = navItems.filter((i) => i.primary);
  const moreActive = pathname.startsWith("/more") || navItems.some((i) => !i.primary && !i.disabled && isActive(pathname, i.href));

  return (
    <div className="flex min-h-dvh">
      {/* Tablet & desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-surface p-3 md:flex">
        <Link href="/" className="mb-4 flex items-center gap-2 px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={28} height={28} className="rounded-lg" />
          <span className="text-lg font-semibold tracking-tight">Lengible</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <SideLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
        <div className="border-t border-border pt-3">
          <p className="truncate px-3 text-xs text-muted">{email}</p>
          <SignOutButton className="mt-1 w-full justify-start" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-10">{children}</main>
      </div>

      {/* Phone bottom bar */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur md:hidden">
        <ul className="grid grid-cols-6">
          {primary.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cx("flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", active ? "text-brand" : "text-muted")}
                >
                  <Icon size={21} strokeWidth={active ? 2.4 : 2} />
                  {item.short}
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              href="/more"
              className={cx("flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", moreActive ? "text-brand" : "text-muted")}
            >
              <MoreHorizontal size={21} />
              More
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
