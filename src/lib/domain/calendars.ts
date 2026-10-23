import { all, get, run } from "@/lib/db";
import type { CalendarRow, CalendarShareRow, MemberRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { canEditCalendar, canViewCalendar, calendarShareAccess } from "@/lib/auth/access";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso } from "@/lib/util/ids";
import { recordAudit } from "./audit";

export type CalendarWithAccess = CalendarRow & {
  ownerName: string | null;
  canEdit: boolean;
  access: "owner" | "edit" | "view";
  sharedWith: { memberId: string; name: string; access: string }[];
};

export function listCalendars(actor: Actor): CalendarWithAccess[] {
  const calendars = all<CalendarRow>(
    "SELECT * FROM calendars WHERE household_id = ? AND archived_at IS NULL ORDER BY scope, name",
    [actor.householdId],
  );
  return calendars
    .filter((calendar) => canViewCalendar(actor, calendar))
    .map((calendar) => {
      const owner = calendar.owner_member_id
        ? get<MemberRow>("SELECT * FROM members WHERE id = ?", [calendar.owner_member_id])
        : undefined;
      const share = calendarShareAccess(actor, calendar.id);
      const sharedWith = all<{ member_id: string; name: string; access: string }>(
        `SELECT cs.member_id, m.name, cs.access FROM calendar_shares cs
         JOIN members m ON m.id = cs.member_id WHERE cs.calendar_id = ?`,
        [calendar.id],
      ).map((row) => ({ memberId: row.member_id, name: row.name, access: row.access }));
      return {
        ...calendar,
        ownerName: owner?.name ?? null,
        canEdit: canEditCalendar(actor, calendar),
        access: calendar.owner_member_id === actor.id ? "owner" : share ?? "view",
        sharedWith,
      };
    });
}

export function getCalendar(actor: Actor, calendarId: string): CalendarWithAccess {
  const calendar = listCalendars(actor).find((item) => item.id === calendarId);
  if (!calendar) throw new NotFoundError("Calendar not found or not visible to you.");
  return calendar;
}

export function createCalendar(
  actor: Actor,
  input: { name: string; color?: string; scope?: "personal" | "shared"; kind?: string; ownerMemberId?: string | null },
): CalendarRow {
  if (!can(actor, "calendar.create")) throw new ForbiddenError("Your role cannot create calendars.");
  const name = input.name.trim();
  if (!name) throw new ValidationError("A calendar needs a name.");
  const scope = input.scope ?? "shared";
  if (scope === "personal" && input.ownerMemberId && input.ownerMemberId !== actor.id) {
    if (!actor.isAdmin) throw new ForbiddenError("Only a guardian can create a calendar for someone else.");
  }
  const id = newId("cal");
  run(
    `INSERT INTO calendars (id, household_id, name, color, scope, owner_member_id, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      actor.householdId,
      name,
      input.color ?? actor.color,
      scope,
      scope === "personal" ? input.ownerMemberId ?? actor.id : null,
      input.kind ?? "custom",
      nowIso(),
    ],
  );
  recordAudit(actor, "calendar.created", "calendar", id, { name, scope });
  return get<CalendarRow>("SELECT * FROM calendars WHERE id = ?", [id]) as CalendarRow;
}

export function updateCalendar(
  actor: Actor,
  calendarId: string,
  input: { name?: string; color?: string; archived?: boolean },
): CalendarRow {
  const calendar = get<CalendarRow>(
    "SELECT * FROM calendars WHERE id = ? AND household_id = ?",
    [calendarId, actor.householdId],
  );
  if (!calendar) throw new NotFoundError("Calendar not found.");
  if (!canEditCalendar(actor, calendar)) throw new ForbiddenError("You cannot change this calendar.");
  run("UPDATE calendars SET name = ?, color = ?, archived_at = ? WHERE id = ?", [
    input.name?.trim() || calendar.name,
    input.color ?? calendar.color,
    input.archived ? nowIso() : calendar.archived_at,
    calendar.id,
  ]);
  recordAudit(actor, "calendar.updated", "calendar", calendar.id);
  return get<CalendarRow>("SELECT * FROM calendars WHERE id = ?", [calendar.id]) as CalendarRow;
}

export function shareCalendar(
  actor: Actor,
  calendarId: string,
  memberId: string,
  access: "view" | "edit",
): void {
  const calendar = get<CalendarRow>(
    "SELECT * FROM calendars WHERE id = ? AND household_id = ?",
    [calendarId, actor.householdId],
  );
  if (!calendar) throw new NotFoundError("Calendar not found.");
  if (!canEditCalendar(actor, calendar)) throw new ForbiddenError("You cannot share this calendar.");
  const member = get<MemberRow>("SELECT * FROM members WHERE id = ? AND household_id = ?", [
    memberId,
    actor.householdId,
  ]);
  if (!member) throw new NotFoundError("Member not found.");
  if (calendar.owner_member_id === memberId) throw new ValidationError("The owner already has full access.");
  run(
    `INSERT INTO calendar_shares (calendar_id, member_id, access) VALUES (?, ?, ?)
     ON CONFLICT(calendar_id, member_id) DO UPDATE SET access = excluded.access`,
    [calendarId, memberId, access],
  );
  recordAudit(actor, "calendar.shared", "calendar", calendarId, { memberId, access });
}

export function unshareCalendar(actor: Actor, calendarId: string, memberId: string): void {
  const calendar = get<CalendarRow>(
    "SELECT * FROM calendars WHERE id = ? AND household_id = ?",
    [calendarId, actor.householdId],
  );
  if (!calendar) throw new NotFoundError("Calendar not found.");
  if (!canEditCalendar(actor, calendar)) throw new ForbiddenError("You cannot change sharing.");
  run("DELETE FROM calendar_shares WHERE calendar_id = ? AND member_id = ?", [calendarId, memberId]);
  recordAudit(actor, "calendar.unshared", "calendar", calendarId, { memberId });
}

export function listCalendarShares(actor: Actor, calendarId: string): CalendarShareRow[] {
  const calendar = get<CalendarRow>(
    "SELECT * FROM calendars WHERE id = ? AND household_id = ?",
    [calendarId, actor.householdId],
  );
  if (!calendar) throw new NotFoundError("Calendar not found.");
  if (!canViewCalendar(actor, calendar)) throw new ForbiddenError("Not your calendar.");
  return all<CalendarShareRow>("SELECT * FROM calendar_shares WHERE calendar_id = ?", [calendarId]);
}
