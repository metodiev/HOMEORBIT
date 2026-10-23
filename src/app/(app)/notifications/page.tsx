import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { intlLocale } from "@/lib/i18n";
import { formatDate } from "@/lib/util/dates";
import {
  getNotificationPreferences,
  listNotifications,
  unreadNotificationCount,
} from "@/lib/domain/notifications";
import { markAllReadAction, markNotificationReadAction } from "@/lib/actions";
import { get } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { Badge, Card, EmptyState, FeedbackBanner, PageHeader } from "@/components/ui";

export const metadata = { title: "Notifications" };

const CATEGORY_ICONS: Record<string, string> = {
  calendar: "📅",
  tasks: "✅",
  shopping: "🛒",
  packages: "📦",
  school: "🎒",
  holidays: "🌄",
  approvals: "🛡️",
  alerts: "⚠️",
  briefing: "🌅",
  reminders: "⏰",
  calls: "📞",
  general: "🔔",
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const locale = intlLocale(actor.locale);
  const notifications = listNotifications(actor.id, 100);
  const unread = unreadNotificationCount(actor.id);
  const member = get<MemberRow>("SELECT * FROM members WHERE id = ?", [actor.id]);
  const prefs = member ? getNotificationPreferences(member) : {};

  return (
    <>
      <PageHeader
        eyebrow="In-app first"
        title="Notifications"
        subtitle="Relevant, deduplicated and quiet during your quiet hours. External channels stay disabled until configured."
        actions={
          unread > 0 ? (
            <form action={markAllReadAction}>
              <input type="hidden" name="redirectTo" value="/notifications" />
              <button type="submit" className="btn-secondary">Mark all read</button>
            </form>
          ) : undefined
        }
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {notifications.length === 0 ? (
            <EmptyState icon="🔔" title="No notifications yet" description="Proactive checks, approvals and family changes appear here." />
          ) : (
            notifications.map((notification) => (
              <div
                key={notification.id}
                className={`card flex items-start gap-3 p-4 ${notification.read_at ? "opacity-70" : ""}`}
              >
                <span className="text-xl" aria-hidden>
                  {CATEGORY_ICONS[notification.category] ?? "🔔"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={`text-sm ${notification.read_at ? "text-ink-soft" : "font-semibold text-ink"}`}>{notification.title}</p>
                    {notification.urgency === "high" ? <Badge tone="red">high</Badge> : null}
                    {!notification.read_at ? <Badge tone="teal">new</Badge> : null}
                  </div>
                  {notification.body ? <p className="mt-1 text-xs leading-relaxed text-ink-soft">{notification.body}</p> : null}
                  <p className="mt-1 text-[10px] text-ink-soft/70">
                    {formatDate(notification.created_at, locale, actor.timezone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {" · "}
                    {notification.category}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {notification.link ? (
                    <Link href={notification.link} className="btn-ghost text-[11px]">Open →</Link>
                  ) : null}
                  {!notification.read_at ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notificationId" value={notification.id} />
                      <input type="hidden" name="redirectTo" value="/notifications" />
                      <button type="submit" className="btn-ghost text-[11px]">Mark read</button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-4">
          <Card title="Your preferences" subtitle="Change these in Settings">
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>🔕 Quiet hours: {prefs.quietHours?.enabled === false ? "disabled" : `${prefs.quietHours?.start ?? "22:00"}–${prefs.quietHours?.end ?? "07:00"}`}</li>
              <li>🌅 Daily briefing: {prefs.dailyBriefing === false ? "off" : "on"}</li>
              <li>📊 Weekly summary: {prefs.weeklySummary === false ? "off" : "on"}</li>
              <li>📵 Email, push, Telegram and WhatsApp: not configured (in-app only)</li>
            </ul>
            <Link href="/settings#notifications" className="btn-secondary mt-3 w-full text-xs">Edit preferences</Link>
          </Card>
          <Card title="Deduplication" subtitle="Why you do not get the same alert twice">
            <p className="text-xs text-ink-soft">
              Each alert carries a stable key (event, member and day). If the same condition is detected again, the
              notification is skipped instead of repeated.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
