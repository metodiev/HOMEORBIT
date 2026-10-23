import { all, get, run } from "@/lib/db";
import type { MemberRow, NotificationRow } from "@/lib/db/rows";
import type { Actor } from "@/lib/auth/actor";
import { newId, nowIso, parseJson } from "@/lib/util/ids";
import { zonedParts } from "@/lib/util/dates";

export type NotificationPreferences = {
  categories?: Record<string, boolean>;
  quietHours?: { start: string; end: string; enabled?: boolean };
  dailyBriefing?: boolean;
  weeklySummary?: boolean;
};

export type DashboardWidgets = {
  briefing?: boolean;
  agenda?: boolean;
  insights?: boolean;
  week?: boolean;
  feed?: boolean;
  approvals?: boolean;
  quickAdd?: boolean;
  availability?: boolean;
};

export const DEFAULT_DASHBOARD_WIDGETS: Required<DashboardWidgets> = {
  briefing: true,
  agenda: true,
  insights: true,
  week: true,
  feed: true,
  approvals: true,
  quickAdd: true,
  availability: true,
};

export type NotificationInput = {
  title: string;
  body?: string;
  category: string;
  urgency?: "low" | "normal" | "high";
  dedupeKey: string;
  link?: string;
};

export function getNotificationPreferences(member: MemberRow): NotificationPreferences {
  return parseJson<NotificationPreferences>(member.notification_prefs_json, {});
}

function minutesOf(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function isQuietHours(
  prefs: NotificationPreferences,
  timeZone: string,
  at: Date = new Date(),
): boolean {
  const quiet = prefs.quietHours;
  if (!quiet || quiet.enabled === false || !quiet.start || !quiet.end) return false;
  const now = zonedParts(at, timeZone);
  const current = now.hour * 60 + now.minute;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

/**
 * Creates an in-app notification unless the member muted the category, is in
 * quiet hours (high urgency bypasses), or the dedupe key already fired.
 */
export function notifyMember(member: MemberRow, input: NotificationInput): boolean {
  const prefs = getNotificationPreferences(member);
  if (prefs.categories?.[input.category] === false) return false;
  const urgency = input.urgency ?? "normal";
  if (urgency !== "high" && isQuietHours(prefs, member.timezone)) return false;
  const result = run(
    `INSERT OR IGNORE INTO notifications
      (id, household_id, member_id, title, body, category, urgency, dedupe_key, link, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      newId("ntf"),
      member.household_id,
      member.id,
      input.title,
      input.body ?? null,
      input.category,
      urgency,
      input.dedupeKey,
      input.link ?? null,
      nowIso(),
    ],
  );
  return result.changes > 0;
}

export function notifyHousehold(
  householdId: string,
  input: NotificationInput,
  options: { excludeMemberId?: string; roles?: string[] } = {},
): number {
  const members = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL",
    [householdId],
  );
  let created = 0;
  for (const member of members) {
    if (options.excludeMemberId === member.id) continue;
    if (options.roles && !options.roles.includes(member.role)) continue;
    if (notifyMember(member, { ...input, dedupeKey: `${input.dedupeKey}:${member.id}` })) created += 1;
  }
  return created;
}

export function notifyKidsGuardians(
  actor: Actor,
  input: NotificationInput,
): number {
  return notifyHousehold(actor.householdId, input, {
    excludeMemberId: actor.id,
    roles: ["parent", "adult"],
  });
}

export function listNotifications(memberId: string, limit = 50): NotificationRow[] {
  return all<NotificationRow>(
    "SELECT * FROM notifications WHERE member_id = ? ORDER BY created_at DESC LIMIT ?",
    [memberId, limit],
  );
}

export function unreadNotificationCount(memberId: string): number {
  const row = get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM notifications WHERE member_id = ? AND read_at IS NULL",
    [memberId],
  );
  return row?.count ?? 0;
}

export function markNotificationRead(memberId: string, notificationId: string): void {
  run("UPDATE notifications SET read_at = ? WHERE id = ? AND member_id = ?", [nowIso(), notificationId, memberId]);
}

export function markAllNotificationsRead(memberId: string): void {
  run("UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL", [nowIso(), memberId]);
}
