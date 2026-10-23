import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { t, intlLocale } from "@/lib/i18n";
import { PRIMARY_NAV, SECONDARY_NAV } from "@/lib/nav";
import { formatDate } from "@/lib/util/dates";
import { unreadNotificationCount } from "@/lib/domain/notifications";
import { listPendingApprovals } from "@/lib/domain/approvals";
import { SidebarNav, MobileNav } from "@/components/Nav";
import { MemberAvatar } from "@/components/ui";
import { NativeMobileBridge } from "@/components/NativeMobileBridge";

const ROLE_LABELS: Record<string, { en: string; bg: string }> = {
  parent: { en: "Parent · guardian", bg: "Родител · настойник" },
  adult: { en: "Adult", bg: "Възрастен" },
  teen: { en: "Teenager", bg: "Тийнейджър" },
  child: { en: "Child", bg: "Дете" },
  relative: { en: "Invited relative", bg: "Поканен роднина" },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const unread = unreadNotificationCount(actor.id);
  const pending = listPendingApprovals(actor).length;
  const roleLabel = ROLE_LABELS[actor.role]?.[actor.locale === "bg" ? "bg" : "en"] ?? actor.role;
  const primary = PRIMARY_NAV.map((item) => ({ ...item, labelKey: t(actor.locale, item.labelKey) })).filter(
    (item) =>
      actor.role !== "relative" ||
      ["/dashboard", "/calendar", "/holidays", "/notes"].includes(item.href),
  );
  const secondary = SECONDARY_NAV.map((item) => ({
    ...item,
    labelKey: t(actor.locale, item.labelKey),
    badge: item.href === "/notifications" ? unread : item.href === "/approvals" ? pending : undefined,
  })).filter((item) => actor.role !== "relative" || item.href !== "/approvals");
  const navLabels = {
    more: t(actor.locale, "nav.more"),
    signOut: t(actor.locale, "common.signOut"),
    close: t(actor.locale, "common.close"),
  };
  const navActor = { name: actor.name, color: actor.color, avatar: actor.avatar, roleLabel };
  const todayLabel = formatDate(new Date(), intlLocale(actor.locale), actor.timezone, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="lg:flex">
      <NativeMobileBridge />
      <SidebarNav primary={primary} secondary={secondary} actor={navActor} labels={navLabels} />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-black/5 bg-cream/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <Link href="/dashboard" className="flex items-center gap-2 lg:hidden">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-deep text-sun">◐</span>
                <span className="font-display text-base font-semibold">HomeOrbit</span>
              </Link>
              <div className="hidden lg:block">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">{actor.householdName}</p>
                <p className="text-sm font-medium text-ink">{todayLabel}</p>
              </div>
              <p className="hidden text-xs text-ink-soft sm:block lg:hidden">{todayLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/notifications"
                aria-label={t(actor.locale, "nav.notifications")}
                className="relative rounded-full border border-black/10 bg-white p-2 text-lg leading-none transition hover:border-teal/40"
              >
                🔔
                {unread > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-terracotta px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                ) : null}
              </Link>
              <Link
                href="/settings"
                className="flex items-center gap-2 rounded-full border border-black/10 bg-white py-1 pl-1 pr-3 transition hover:border-teal/40"
              >
                <MemberAvatar name={actor.name} color={actor.color} avatar={actor.avatar} size="sm" />
                <span className="hidden text-xs font-semibold text-ink sm:block">{actor.name.split(" ")[0]}</span>
              </Link>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12">{children}</main>
      </div>
      <MobileNav primary={primary} secondary={secondary} actor={navActor} labels={navLabels} />
    </div>
  );
}
