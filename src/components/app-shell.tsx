"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { navItems, type NavItem } from "@/config/nav";
import { cx } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { setSidebarCollapsed } from "@/components/theme";
import { BackButton } from "@/components/back-button";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function SideLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const base = "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium";
  if (item.disabled) {
    return (
      <span aria-disabled title={`${item.label} — ${item.note}`} className={cx(base, "cursor-not-allowed text-nav-text/50")}>
        <Icon size={20} className="shrink-0" />
        <span className="sidebar-label flex-1 whitespace-nowrap">{item.label}</span>
        <span className="sidebar-label rounded-full bg-white/10 px-2 py-0.5 text-[10px] whitespace-nowrap">{item.note}</span>
      </span>
    );
  }
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      title={item.label}
      className={cx(base, active ? "bg-white text-nav shadow-sm" : "text-nav-text hover:bg-white/10 hover:text-white")}
    >
      <Icon size={20} className="shrink-0" />
      <span className="sidebar-label whitespace-nowrap">{item.label}</span>
    </Link>
  );
}

export function AppShell({ children, email }: { children: React.ReactNode; email: string }) {
  const pathname = usePathname();
  const primary = navItems.filter((i) => i.primary);
  const moreActive = pathname.startsWith("/more") || navItems.some((i) => !i.primary && !i.disabled && isActive(pathname, i.href));
  // Ask Ally and the reading view fill the screen.
  const fullBleed = pathname === "/ally" || pathname.startsWith("/ally/") || pathname === "/read";
  const toggle = () => setSidebarCollapsed(document.documentElement.dataset.sidebar !== "collapsed");

  return (
    <div className="flex min-h-dvh">
      {/* Tablet & desktop sidebar; collapses down to the logo and icons. */}
      <aside className="sidebar sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden bg-gradient-to-b from-nav to-nav-2 p-3 text-white transition-[width] md:flex">
        <div className="mb-4 flex items-center gap-2 px-1.5 py-1">
          <Link href="/" title="Lengible" className="flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="Lengible" width={36} height={36} className="shrink-0" />
            <span className="sidebar-label text-lg font-semibold tracking-tight">Lengible</span>
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <SideLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
        <div className="space-y-1 border-t border-white/15 pt-3">
          <p className="sidebar-label truncate px-3 text-xs text-nav-text/80">{email}</p>
          <div className="flex flex-wrap items-center gap-1 text-nav-text">
            <ThemeToggle compact />
            <button
              type="button"
              onClick={toggle}
              title="Collapse or expand the sidebar"
              className="grid size-10 place-items-center rounded-xl hover:bg-white/10"
            >
              <PanelLeftClose size={18} className="sidebar-label" />
              <PanelLeftOpen size={18} className="sidebar-collapsed-only" />
            </button>
            <SignOutButton compact className="text-nav-text hover:bg-white/10 hover:text-white" />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone header with the logo. */}
        <header className="flex items-center gap-2 bg-gradient-to-r from-nav to-nav-2 px-4 py-3 text-white md:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" width={30} height={30} />
          <span className="flex-1 text-lg font-semibold tracking-tight">Lengible</span>
          <ThemeToggle compact className="text-nav-text" />
        </header>
        {fullBleed ? (
          // Ask Ally fills the screen like a chat app.
          <main className="flex min-h-0 w-full flex-1 flex-col pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:p-4">{children}</main>
        ) : (
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-3 pb-28 md:px-8 md:pt-5 md:pb-10">
            <BackButton className="-ml-2 mb-1" />
            {children}
          </main>
        )}
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
