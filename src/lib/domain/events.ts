import { all, get, run } from "@/lib/db";
import type { CalendarRow, EventParticipantRow, EventRow, MemberRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { canEditEvent, canViewCalendar, canViewEvent, canCoordinateMember, canManagePersonalCalendar } from "@/lib/auth/access";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso, parseJson, toJson } from "@/lib/util/ids";
import { expandOccurrences, type Occurrence } from "@/lib/util/recurrence";
import {
  dateStringInZone,
  formatDateTime,
  parseDateString,
  rangesOverlap,
  zonedTimeToUtc,
} from "@/lib/util/dates";
import { notifyMember } from "./notifications";
import { recordAudit } from "./audit";

export type ParticipantView = {
  memberId: string;
  name: string;
  color: string;
  avatar: string;
  response: EventParticipantRow["response"];
};

export type AgendaItem = {
  eventId: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string;
  visibility: "household" | "private";
  status: EventRow["status"];
  localDate: string;
  isRecurringInstance: boolean;
  recurrenceRule: string | null;
  createdBy: string;
  createdByName: string;
  participants: ParticipantView[];
  canEdit: boolean;
  travelMinutes: number;
  preparationMinutes: number;
};

export type EventInput = {
  calendarId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  visibility?: "household" | "private";
  status?: EventRow["status"];
  recurrenceRule?: string | null;
  exceptionDates?: string[];
  reminderMinutes?: number[];
  travelMinutes?: number;
  preparationMinutes?: number;
  participantIds?: string[];
  timezone?: string;
};

function emptyAgenda(item: Omit<AgendaItem, "eventId"> & { eventId: string }): AgendaItem {
  return item;
}

export function participantsForEvent(eventId: string): ParticipantView[] {
  return all<ParticipantView & { member_id: string; member_name: string; member_color: string; member_avatar: string }>(
    `SELECT ep.member_id, ep.response, m.name AS member_name, m.color AS member_color, m.avatar AS member_avatar
     FROM event_participants ep JOIN members m ON m.id = ep.member_id
     WHERE ep.event_id = ? ORDER BY m.created_at`,
    [eventId],
  ).map((row) => ({
    memberId: row.member_id,
    name: row.member_name,
    color: row.member_color,
    avatar: row.member_avatar,
    response: row.response,
  }));
}

function eventToAgenda(
  actor: Actor,
  event: EventRow,
  occurrence: Occurrence,
  calendar: CalendarRow,
): AgendaItem {
  const creator = get<MemberRow>("SELECT * FROM members WHERE id = ?", [event.created_by]);
  return emptyAgenda({
    eventId: event.id,
    calendarId: event.calendar_id,
    calendarName: calendar.name,
    calendarColor: calendar.color,
    title: event.title,
    description: event.description,
    location: event.location,
    startsAt: occurrence.start.toISOString(),
    endsAt: occurrence.end.toISOString(),
    allDay: event.all_day === 1,
    timezone: event.timezone,
    visibility: event.visibility,
    status: event.status,
    localDate: occurrence.localDate,
    isRecurringInstance: occurrence.isRecurringInstance,
    recurrenceRule: event.recurrence_rule,
    createdBy: event.created_by,
    createdByName: creator?.name ?? "Unknown",
    participants: participantsForEvent(event.id),
    canEdit: canEditEvent(actor, event),
    travelMinutes: event.travel_minutes,
    preparationMinutes: event.preparation_minutes,
  });
}

export type AgendaQuery = {
  from: string;
  to: string;
  calendarIds?: string[];
  memberIds?: string[];
  includeAllDay?: boolean;
  limit?: number;
};

export function listAgenda(actor: Actor, query: AgendaQuery): AgendaItem[] {
  const rangeStart = new Date(query.from);
  const rangeEnd = new Date(query.to);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
    throw new ValidationError("Invalid date range.");
  }
  if (rangeEnd <= rangeStart) throw new ValidationError("The end of the range must be after the start.");
  const events = all<EventRow>(
    `SELECT * FROM events
     WHERE household_id = ? AND starts_at <= ? AND (recurrence_rule IS NOT NULL OR ends_at >= ?)
     ORDER BY starts_at`,
    [actor.householdId, rangeEnd.toISOString(), rangeStart.toISOString()],
  );
  const calendars = new Map<string, CalendarRow>();
  for (const calendar of all<CalendarRow>(
    "SELECT * FROM calendars WHERE household_id = ? AND archived_at IS NULL",
    [actor.householdId],
  )) {
    calendars.set(calendar.id, calendar);
  }
  const items: AgendaItem[] = [];
  for (const event of events) {
    if (!canViewEvent(actor, event)) continue;
    if (query.calendarIds && query.calendarIds.length > 0 && !query.calendarIds.includes(event.calendar_id)) {
      continue;
    }
    const calendar = calendars.get(event.calendar_id);
    if (!calendar) continue;
    const occurrences = expandOccurrences(
      {
        id: event.id,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        timezone: event.timezone,
        recurrenceRule: event.recurrence_rule,
        exceptionDates: parseJson<string[]>(event.recurrence_exception_dates_json, []),
        status: event.status,
      },
      rangeStart,
      rangeEnd,
    );
    for (const occurrence of occurrences) {
      const item = eventToAgenda(actor, event, occurrence, calendar);
      if (query.memberIds && query.memberIds.length > 0) {
        const involved = new Set(item.participants.map((p) => p.memberId));
        if (calendar.owner_member_id) involved.add(calendar.owner_member_id);
        if (!query.memberIds.some((id) => involved.has(id))) continue;
      }
      if (query.includeAllDay === false && item.allDay) continue;
      items.push(item);
    }
  }
  items.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return query.limit ? items.slice(0, query.limit) : items;
}

export function getAgendaItem(actor: Actor, eventId: string): AgendaItem {
  const event = get<EventRow>(
    "SELECT * FROM events WHERE id = ? AND household_id = ?",
    [eventId, actor.householdId],
  );
  if (!event || !canViewEvent(actor, event)) throw new NotFoundError("Event not found.");
  const calendar = get<CalendarRow>("SELECT * FROM calendars WHERE id = ?", [event.calendar_id]);
  if (!calendar) throw new NotFoundError("Calendar not found.");
  const occurrence = expandOccurrences(
    {
      id: event.id,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      timezone: event.timezone,
      recurrenceRule: event.recurrence_rule,
      exceptionDates: parseJson<string[]>(event.recurrence_exception_dates_json, []),
      status: event.status,
    },
    new Date(new Date(event.starts_at).getTime() - 86_400_000),
    new Date(new Date(event.ends_at).getTime() + 86_400_000),
  )[0];
  if (!occurrence) throw new NotFoundError("Event occurrence not found.");
  return eventToAgenda(actor, event, occurrence, calendar);
}

function assertCalendarUsable(actor: Actor, calendarId: string): CalendarRow {
  const calendar = get<CalendarRow>(
    "SELECT * FROM calendars WHERE id = ? AND household_id = ? AND archived_at IS NULL",
    [calendarId, actor.householdId],
  );
  if (!calendar) throw new NotFoundError("Calendar not found.");
  if (!canViewCalendar(actor, calendar)) throw new ForbiddenError("You cannot use this calendar.");
  return calendar;
}

export function createEvent(actor: Actor, input: EventInput): EventRow {
  if (!can(actor, "event.create")) throw new ForbiddenError("Your role cannot create events.");
  const calendar = assertCalendarUsable(actor, input.calendarId);
  if (calendar.scope === "personal" && calendar.owner_member_id !== actor.id && !canManagePersonalCalendar(actor, calendar)) {
    throw new ForbiddenError("You can only add events to your own personal calendar.");
  }
  const title = input.title.trim();
  if (!title) throw new ValidationError("An event needs a title.");
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new ValidationError("Invalid start or end time.");
  }
  if (endsAt <= startsAt) throw new ValidationError("The event must end after it starts.");

  const participants = (input.participantIds ?? []).map((memberId) => {
    const member = get<MemberRow>(
      "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
      [memberId, actor.householdId],
    );
    if (!member) throw new ValidationError("A participant is not part of this household.");
    return member;
  });

  const id = newId("evt");
  run(
    `INSERT INTO events
      (id, household_id, calendar_id, created_by, title, description, location, starts_at, ends_at, all_day, timezone,
       visibility, status, recurrence_rule, recurrence_exception_dates_json, reminder_minutes_json, travel_minutes,
       preparation_minutes, source, external_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL, ?, ?)`,
    [
      id,
      actor.householdId,
      calendar.id,
      actor.id,
      title,
      input.description ?? null,
      input.location ?? null,
      startsAt.toISOString(),
      endsAt.toISOString(),
      input.allDay ? 1 : 0,
      input.timezone ?? actor.timezone,
      input.visibility ?? "household",
      input.status ?? "confirmed",
      input.recurrenceRule ?? null,
      toJson(input.exceptionDates ?? []),
      toJson(input.reminderMinutes ?? [15]),
      input.travelMinutes ?? 0,
      input.preparationMinutes ?? 0,
      nowIso(),
      nowIso(),
    ],
  );

  for (const participant of participants) {
    run(
      "INSERT INTO event_participants (event_id, member_id, response, is_required) VALUES (?, ?, 'invited', 1)",
      [id, participant.id],
    );
  }
  recordAudit(actor, "event.created", "event", id, { title, calendarId: calendar.id });
  for (const participant of participants) {
    if (participant.id === actor.id) continue;
    notifyMember(participant, {
      title: `New event: ${title}`,
      body: `${actor.name} added it to ${calendar.name} — ${formatDateTime(startsAt, participant.locale, participant.timezone)}`,
      category: "calendar",
      dedupeKey: `event-created:${id}:${participant.id}`,
      link: `/calendar?event=${id}`,
      urgency: "normal",
    });
  }
  return get<EventRow>("SELECT * FROM events WHERE id = ?", [id]) as EventRow;
}

export function updateEvent(actor: Actor, eventId: string, input: Partial<EventInput>): EventRow {
  const event = get<EventRow>(
    "SELECT * FROM events WHERE id = ? AND household_id = ?",
    [eventId, actor.householdId],
  );
  if (!event) throw new NotFoundError("Event not found.");
  if (!canEditEvent(actor, event)) throw new ForbiddenError("You cannot edit this event.");
  const startsAt = input.startsAt ? new Date(input.startsAt) : new Date(event.starts_at);
  const endsAt = input.endsAt ? new Date(input.endsAt) : new Date(event.ends_at);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw new ValidationError("The event must end after it starts.");
  }
  const calendarId = input.calendarId ?? event.calendar_id;
  if (input.calendarId && input.calendarId !== event.calendar_id) {
    const calendar = assertCalendarUsable(actor, input.calendarId);
    if (calendar.scope === "personal" && calendar.owner_member_id !== actor.id && !canManagePersonalCalendar(actor, calendar)) {
      throw new ForbiddenError("You cannot move an event into someone else's personal calendar.");
    }
  }
  run(
    `UPDATE events SET calendar_id = ?, title = ?, description = ?, location = ?, starts_at = ?, ends_at = ?,
      all_day = ?, visibility = ?, status = ?, recurrence_rule = ?, recurrence_exception_dates_json = ?,
      reminder_minutes_json = ?, travel_minutes = ?, preparation_minutes = ?, updated_at = ?
     WHERE id = ?`,
    [
      calendarId,
      input.title?.trim() || event.title,
      input.description !== undefined ? input.description : event.description,
      input.location !== undefined ? input.location : event.location,
      startsAt.toISOString(),
      endsAt.toISOString(),
      input.allDay !== undefined ? (input.allDay ? 1 : 0) : event.all_day,
      input.visibility ?? event.visibility,
      input.status ?? event.status,
      input.recurrenceRule !== undefined ? input.recurrenceRule : event.recurrence_rule,
      input.exceptionDates !== undefined ? toJson(input.exceptionDates) : event.recurrence_exception_dates_json,
      input.reminderMinutes !== undefined ? toJson(input.reminderMinutes) : event.reminder_minutes_json,
      input.travelMinutes ?? event.travel_minutes,
      input.preparationMinutes ?? event.preparation_minutes,
      nowIso(),
      event.id,
    ],
  );
  if (input.participantIds) {
    const existing = new Map(participantsForEvent(event.id).map((p) => [p.memberId, p.response]));
    run("DELETE FROM event_participants WHERE event_id = ?", [event.id]);
    for (const memberId of input.participantIds) {
      const member = get<MemberRow>(
        "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
        [memberId, actor.householdId],
      );
      if (!member) throw new ValidationError("A participant is not part of this household.");
      run(
        "INSERT INTO event_participants (event_id, member_id, response, is_required) VALUES (?, ?, ?, 1)",
        [event.id, memberId, existing.get(memberId) ?? "invited"],
      );
    }
  }
  recordAudit(actor, "event.updated", "event", event.id);
  return get<EventRow>("SELECT * FROM events WHERE id = ?", [event.id]) as EventRow;
}

export function cancelEvent(actor: Actor, eventId: string, reason?: string): void {
  const event = get<EventRow>(
    "SELECT * FROM events WHERE id = ? AND household_id = ?",
    [eventId, actor.householdId],
  );
  if (!event) throw new NotFoundError("Event not found.");
  if (!canEditEvent(actor, event)) throw new ForbiddenError("You cannot cancel this event.");
  run("UPDATE events SET status = 'cancelled', updated_at = ? WHERE id = ?", [nowIso(), event.id]);
  recordAudit(actor, "event.cancelled", "event", event.id, { reason });
  for (const participant of participantsForEvent(event.id)) {
    if (participant.memberId === actor.id) continue;
    const member = get<MemberRow>("SELECT * FROM members WHERE id = ?", [participant.memberId]);
    if (!member) continue;
    notifyMember(member, {
      title: `Cancelled: ${event.title}`,
      body: reason ?? `${actor.name} cancelled this event.`,
      category: "calendar",
      urgency: "high",
      dedupeKey: `event-cancelled:${event.id}:${member.id}`,
      link: "/calendar",
    });
  }
}

export function respondToEvent(
  actor: Actor,
  eventId: string,
  response: EventParticipantRow["response"],
): void {
  const event = get<EventRow>(
    "SELECT * FROM events WHERE id = ? AND household_id = ?",
    [eventId, actor.householdId],
  );
  if (!event) throw new NotFoundError("Event not found.");
  if (!canViewEvent(actor, event)) throw new ForbiddenError("You cannot respond to this event.");
  const participant = get<EventParticipantRow>(
    "SELECT * FROM event_participants WHERE event_id = ? AND member_id = ?",
    [eventId, actor.id],
  );
  if (!participant) throw new ValidationError("You are not invited to this event.");
  run("UPDATE event_participants SET response = ? WHERE event_id = ? AND member_id = ?", [
    response,
    eventId,
    actor.id,
  ]);
  recordAudit(actor, "event.rsvp", "event", eventId, { response });
}

function eventsInRange(actor: Actor, from: string, to: string): { event: EventRow; calendar: CalendarRow }[] {
  const rows = all<EventRow>(
    `SELECT * FROM events WHERE household_id = ? AND starts_at <= ? AND (recurrence_rule IS NOT NULL OR ends_at >= ?)`,
    [actor.householdId, to, from],
  );
  const result: { event: EventRow; calendar: CalendarRow }[] = [];
  for (const event of rows) {
    if (!canViewEvent(actor, event)) continue;
    const calendar = get<CalendarRow>("SELECT * FROM calendars WHERE id = ?", [event.calendar_id]);
    if (calendar) result.push({ event, calendar });
  }
  return result;
}

export type Conflict = {
  memberId: string;
  memberName: string;
  first: { eventId: string; title: string; startsAt: string; endsAt: string; localDate: string };
  second: { eventId: string; title: string; startsAt: string; endsAt: string; localDate: string };
  overlapMinutes: number;
};

export function detectConflicts(
  actor: Actor,
  from: string,
  to: string,
  memberIds?: string[],
): Conflict[] {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const members = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL",
    [actor.householdId],
  )
    .filter((member) => !memberIds || memberIds.includes(member.id))
    .filter((member) => canCoordinateMember(actor, member));
  const busyByMember = new Map<string, { item: AgendaItem; start: Date; end: Date }[]>();
  for (const member of members) busyByMember.set(member.id, []);

  for (const { event, calendar } of eventsInRange(actor, from, to)) {
    const occurrences = expandOccurrences(
      {
        id: event.id,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        timezone: event.timezone,
        recurrenceRule: event.recurrence_rule,
        exceptionDates: parseJson<string[]>(event.recurrence_exception_dates_json, []),
        status: event.status,
      },
      fromDate,
      toDate,
    );
    const participantIds = participantsForEvent(event.id).map((p) => p.memberId);
    const involved =
      participantIds.length > 0
        ? participantIds
        : calendar.owner_member_id
          ? [calendar.owner_member_id]
          : members.map((m) => m.id);
    for (const memberId of involved) {
      if (!busyByMember.has(memberId)) continue;
      for (const occurrence of occurrences) {
        const item = eventToAgenda(actor, event, occurrence, calendar);
        busyByMember.get(memberId)!.push({ item, start: occurrence.start, end: occurrence.end });
      }
    }
  }

  const conflicts: Conflict[] = [];
  for (const member of members) {
    const busy = (busyByMember.get(member.id) ?? []).sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 0; i < busy.length; i += 1) {
      for (let j = i + 1; j < busy.length; j += 1) {
        if (busy[j].start.getTime() >= busy[i].end.getTime()) break;
        if (busy[i].item.eventId === busy[j].item.eventId) continue;
        if (!rangesOverlap(busy[i].start, busy[i].end, busy[j].start, busy[j].end)) continue;
        const overlapMinutes = Math.round(
          (Math.min(busy[i].end.getTime(), busy[j].end.getTime()) -
            Math.max(busy[i].start.getTime(), busy[j].start.getTime())) /
            60_000,
        );
        conflicts.push({
          memberId: member.id,
          memberName: member.name,
          first: {
            eventId: busy[i].item.eventId,
            title: busy[i].item.title,
            startsAt: busy[i].item.startsAt,
            endsAt: busy[i].item.endsAt,
            localDate: busy[i].item.localDate,
          },
          second: {
            eventId: busy[j].item.eventId,
            title: busy[j].item.title,
            startsAt: busy[j].item.startsAt,
            endsAt: busy[j].item.endsAt,
            localDate: busy[j].item.localDate,
          },
          overlapMinutes,
        });
      }
    }
  }
  return conflicts;
}

export type AvailableSlot = { startsAt: string; endsAt: string };

export function findAvailableSlots(
  actor: Actor,
  input: { from: string; to: string; durationMinutes: number; memberIds: string[]; earliestHour?: number; latestHour?: number },
): AvailableSlot[] {
  if (input.memberIds.length === 0) throw new ValidationError("Choose at least one family member.");
  const allowedMemberIds = input.memberIds.filter((memberId) => {
    const member = get<MemberRow>("SELECT * FROM members WHERE id = ? AND household_id = ?", [
      memberId,
      actor.householdId,
    ]);
    return member ? canCoordinateMember(actor, member) : false;
  });
  if (allowedMemberIds.length === 0) {
    throw new ForbiddenError("You can only check availability for yourself.");
  }
  const duration = Math.max(15, input.durationMinutes);
  const fromDate = new Date(input.from);
  const toDate = new Date(input.to);
  const busy = new Map<string, { start: number; end: number }[]>();
  for (const memberId of allowedMemberIds) busy.set(memberId, []);

  for (const { event, calendar } of eventsInRange(actor, input.from, input.to)) {
    const occurrences = expandOccurrences(
      {
        id: event.id,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        timezone: event.timezone,
        recurrenceRule: event.recurrence_rule,
        exceptionDates: parseJson<string[]>(event.recurrence_exception_dates_json, []),
        status: event.status,
      },
      fromDate,
      toDate,
    );
    const participantIds = participantsForEvent(event.id).map((p) => p.memberId);
    const involved =
      participantIds.length > 0
        ? participantIds
        : calendar.owner_member_id
          ? [calendar.owner_member_id]
          : input.memberIds;
    for (const memberId of involved) {
      if (!busy.has(memberId)) continue;
      for (const occurrence of occurrences) {
        busy.get(memberId)!.push({ start: occurrence.start.getTime(), end: occurrence.end.getTime() });
      }
    }
  }

  const slots: AvailableSlot[] = [];
  const earliest = input.earliestHour ?? 8;
  const latest = input.latestHour ?? 21;
  const startDate = dateStringInZone(fromDate, actor.householdTimezone);
  const endDate = dateStringInZone(toDate, actor.householdTimezone);
  let cursorDate = startDate;
  let guard = 0;
  while (cursorDate <= endDate && slots.length < 5 && guard < 120) {
    guard += 1;
    const { year, month, day } = parseDateString(cursorDate);
    for (let minutes = earliest * 60; minutes + duration <= latest * 60; minutes += 30) {
      const start = zonedTimeToUtc(
        { year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
        actor.householdTimezone,
      );
      if (start.getTime() < Date.now()) continue;
      const end = new Date(start.getTime() + duration * 60_000);
      if (start > toDate) break;
      const allFree = [...busy.values()].every((intervals) =>
        intervals.every((interval) => end.getTime() <= interval.start || start.getTime() >= interval.end),
      );
      if (allFree) {
        slots.push({ startsAt: start.toISOString(), endsAt: end.toISOString() });
        if (slots.length >= 5) break;
      }
    }
    const next = new Date(Date.UTC(year, month - 1, day));
    next.setUTCDate(next.getUTCDate() + 1);
    cursorDate = next.toISOString().slice(0, 10);
  }
  return slots;
}
