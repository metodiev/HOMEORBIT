"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavItem } from "@/lib/nav";
import { logoutAction } from "@/lib/actions";
import { MemberAvatar } from "./ui";

type NavProps = {
  primary: NavItem[];
  secondary: NavItem[];
  actor: { name: string; color: string; avatar: string; roleLabel: string };
  labels: { more: string; signOut: string; close: string };
};

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
        active
          ? "bg-cream text-teal-deep font-semibold shadow-sm"
          : "text-cream/80 hover:bg-white/10 hover:text-white"
      }`}
    >
      <span aria-hidden className="text-base leading-none">
        {item.icon}
      </span>
      <span className="flex-1 truncate">{item.labelKey}</span>
      {item.badge ? (
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            active ? "bg-teal text-white" : "bg-sun text-teal-deep"
          }`}
        >
          {item.badge > 9 ? "9+" : item.badge}
        </span>
      ) : null}
    </Link>
  );
}

export function SidebarNav({ primary, secondary, actor, labels }: NavProps) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col bg-teal-deep px-3 py-5 text-cream lg:flex">
      <Link href="/dashboard" className="mb-6 flex items-center gap-3 px-2">
        <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-sun/60 bg-white/5">
          <span className="h-3 w-3 rounded-full bg-sun" />
          <span className="absolute h-8 w-8 rounded-full border border-dashed border-cream/40" />
        </span>
        <span>
          <span className="block font-display text-lg font-semibold leading-tight">HomeOrbit</span>
          <span className="block text-[11px] uppercase tracking-[0.16em] text-cream/60">Family OS</span>
        </span>
      </Link>

      <nav aria-label="Main" className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto pr-1">
        {primary.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
        <div className="my-3 border-t border-white/10" />
        {secondary.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>

      <div className="mt-4 rounded-2xl bg-black/15 p-3">
        <div className="flex items-center gap-3">
          <MemberAvatar name={actor.name} color={actor.color} avatar={actor.avatar} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{actor.name}</p>
            <p className="truncate text-[11px] text-cream/60">{actor.roleLabel}</p>
          </div>
        </div>
        <form action={logoutAction} className="mt-2">
          <button type="submit" className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-cream/70 hover:bg-white/10 hover:text-white">
            {labels.signOut} →
          </button>
        </form>
      </div>
    </aside>
  );
}

export function MobileNav({ primary, secondary, actor, labels }: NavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const byHref = (href: string) => primary.find((item) => item.href === href);
  const hasAssistant = Boolean(byHref("/assistant"));
  const left = hasAssistant
    ? [byHref("/dashboard"), byHref("/calendar")].filter((item): item is NavItem => Boolean(item))
    : primary.slice(0, 4);
  const right = hasAssistant
    ? [byHref("/tasks")].filter((item): item is NavItem => Boolean(item))
    : [];
  const rest = hasAssistant
    ? [...primary.filter((item) => !["/dashboard", "/calendar", "/assistant", "/tasks"].includes(item.href)), ...secondary]
    : [...primary.slice(4), ...secondary];

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={labels.close}
            className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl bg-teal-deep p-5 pb-8 text-cream shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MemberAvatar name={actor.name} color={actor.color} avatar={actor.avatar} />
                <div>
                  <p className="text-sm font-semibold">{actor.name}</p>
                  <p className="text-xs text-cream/60">{actor.roleLabel}</p>
                </div>
              </div>
              <button type="button" className="rounded-full p-2 text-cream/70 hover:bg-white/10" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {rest.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} onNavigate={() => setOpen(false)} />
              ))}
            </div>
            <form action={logoutAction} className="mt-4">
              <button type="submit" className="btn-secondary w-full">
                {labels.signOut}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Mobile"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex max-w-md items-end justify-between gap-0.5">
          {left.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-1 text-[9px] font-medium ${
                  active ? "text-teal" : "text-ink-soft"
                }`}
              >
                <span aria-hidden className="text-lg">
                  {item.icon}
                </span>
                <span className="w-full truncate text-center">{item.labelKey}</span>
              </Link>
            );
          })}
          {hasAssistant ? (
            <Link
              href="/assistant"
              className="mx-0.5 -mt-5 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-teal text-2xl text-white shadow-lg shadow-teal/30"
              aria-label="AI assistant"
            >
              ✨
            </Link>
          ) : null}
          {right.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-1 text-[9px] font-medium ${
                  active ? "text-teal" : "text-ink-soft"
                }`}
              >
                <span aria-hidden className="text-lg">
                  {item.icon}
                </span>
                <span className="w-full truncate text-center">{item.labelKey}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-1 text-[9px] font-medium text-ink-soft"
          >
            <span aria-hidden className="text-lg">
              ☰
            </span>
            <span className="w-full truncate text-center">{labels.more}</span>
          </button>
        </div>
      </nav>
    </>
  );
}
