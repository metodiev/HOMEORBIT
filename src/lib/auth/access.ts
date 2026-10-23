import { can, type Actor } from "./actor";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { get } from "@/lib/db";
import type { CalendarRow, EventRow, NoteRow, MemberRow } from "@/lib/db/rows";

export function getMemberInHousehold(actor: Actor, memberId: string): MemberRow {
  const member = get<MemberRow>(
    "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
    [memberId, actor.householdId],
  );
  if (!member) throw new NotFoundError("Family member not found in this household.");
  return member;
}

export function getCalendarForActor(actor: Actor, calendarId: string): CalendarRow {
  const calendar = get<CalendarRow>(
    "SELECT * FROM calendars WHERE id = ? AND household_id = ? AND archived_at IS NULL",
    [calendarId, actor.householdId],
  );
  if (!calendar) throw new NotFoundError("Calendar not found.");
  return calendar;
}

export function calendarShareAccess(
  actor: Actor,
  calendarId: string,
): "view" | "edit" | null {
  const share = get<{ access: "view" | "edit" }>(
    "SELECT access FROM calendar_shares WHERE calendar_id = ? AND member_id = ?",
    [calendarId, actor.id],
  );
  return share?.access ?? null;
}

export function canViewCalendar(actor: Actor, calendar: CalendarRow): boolean {
  if (calendar.household_id !== actor.householdId) return false;
  const share = calendarShareAccess(actor, calendar.id);
  if (share) return true;
  if (calendar.scope === "shared") return actor.role !== "relative";
  if (calendar.owner_member_id === actor.id) return true;
  return canManagePersonalCalendar(actor, calendar);
}

/** Guardians may coordinate a child's personal calendar, but never another adult's. */
export function canManagePersonalCalendar(actor: Actor, calendar: CalendarRow): boolean {
  if (calendar.scope !== "personal" || !calendar.owner_member_id) return false;
  if (calendar.owner_member_id === actor.id) return true;
  if (!(actor.isAdmin || actor.role === "parent")) return false;
  const owner = get<MemberRow>("SELECT * FROM members WHERE id = ?", [calendar.owner_member_id]);
  return Boolean(owner && (owner.role === "child" || owner.role === "teen"));
}

export function canEditCalendar(actor: Actor, calendar: CalendarRow): boolean {
  if (!can(actor, "calendar.manage")) return false;
  if (!canViewCalendar(actor, calendar)) return false;
  const share = calendarShareAccess(actor, calendar.id);
  if (share === "edit") return true;
  if (calendar.owner_member_id === actor.id) return true;
  if (canManagePersonalCalendar(actor, calendar)) return true;
  if (calendar.scope === "shared") return actor.isAdmin || actor.role === "parent";
  return false;
}

export function canViewEvent(actor: Actor, event: EventRow): boolean {
  if (event.household_id !== actor.householdId) return false;
  if (event.visibility === "private") return event.created_by === actor.id;
  const participant = get<{ member_id: string }>(
    "SELECT member_id FROM event_participants WHERE event_id = ? AND member_id = ?",
    [event.id, actor.id],
  );
  if (participant) return true;
  const calendar = get<CalendarRow>("SELECT * FROM calendars WHERE id = ?", [event.calendar_id]);
  if (!calendar) return false;
  return canViewCalendar(actor, calendar);
}

export function canEditEvent(actor: Actor, event: EventRow): boolean {
  if (!canViewEvent(actor, event)) return false;
  if (event.created_by === actor.id) return true;
  if (!can(actor, "event.manage_shared")) return false;
  if (actor.isAdmin) return true;
  if (event.visibility === "private") return false;
  const calendar = get<CalendarRow>("SELECT * FROM calendars WHERE id = ?", [event.calendar_id]);
  return calendar ? canEditCalendar(actor, calendar) : false;
}

export function canViewNote(actor: Actor, note: NoteRow): boolean {
  if (note.household_id !== actor.householdId) return false;
  if (note.owner_member_id === actor.id) return true;
  if (note.visibility === "private") return false;
  const shared = get<{ note_id: string }>(
    "SELECT note_id FROM note_shares WHERE note_id = ? AND member_id = ?",
    [note.id, actor.id],
  );
  if (note.visibility === "restricted") {
    if (shared) return true;
    return note.sensitive === 1 && can(actor, "note.read_sensitive");
  }
  if (note.sensitive === 1) return can(actor, "note.read_sensitive");
  return actor.role !== "relative";
}

export function canEditNote(actor: Actor, note: NoteRow): boolean {
  if (note.household_id !== actor.householdId) return false;
  if (note.owner_member_id === actor.id) return true;
  return actor.isAdmin && can(actor, "note.create_shared");
}

export function assertCanViewEvent(actor: Actor, event: EventRow): void {
  if (!canViewEvent(actor, event)) throw new ForbiddenError("You cannot access this event.");
}

/**
 * Who may the actor coordinate schedules for? Guardians coordinate the whole
 * household; everyone else can only reason about their own availability.
 */
export function canCoordinateMember(actor: Actor, member: MemberRow): boolean {
  if (member.household_id !== actor.householdId) return false;
  if (member.id === actor.id) return true;
  return actor.isAdmin || actor.role === "parent";
}
