import Link from "next/link";
import { all, get } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/auth/actor";
import { t, intlLocale } from "@/lib/i18n";
import {
  addDaysToDateString,
  dateStringInZone,
  formatDate,
  formatTime,
  isoDayRange,
  startOfWeekDateString,
  zonedParts,
} from "@/lib/util/dates";
import { listAgenda } from "@/lib/domain/events";
import { listTasks } from "@/lib/domain/tasks";
import { listPackages } from "@/lib/domain/packages";
import { listPickups, missingPickupArrangements } from "@/lib/domain/school";
import { listPendingApprovals } from "@/lib/domain/approvals";
import { computeInsights, dailyBriefing } from "@/lib/proactive/insights";
import { addShoppingItemAction, runProactiveChecksAction } from "@/lib/actions";
import { Badge, Card, EmptyState, MemberAvatar, PageHeader, Stat } from "@/components/ui";
import { DEFAULT_DASHBOARD_WIDGETS, type DashboardWidgets } from "@/lib/domain/notifications";
import { parseJson } from "@/lib/util/ids";
import { FeedbackBanner } from "@/components/ui";

export const metadata = { title: "Home" };

const FEED_LABELS: Record<string, string> = {
  "event.created": "added an event",
  "event.updated": "updated an event",
  "event.cancelled": "cancelled an event",
  "task.created": "created a task",
  "task.updated": "updated a task",
  "shopping_item.created": "added a shopping item",
  "shopping_item.bought": "checked off a shopping item",
  "package.created": "registered a package",
  "package.status": "updated a delivery",
  "call.created": "recorded a call",
  "note.created": "saved a note",
  "note.shared": "shared a note",
  "member.invited": "invited a family member",
  "member.added": "added a family member",
  "trip.created": "planned a trip",
  "pickup.confirmed": "confirmed a school run",
  "pickup.assigned": "assigned a school run",
  "approval.requested": "asked for confirmation",
  "household.updated": "updated household settings",
};

type FeedRow = {
  action: string;
  created_at: string;
  actor_name: string | null;
  actor_color: string | null;
  actor_avatar: string | null;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const now = new Date();
  const today = dateStringInZone(now, actor.timezone);
  const tomorrow = addDaysToDateString(today, 1);
  const weekEnd = addDaysToDateString(today, 6);
  const locale = intlLocale(actor.locale);
  const actorRow = get<MemberRow>("SELECT * FROM members WHERE id = ?", [actor.id]);
  const widgets: Required<DashboardWidgets> = {
    ...DEFAULT_DASHBOARD_WIDGETS,
    ...parseJson<DashboardWidgets>(actorRow?.dashboard_prefs_json, {}),
  };
  const params = await searchParams;

  const todayItems = listAgenda(actor, {
    from: isoDayRange(today, actor.timezone).start,
    to: isoDayRange(today, actor.timezone).end,
  });
  const weekItems = listAgenda(actor, {
    from: isoDayRange(today, actor.timezone).start,
    to: isoDayRange(weekEnd, actor.timezone).end,
  });
  const tasks = actor.role === "relative" ? [] : listTasks(actor, { status: "open", dueBefore: isoDayRange(tomorrow, actor.timezone).end });
  const packages = actor.role === "relative" ? [] : listPackages(actor).slice(0, 4);
  const pickups = actor.role === "relative" ? [] : listPickups(actor, today, today);
  const missingPickups = actor.role === "relative" ? [] : missingPickupArrangements(actor, today, weekEnd);
  const pendingApprovals = listPendingApprovals(actor);
  const approvals = pendingApprovals.slice(0, 3);
  const insights = (() => {
    try {
      return computeInsights(actor).slice(0, 6);
    } catch {
      return [];
    }
  })();
  const members =
    actor.role === "relative"
      ? []
      : all<MemberRow>("SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at", [
          actor.householdId,
        ]);
  const briefing = (() => {
    try {
      return dailyBriefing(actor);
    } catch {
      return `Good day, ${actor.name}!`;
    }
  })();
  const feed =
    actor.role === "relative"
      ? []
      : all<FeedRow>(
          `SELECT a.action, a.created_at, m.name AS actor_name, m.color AS actor_color, m.avatar AS actor_avatar
           FROM audit_log a LEFT JOIN members m ON m.id = a.actor_member_id
           WHERE a.household_id = ?
             AND a.action NOT LIKE 'auth.%' AND a.action NOT LIKE 'agent.%'
             AND a.action NOT IN ('seed.demo','proactive.run')
           ORDER BY a.created_at DESC LIMIT 8`,
          [actor.householdId],
        );

  const localHour = zonedParts(now, actor.timezone).hour;
  const greeting = localHour < 12 ? "Good morning" : localHour < 18 ? "Good afternoon" : "Good evening";
  const weekDays = Array.from({ length: 7 }, (_, index) =>
    addDaysToDateString(startOfWeekDateString(today, 1), index),
  );
  const itemsByDay = new Map<string, typeof weekItems>();
  for (const item of weekItems) {
    const list = itemsByDay.get(item.localDate) ?? [];
    list.push(item);
    itemsByDay.set(item.localDate, list);
  }

  return (
    <>
      <PageHeader
        eyebrow={formatDate(now, locale, actor.timezone, { weekday: "long", day: "numeric", month: "long" })}
        title={`${greeting}, ${actor.name.split(" ")[0]}`}
        subtitle={t(actor.locale, "dashboard.title")}
        actions={
          <>
            <Link href="/calendar?new=1" className="btn-secondary">
              + Event
            </Link>
            <Link href="/tasks" className="btn-secondary">
              + Task
            </Link>
            <Link href="/shopping" className="btn-secondary">
              + Shopping
            </Link>
            <Link href="/assistant" className="btn">
              ✨ Ask HomeOrbit
            </Link>
          </>
        }
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      {widgets.briefing ? (
        <section className="relative mb-6 overflow-hidden rounded-3xl bg-teal-deep px-6 py-6 text-cream shadow-lg shadow-teal-deep/10 sm:px-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border border-dashed border-sun/25" />
          <div className="pointer-events-none absolute -bottom-24 right-24 h-64 w-64 rounded-full border border-cream/10" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sun">
                {t(actor.locale, "dashboard.briefing")}
              </p>
              <p className="mt-2 text-lg leading-relaxed text-cream/95">{briefing}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-cream/70">
                <span className="rounded-full bg-white/10 px-3 py-1">{actor.householdName}</span>
                <span className="rounded-full bg-white/10 px-3 py-1">{actor.householdTimezone}</span>
                <span className="rounded-full bg-white/10 px-3 py-1">
                  {actor.role === "parent" ? "Guardian access" : actor.role === "relative" ? "Guest access" : "Family access"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex -space-x-3">
                {members.slice(0, 6).map((member) => (
                  <span key={member.id} className="rounded-full ring-2 ring-teal-deep">
                    <MemberAvatar name={member.name} color={member.color} avatar={member.avatar} size="md" />
                  </span>
                ))}
              </div>
              {can(actor, "household.manage") ? (
                <form action={runProactiveChecksAction}>
                  <input type="hidden" name="redirectTo" value="/dashboard" />
                  <button
                    type="submit"
                    className="rounded-full bg-sun px-4 py-2 text-xs font-semibold text-teal-deep transition hover:bg-amber-300"
                  >
                    Run family checks
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Today" value={todayItems.length} hint="events visible to you" />
        <Stat label="Open tasks" value={tasks.length} hint="due by tomorrow" />
        <Stat label="Deliveries" value={packages.length} hint="active packages" />
        <Stat label="Approvals" value={pendingApprovals.length} hint="waiting for a guardian" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {widgets.agenda ? (
            <Card
              title={t(actor.locale, "dashboard.agenda")}
              subtitle="Each avatar shows who is involved."
              action={
                <Link href="/calendar" className="btn-ghost text-xs">
                  Open calendar →
                </Link>
              }
            >
              {todayItems.length === 0 ? (
                <EmptyState
                  icon="🌤️"
                  title={t(actor.locale, "dashboard.emptyAgenda")}
                  description="Use the quick actions above or ask the assistant to plan something."
                />
              ) : (
                <ol className="space-y-2">
                  {todayItems.map((item) => (
                    <li
                      key={`${item.eventId}-${item.startsAt}`}
                      className="flex gap-3 rounded-2xl border border-black/5 bg-white p-3 transition hover:border-teal/30"
                    >
                      <div className="w-14 shrink-0 text-right">
                        <p className="text-sm font-semibold text-ink">
                          {item.allDay ? "All day" : formatTime(item.startsAt, locale, actor.timezone)}
                        </p>
                        {!item.allDay ? (
                          <p className="text-[10px] text-ink-soft">{formatTime(item.endsAt, locale, actor.timezone)}</p>
                        ) : null}
                      </div>
                      <span
                        className="mt-1 h-8 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: item.calendarColor }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-ink">{item.title}</p>
                          {item.status === "tentative" ? <Badge tone="amber">tentative</Badge> : null}
                          {item.visibility === "private" ? <Badge tone="neutral">private</Badge> : null}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-ink-soft">
                          {item.location ? `${item.location} · ` : ""}
                          {item.calendarName}
                        </p>
                      </div>
                      <div className="flex items-center -space-x-2">
                        {item.participants.slice(0, 4).map((participant) => (
                          <span key={participant.memberId} className="rounded-full ring-2 ring-white">
                            <MemberAvatar
                              name={participant.name}
                              color={participant.color}
                              avatar={participant.avatar}
                              size="sm"
                            />
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          ) : null}

          {widgets.week ? (
            <Card
              title={t(actor.locale, "dashboard.week")}
              subtitle="A quick look at the next seven days."
              action={
                <Link href="/calendar?view=week" className="btn-ghost text-xs">
                  Week view →
                </Link>
              }
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {weekDays.map((day) => {
                  const items = itemsByDay.get(day) ?? [];
                  const isToday = day === today;
                  return (
                    <Link
                      key={day}
                      href={`/calendar?date=${day}&view=day`}
                      className={`rounded-2xl border p-3 transition hover:border-teal/40 ${
                        isToday ? "border-teal/40 bg-teal-mist/50" : "border-black/5 bg-white"
                      }`}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                        {formatDate(day, locale, actor.timezone, { weekday: "short" })}
                      </p>
                      <p className="text-lg font-semibold text-ink">{Number(day.slice(8, 10))}</p>
                      <p className="mt-1 text-[11px] text-ink-soft">
                        {items.length === 0 ? "Free" : `${items.length} event${items.length === 1 ? "" : "s"}`}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {items.slice(0, 4).map((item, index) => (
                          <span
                            key={`${item.eventId}-${index}`}
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: item.calendarColor }}
                          />
                        ))}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {widgets.feed ? (
            <Card title={t(actor.locale, "dashboard.feed")} subtitle="Who changed what, straight from the audit log.">
              {feed.length === 0 ? (
                <p className="text-sm text-ink-soft">No family activity yet.</p>
              ) : (
                <ul className="space-y-3">
                  {feed.map((entry, index) => (
                    <li key={`${entry.created_at}-${index}`} className="flex items-start gap-3">
                      <MemberAvatar
                        name={entry.actor_name ?? "System"}
                        color={entry.actor_color ?? "#64748b"}
                        avatar={entry.actor_avatar}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="text-ink">
                          <span className="font-medium">{entry.actor_name ?? "System"}</span>{" "}
                          {FEED_LABELS[entry.action] ?? entry.action.replace(/[._]/g, " ")}
                        </p>
                        <p className="text-[11px] text-ink-soft">
                          {formatDate(entry.created_at, locale, actor.timezone, {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {widgets.insights ? (
            <Card title={t(actor.locale, "dashboard.attention")} subtitle="Proactive checks across the household.">
              {insights.length === 0 ? (
                <p className="text-sm text-ink-soft">Nothing needs attention right now.</p>
              ) : (
                <ul className="space-y-2">
                  {insights.map((insight) => (
                    <li key={insight.key}>
                      <Link
                        href={insight.link}
                        className={`block rounded-xl border-l-4 bg-white p-3 transition hover:bg-sand/40 ${
                          insight.severity === "critical"
                            ? "border-l-red-500"
                            : insight.severity === "warning"
                              ? "border-l-amber-500"
                              : "border-l-teal"
                        }`}
                      >
                        <p className="text-sm font-medium text-ink">{insight.title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{insight.body}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {widgets.availability ? (
            <Card title="Today's school runs" subtitle="Coordination status — not proof of arrival.">
              {pickups.length === 0 ? (
                <p className="text-sm text-ink-soft">No school runs today.</p>
              ) : (
                <ul className="space-y-2">
                  {pickups.map((pickup) => (
                    <li key={pickup.id} className="flex items-center gap-3 rounded-xl border border-black/5 bg-white p-2.5">
                      <MemberAvatar name={pickup.childName} color={pickup.childColor} avatar={pickup.childAvatar} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">
                          {pickup.childName} · {pickup.time}
                        </p>
                        <p className="text-[11px] text-ink-soft">
                          {pickup.direction === "pickup" ? "Pickup" : "Drop-off"} ·{" "}
                          {pickup.responsibleName ?? "nobody assigned"}
                        </p>
                      </div>
                      <Badge tone={pickup.responsibleName ? "teal" : "red"}>
                        {pickup.responsibleName ? pickup.status : "attention"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {missingPickups.length > 0 ? (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {missingPickups.length} pickup arrangement(s) still need attention this week.
                </p>
              ) : null}
            </Card>
          ) : null}

          {widgets.approvals && approvals.length > 0 ? (
            <Card
              title="Confirmation needed"
              subtitle="Consequential actions waiting for approval."
              action={
                <Link href="/approvals" className="btn-ghost text-xs">
                  Open →
                </Link>
              }
            >
              <ul className="space-y-2">
                {approvals.map((approval) => (
                  <li key={approval.id} className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                      {approval.action.replace(/_/g, " ")}
                    </p>
                    <p className="mt-1 text-sm text-amber-950">{approval.summary}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {widgets.quickAdd ? (
            <Card title={t(actor.locale, "dashboard.quickActions")} subtitle="Add something in a couple of seconds.">
              <form action={addShoppingItemAction} className="space-y-2">
                <input type="hidden" name="redirectTo" value="/dashboard" />
                <label className="label" htmlFor="quick-item">
                  Shopping item
                </label>
                <div className="flex gap-2">
                  <input id="quick-item" name="name" required placeholder="Milk, bread, batteries…" className="field mt-0" />
                  <button type="submit" className="btn shrink-0 px-3">
                    Add
                  </button>
                </div>
              </form>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link href="/calendar?new=1" className="btn-secondary justify-start text-xs">
                  📅 Event
                </Link>
                <Link href="/tasks" className="btn-secondary justify-start text-xs">
                  ✅ Task
                </Link>
                <Link href="/deliveries?new=1" className="btn-secondary justify-start text-xs">
                  📦 Package
                </Link>
                <Link href="/household#calls" className="btn-secondary justify-start text-xs">
                  📞 Call
                </Link>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
