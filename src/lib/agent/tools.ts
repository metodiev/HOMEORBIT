import { z } from "zod";
import type { Actor } from "@/lib/auth/actor";
import { canEditEvent, canCoordinateMember } from "@/lib/auth/access";
import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";
import { all, get, run } from "@/lib/db";
import type { EventRow, MemberRow, NoteRow, PackageRow, PickupRow, ShoppingListRow, TaskRow } from "@/lib/db/rows";
import { newId, nowIso, parseJson } from "@/lib/util/ids";
import {
  addDaysToDateString,
  dateStringInZone,
  formatDate,
  formatDateTime,
  formatTime,
  isoDayRange,
  startOfDayUtc,
  endOfDayUtc,
} from "@/lib/util/dates";
import { createEvent, detectConflicts, findAvailableSlots, getAgendaItem, listAgenda, updateEvent } from "@/lib/domain/events";
import { createTask, listTasks, setTaskStatus, updateTask } from "@/lib/domain/tasks";
import { addShoppingItem, listShoppingItems, listShoppingLists } from "@/lib/domain/shopping";
import { addShoppingItem as addItem } from "@/lib/domain/shopping";
import { createPackage, listPackages, setPackageStatus } from "@/lib/domain/packages";
import { createCall, listCalls } from "@/lib/domain/calls";
import { createNote, listNotes, searchNotes } from "@/lib/domain/notes";
import { createReminder } from "@/lib/domain/reminders";
import {
  assignPickup,
  listPickups,
  missingPickupArrangements,
  schoolChildren,
} from "@/lib/domain/school";
import {
  createPoll,
  createTrip,
  generateTripChecklist,
  getTrip,
  inviteToTrip,
  listTripRsvps,
  listTrips,
  respondToTrip,
} from "@/lib/domain/trips";
import { addMealPlanIngredientsToShoppingList, generateMealPlanDraft, listMealPlan, listRecipes, setMealPlanEntry } from "@/lib/domain/household";
import { holidaysInRange, upcomingHolidays } from "@/lib/domain/holidays";
import { getApproval, requestApproval, type ApprovalPayload } from "@/lib/domain/approvals";
import { notifyMember } from "@/lib/domain/notifications";
import { recordAudit } from "@/lib/domain/audit";

export type ToolOutcome = {
  ok: boolean;
  summary: string;
  data?: unknown;
  requiresApproval?: boolean;
  approvalId?: string;
  error?: string;
  notConfigured?: boolean;
};

export type ToolContext = { conversationId?: string | null; approved?: boolean };

type ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: S;
  requiresApproval?: (actor: Actor, args: z.infer<S>) => boolean;
  execute: (actor: Actor, args: z.infer<S>, context: ToolContext) => Promise<ToolOutcome> | ToolOutcome;
};

function iso(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function dayRangeIso(actor: Actor, from?: string, to?: string): { fromIso: string; toIso: string } {
  const today = dateStringInZone(new Date(), actor.timezone);
  const fromDate = from ?? today;
  const toDate = to ?? addDaysToDateString(fromDate, 7);
  return { fromIso: startOfDayUtc(fromDate, actor.timezone).toISOString(), toIso: endOfDayUtc(toDate, actor.timezone).toISOString() };
}

function memberName(memberId: string | null): string {
  if (!memberId) return "Unassigned";
  return get<MemberRow>("SELECT * FROM members WHERE id = ?", [memberId])?.name ?? "Unknown";
}

function findMemberByNameOrId(actor: Actor, value: string): MemberRow | undefined {
  const direct = get<MemberRow>(
    "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
    [value, actor.householdId],
  );
  if (direct) return direct;
  const members = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL",
    [actor.householdId],
  );
  const needle = value.trim().toLowerCase();
  return (
    members.find((member) => member.name.toLowerCase() === needle) ??
    members.find((member) => member.name.toLowerCase().startsWith(needle)) ??
    members.find((member) => member.name.toLowerCase().includes(needle))
  );
}

function resolveMemberIds(actor: Actor, values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  const ids = new Set<string>();
  for (const value of values) {
    const member = findMemberByNameOrId(actor, value);
    if (member) ids.add(member.id);
  }
  return [...ids];
}

function defaultCalendarId(actor: Actor, preferShared: boolean): string {
  const shared = get<{ id: string }>(
    "SELECT id FROM calendars WHERE household_id = ? AND scope = 'shared' AND archived_at IS NULL ORDER BY created_at LIMIT 1",
    [actor.householdId],
  );
  if (preferShared && shared) return shared.id;
  const personal = get<{ id: string }>(
    "SELECT id FROM calendars WHERE household_id = ? AND scope = 'personal' AND owner_member_id = ? AND archived_at IS NULL LIMIT 1",
    [actor.householdId, actor.id],
  );
  if (personal) return personal.id;
  if (shared) return shared.id;
  throw new ValidationError("No calendar is available. Create one first.");
}

function agendaView(actor: Actor, fromIso: string, toIso: string, memberIds?: string[]) {
  return listAgenda(actor, { from: fromIso, to: toIso, memberIds }).map((item) => ({
    eventId: item.eventId,
    title: item.title,
    localDate: item.localDate,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    allDay: item.allDay,
    location: item.location,
    calendar: item.calendarName,
    participants: item.participants.map((p) => ({ name: p.name, response: p.response })),
    canEdit: item.canEdit,
    visibility: item.visibility,
  }));
}

const eventIdSchema = z.object({ eventId: z.string().min(1) });

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

function schema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

const stringProp = (description: string) => ({ type: "string", description });
const boolProp = (description: string) => ({ type: "boolean", description });
const numberProp = (description: string) => ({ type: "number", description });
const stringArrayProp = (description: string) => ({ type: "array", items: { type: "string" }, description });

const definitions: ToolDefinition[] = [
  {
    name: "get_family_agenda",
    description:
      "Read the household agenda from the database for a date range. Returns events per day with participants, locations and calendars.",
    parameters: schema({
      dateFrom: stringProp("First day, YYYY-MM-DD. Defaults to today."),
      dateTo: stringProp("Last day, YYYY-MM-DD. Defaults to 7 days after dateFrom."),
      memberNames: stringArrayProp("Optional family member names or ids to filter by."),
    }),
    schema: z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      memberNames: z.array(z.string()).optional(),
    }),
    execute: (actor, args) => {
      const { fromIso, toIso } = dayRangeIso(actor, args.dateFrom, args.dateTo);
      const items = agendaView(actor, fromIso, toIso, resolveMemberIds(actor, args.memberNames));
      return {
        ok: true,
        summary: items.length === 0 ? "No events in that range." : `${items.length} event(s) in the agenda.`,
        data: { from: fromIso, to: toIso, items },
      };
    },
  },
  {
    name: "search_calendars",
    description: "Search visible calendar events by text in the title, description or location.",
    parameters: schema({
      query: stringProp("Text to search for."),
      dateFrom: stringProp("Optional start day YYYY-MM-DD."),
      dateTo: stringProp("Optional end day YYYY-MM-DD."),
    }),
    schema: z.object({ query: z.string().min(1), dateFrom: z.string().optional(), dateTo: z.string().optional() }),
    execute: (actor, args) => {
      const { fromIso, toIso } = dayRangeIso(actor, args.dateFrom ?? addDaysToDateString(dateStringInZone(new Date(), actor.timezone), -30), args.dateTo);
      const needle = args.query.toLowerCase();
      const items = listAgenda(actor, { from: fromIso, to: toIso })
        .filter((item) =>
          [item.title, item.description ?? "", item.location ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
        .slice(0, 25);
      return {
        ok: true,
        summary: items.length === 0 ? `No events match "${args.query}".` : `${items.length} matching event(s).`,
        data: items.map((item) => ({
          eventId: item.eventId,
          title: item.title,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          localDate: item.localDate,
          location: item.location,
          calendar: item.calendarName,
        })),
      };
    },
  },
  {
    name: "check_member_availability",
    description:
      "Find up to five time slots when the given family members are all free, based on events visible to the requesting member.",
    parameters: schema(
      {
        memberNames: stringArrayProp("Names or ids of members who must be free. Empty means the whole household."),
        dateFrom: stringProp("Start day YYYY-MM-DD. Defaults to today."),
        dateTo: stringProp("End day YYYY-MM-DD. Defaults to 14 days after dateFrom."),
        durationMinutes: numberProp("Required slot length in minutes, e.g. 90."),
        earliestHour: numberProp("Earliest local hour, default 8."),
        latestHour: numberProp("Latest local hour, default 21."),
      },
      ["durationMinutes"],
    ),
    schema: z.object({
      memberNames: z.array(z.string()).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      durationMinutes: z.number().int().min(15).max(720),
      earliestHour: z.number().int().min(0).max(23).optional(),
      latestHour: z.number().int().min(1).max(24).optional(),
    }),
    execute: (actor, args) => {
      const members = all<MemberRow>(
        "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL",
        [actor.householdId],
      ).filter((member) => canCoordinateMember(actor, member));
      const ids = (resolveMemberIds(actor, args.memberNames) ?? members.map((m) => m.id)).filter((id) =>
        members.some((member) => member.id === id),
      );
      const today = dateStringInZone(new Date(), actor.timezone);
      const from = startOfDayUtc(args.dateFrom ?? today, actor.timezone).toISOString();
      const to = endOfDayUtc(args.dateTo ?? addDaysToDateString(today, 14), actor.timezone).toISOString();
      const slots = findAvailableSlots(actor, {
        from,
        to,
        durationMinutes: args.durationMinutes,
        memberIds: ids,
        earliestHour: args.earliestHour,
        latestHour: args.latestHour,
      });
      return {
        ok: true,
        summary:
          slots.length === 0
            ? "No common free slot was found in that range."
            : `Found ${slots.length} possible slot(s).`,
        data: {
          consideredMembers: members.filter((m) => ids.includes(m.id)).map((m) => m.name),
          slots: slots.map((slot) => ({
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            local: `${formatDate(slot.startsAt, actor.locale, actor.householdTimezone)} ${formatTime(slot.startsAt, actor.locale, actor.householdTimezone)}–${formatTime(slot.endsAt, actor.locale, actor.householdTimezone)}`,
          })),
          note: "Only events visible to you are considered; private events of other adults are excluded.",
        },
      };
    },
  },
  {
    name: "detect_schedule_conflicts",
    description: "Detect overlapping events for family members in a date range.",
    parameters: schema({
      dateFrom: stringProp("Start day YYYY-MM-DD. Defaults to today."),
      dateTo: stringProp("End day YYYY-MM-DD. Defaults to 14 days after dateFrom."),
      memberNames: stringArrayProp("Optional names or ids."),
    }),
    schema: z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      memberNames: z.array(z.string()).optional(),
    }),
    execute: (actor, args) => {
      const today = dateStringInZone(new Date(), actor.timezone);
      const from = startOfDayUtc(args.dateFrom ?? today, actor.timezone).toISOString();
      const to = endOfDayUtc(args.dateTo ?? addDaysToDateString(today, 14), actor.timezone).toISOString();
      const conflicts = detectConflicts(actor, from, to, resolveMemberIds(actor, args.memberNames));
      return {
        ok: true,
        summary: conflicts.length === 0 ? "No scheduling conflicts were found." : `${conflicts.length} conflict(s) found.`,
        data: conflicts.map((conflict) => ({
          member: conflict.memberName,
          first: conflict.first.title,
          second: conflict.second.title,
          overlapMinutes: conflict.overlapMinutes,
          localDate: conflict.first.localDate,
        })),
      };
    },
  },
  {
    name: "create_event",
    description:
      "Create a calendar event. Use ISO 8601 timestamps with an offset (for example 2026-05-01T14:30:00+03:00). Always confirm details with the user before creating a shared family event.",
    parameters: schema(
      {
        title: stringProp("Event title."),
        startsAt: stringProp("Start timestamp in ISO 8601."),
        endsAt: stringProp("End timestamp in ISO 8601."),
        calendarId: stringProp("Optional calendar id."),
        participantNames: stringArrayProp("Optional member names or ids to invite."),
        location: stringProp("Optional location."),
        description: stringProp("Optional description."),
        allDay: boolProp("True for an all-day event."),
        visibility: { type: "string", enum: ["household", "private"], description: "Who can see it." },
        recurrenceRule: stringProp("Optional RRULE subset, e.g. FREQ=WEEKLY;BYDAY=MO."),
        travelMinutes: numberProp("Travel time in minutes."),
      },
      ["title", "startsAt", "endsAt"],
    ),
    schema: z.object({
      title: z.string().min(1),
      startsAt: z.string().min(1),
      endsAt: z.string().min(1),
      calendarId: z.string().optional(),
      participantNames: z.array(z.string()).optional(),
      location: z.string().optional(),
      description: z.string().optional(),
      allDay: z.boolean().optional(),
      visibility: z.enum(["household", "private"]).optional(),
      recurrenceRule: z.string().optional(),
      travelMinutes: z.number().int().min(0).max(600).optional(),
    }),
    execute: (actor, args) => {
      const event = createEvent(actor, {
        calendarId: args.calendarId ?? defaultCalendarId(actor, true),
        title: args.title,
        startsAt: iso(args.startsAt, nowIso()),
        endsAt: iso(args.endsAt, nowIso()),
        description: args.description ?? null,
        location: args.location ?? null,
        allDay: args.allDay,
        visibility: args.visibility,
        recurrenceRule: args.recurrenceRule ?? null,
        travelMinutes: args.travelMinutes,
        participantIds: resolveMemberIds(actor, args.participantNames),
      });
      return {
        ok: true,
        summary: `Created "${event.title}" on ${formatDateTime(event.starts_at, actor.locale, actor.timezone)}.`,
        data: { eventId: event.id, title: event.title, startsAt: event.starts_at, endsAt: event.ends_at },
      };
    },
  },
  {
    name: "update_event",
    description: "Change an event's time, title, location or description. Editing another member's event needs confirmation.",
    parameters: schema(
      {
        eventId: stringProp("Event id."),
        title: stringProp("New title."),
        startsAt: stringProp("New start ISO 8601."),
        endsAt: stringProp("New end ISO 8601."),
        location: stringProp("New location."),
        description: stringProp("New description."),
      },
      ["eventId"],
    ),
    schema: z.object({
      eventId: z.string().min(1),
      title: z.string().optional(),
      startsAt: z.string().optional(),
      endsAt: z.string().optional(),
      location: z.string().optional(),
      description: z.string().optional(),
    }),
    requiresApproval: (actor, args) => {
      const event = get<EventRow>("SELECT * FROM events WHERE id = ? AND household_id = ?", [
        args.eventId,
        actor.householdId,
      ]);
      return Boolean(event && event.created_by !== actor.id);
    },
    execute: (actor, args) => {
      const event = updateEvent(actor, args.eventId, {
        title: args.title,
        startsAt: args.startsAt ? iso(args.startsAt, nowIso()) : undefined,
        endsAt: args.endsAt ? iso(args.endsAt, nowIso()) : undefined,
        location: args.location,
        description: args.description,
      });
      return {
        ok: true,
        summary: `Updated "${event.title}" (${formatDateTime(event.starts_at, actor.locale, actor.timezone)}).`,
        data: { eventId: event.id },
      };
    },
  },
  {
    name: "request_event_confirmation",
    description: "Ask invited family members to respond to an event. Sends in-app notifications; it does not assume they agreed.",
    parameters: schema(
      {
        eventId: stringProp("Event id."),
        message: stringProp("Optional message to include."),
        memberNames: stringArrayProp("Optional subset of participants to ask."),
      },
      ["eventId"],
    ),
    schema: z.object({
      eventId: z.string().min(1),
      message: z.string().optional(),
      memberNames: z.array(z.string()).optional(),
    }),
    execute: (actor, args) => {
      const item = getAgendaItem(actor, args.eventId);
      const wanted = resolveMemberIds(actor, args.memberNames);
      const participants = item.participants.filter((p) => !wanted || wanted.includes(p.memberId));
      let sent = 0;
      for (const participant of participants) {
        if (participant.memberId === actor.id) continue;
        const member = get<MemberRow>("SELECT * FROM members WHERE id = ?", [participant.memberId]);
        if (!member) continue;
        notifyMember(member, {
          title: `Please confirm: ${item.title}`,
          body:
            args.message ??
            `${actor.name} asked whether you can still attend on ${formatDate(item.startsAt, member.locale, member.timezone)}.`,
          category: "calendar",
          urgency: "high",
          dedupeKey: `rsvp-request:${item.eventId}:${member.id}:${new Date().toISOString().slice(0, 10)}`,
          link: "/calendar",
        });
        sent += 1;
      }
      return {
        ok: true,
        summary: `Asked ${sent} participant(s) to confirm. Responses will appear as invited until they reply.`,
        data: { sent, participants: participants.map((p) => ({ name: p.name, response: p.response })) },
      };
    },
  },
  {
    name: "cancel_event",
    description: "Cancel an existing event. This always requires explicit approval before it happens.",
    parameters: schema({ eventId: stringProp("Event id."), reason: stringProp("Why it is cancelled.") }, ["eventId"]),
    schema: z.object({ eventId: z.string().min(1), reason: z.string().optional() }),
    requiresApproval: () => true,
    execute: (actor, args) => {
      const event = get<EventRow>("SELECT * FROM events WHERE id = ? AND household_id = ?", [
        args.eventId,
        actor.householdId,
      ]);
      if (!event) throw new ValidationError("Event not found.");
      if (!canEditEvent(actor, event)) throw new ValidationError("You cannot cancel this event.");
      run("UPDATE events SET status = 'cancelled', updated_at = ? WHERE id = ?", [nowIso(), event.id]);
      recordAudit(actor, "event.cancelled", "event", event.id, { reason: args.reason, via: "agent" });
      return { ok: true, summary: `Cancelled "${event.title}".`, data: { eventId: event.id } };
    },
  },
  {
    name: "create_task",
    description: "Create a household task or chore, optionally assigned and with a due date.",
    parameters: schema({
      title: stringProp("Task title."),
      dueAt: stringProp("Optional due timestamp ISO 8601."),
      assignedTo: stringProp("Optional member name or id."),
      priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
      category: stringProp("Category, e.g. chore, school, household, bill."),
      notes: stringProp("Optional notes."),
      recurrenceRule: stringProp("Optional recurrence, e.g. FREQ=WEEKLY."),
    }),
    schema: z.object({
      title: z.string().min(1),
      dueAt: z.string().optional(),
      assignedTo: z.string().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      category: z.string().optional(),
      notes: z.string().optional(),
      recurrenceRule: z.string().optional(),
    }),
    execute: (actor, args) => {
      const member = args.assignedTo ? findMemberByNameOrId(actor, args.assignedTo) : undefined;
      const task = createTask(actor, {
        title: args.title,
        dueAt: args.dueAt ? iso(args.dueAt, nowIso()) : null,
        assignedMemberId: member?.id ?? null,
        priority: args.priority,
        category: args.category,
        notes: args.notes,
        recurrenceRule: args.recurrenceRule,
      });
      return {
        ok: true,
        summary: `Created task "${task.title}"${member ? ` for ${member.name}` : ""}.`,
        data: { taskId: task.id },
      };
    },
  },
  {
    name: "assign_task",
    description: "Assign an existing task to a family member.",
    parameters: schema({ taskId: stringProp("Task id."), assignedTo: stringProp("Member name or id.") }, ["taskId", "assignedTo"]),
    schema: z.object({ taskId: z.string().min(1), assignedTo: z.string().min(1) }),
    execute: (actor, args) => {
      const member = findMemberByNameOrId(actor, args.assignedTo);
      if (!member) throw new ValidationError("Member not found.");
      const task = updateTask(actor, args.taskId, { assignedMemberId: member.id });
      return { ok: true, summary: `Assigned "${task.title}" to ${member.name}.`, data: { taskId: task.id } };
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as done. Recurring tasks schedule their next occurrence automatically.",
    parameters: schema({ taskId: stringProp("Task id.") }, ["taskId"]),
    schema: z.object({ taskId: z.string().min(1) }),
    execute: (actor, args) => {
      const task = setTaskStatus(actor, args.taskId, "done");
      return { ok: true, summary: `Completed "${task.title}".`, data: { taskId: task.id } };
    },
  },
  {
    name: "create_shopping_item",
    description: "Add an item to a shopping list. This is a low-risk action and runs immediately.",
    parameters: schema(
      {
        name: stringProp("Item name."),
        quantity: stringProp("Optional quantity, e.g. 2 kg."),
        listId: stringProp("Optional shopping list id."),
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        assignedTo: stringProp("Optional member name or id."),
        estimatedPrice: numberProp("Optional estimated price."),
        category: stringProp("Optional category."),
      },
      ["name"],
    ),
    schema: z.object({
      name: z.string().min(1),
      quantity: z.string().optional(),
      listId: z.string().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      assignedTo: z.string().optional(),
      estimatedPrice: z.number().min(0).optional(),
      category: z.string().optional(),
    }),
    execute: (actor, args) => {
      const member = args.assignedTo ? findMemberByNameOrId(actor, args.assignedTo) : undefined;
      const item = addShoppingItem(actor, {
        name: args.name,
        quantity: args.quantity,
        listId: args.listId,
        priority: args.priority,
        assignedMemberId: member?.id,
        estimatedPrice: args.estimatedPrice,
        category: args.category,
      });
      return { ok: true, summary: `Added "${item.name}" to the shopping list.`, data: { itemId: item.id } };
    },
  },
  {
    name: "list_shopping_items",
    description: "List open shopping items (optionally for one list) without changing anything.",
    parameters: schema({ listId: stringProp("Optional shopping list id."), includeBought: boolProp("Also include already bought items.") }),
    schema: z.object({ listId: z.string().optional(), includeBought: z.boolean().optional() }),
    execute: (actor, args) => {
      const lists = listShoppingLists(actor);
      const items = listShoppingItems(actor, { listId: args.listId, includeBought: args.includeBought });
      return {
        ok: true,
        summary: items.length === 0 ? "The shopping list is empty." : `${items.length} shopping item(s).`,
        data: {
          lists: lists.map((list) => ({ listId: list.id, name: list.name, openCount: list.openCount })),
          items: items.map((item) => ({
            itemId: item.id,
            listId: item.list_id,
            name: item.name,
            quantity: item.quantity,
            priority: item.priority,
            status: item.status,
            assignedTo: item.assigneeName,
          })),
        },
      };
    },
  },
  {
    name: "search_packages",
    description: "Look up packages and deliveries, optionally filtered by text or status.",
    parameters: schema({ query: stringProp("Optional text filter."), includeCompleted: boolProp("Include delivered/collected.") }),
    schema: z.object({ query: z.string().optional(), includeCompleted: z.boolean().optional() }),
    execute: (actor, args) => {
      const packages = listPackages(actor, { includeDone: args.includeCompleted }).filter((pkg) =>
        args.query
          ? [pkg.description, pkg.merchant ?? "", pkg.tracking_number ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(args.query.toLowerCase())
          : true,
      );
      return {
        ok: true,
        summary: packages.length === 0 ? "No matching packages." : `${packages.length} package(s).`,
        data: packages.map((pkg) => ({
          packageId: pkg.id,
          description: pkg.description,
          status: pkg.status,
          expected: pkg.expected_to,
          deadline: pkg.deadline,
          collector: pkg.collectorName,
          tracking: pkg.tracking_number,
        })),
      };
    },
  },
  {
    name: "update_package_status",
    description:
      "Record a package status that the user explicitly reported. Never invent tracking events; always include the reported note.",
    parameters: schema(
      {
        packageId: stringProp("Package id."),
        status: {
          type: "string",
          enum: ["expected", "in_transit", "out_for_delivery", "delivered", "collected", "missed", "returned"],
        },
        note: stringProp("What the user reported, e.g. 'carrier SMS says delivered'."),
      },
      ["packageId", "status"],
    ),
    schema: z.object({
      packageId: z.string().min(1),
      status: z.enum(["expected", "in_transit", "out_for_delivery", "delivered", "collected", "missed", "returned"]),
      note: z.string().optional(),
    }),
    execute: (actor, args) => {
      const pkg = setPackageStatus(actor, args.packageId, args.status, args.note ?? `Reported by ${actor.name}`);
      return {
        ok: true,
        summary: `Recorded "${pkg.description}" as ${args.status.replace(/_/g, " ")} (member-reported).`,
        data: { packageId: pkg.id, status: pkg.status, verified: false },
      };
    },
  },
  {
    name: "create_package",
    description: "Register an expected package or delivery so the household can coordinate who receives it.",
    parameters: schema(
      {
        description: stringProp("What is arriving."),
        merchant: stringProp("Optional merchant."),
        expectedFrom: stringProp("Optional expected start timestamp."),
        expectedTo: stringProp("Optional expected end timestamp."),
        collector: stringProp("Optional member name or id who can receive it."),
        deadline: stringProp("Optional collection deadline."),
        instructions: stringProp("Optional delivery instructions."),
      },
      ["description"],
    ),
    schema: z.object({
      description: z.string().min(1),
      merchant: z.string().optional(),
      expectedFrom: z.string().optional(),
      expectedTo: z.string().optional(),
      collector: z.string().optional(),
      deadline: z.string().optional(),
      instructions: z.string().optional(),
    }),
    execute: (actor, args) => {
      const collector = args.collector ? findMemberByNameOrId(actor, args.collector) : undefined;
      const pkg = createPackage(actor, {
        description: args.description,
        merchant: args.merchant,
        expectedFrom: args.expectedFrom ? iso(args.expectedFrom, nowIso()) : null,
        expectedTo: args.expectedTo ? iso(args.expectedTo, nowIso()) : null,
        collectorMemberId: collector?.id,
        deadline: args.deadline ? iso(args.deadline, nowIso()) : null,
        instructions: args.instructions,
      });
      return {
        ok: true,
        summary: `Registered "${pkg.description}"${collector ? ` for ${collector.name}` : ""}.`,
        data: { packageId: pkg.id },
      };
    },
  },
  {
    name: "record_phone_call",
    description: "Record a missed call, callback or call that needs follow-up.",
    parameters: schema(
      {
        contactName: stringProp("Person or organisation."),
        direction: { type: "string", enum: ["incoming", "outgoing", "missed"] },
        reason: stringProp("Why the call matters."),
        callbackAt: stringProp("When to call back (ISO 8601)."),
        assignedTo: stringProp("Member name or id."),
        notes: stringProp("Optional notes."),
      },
      ["contactName", "direction"],
    ),
    schema: z.object({
      contactName: z.string().min(1),
      direction: z.enum(["incoming", "outgoing", "missed"]),
      reason: z.string().optional(),
      callbackAt: z.string().optional(),
      assignedTo: z.string().optional(),
      notes: z.string().optional(),
    }),
    execute: (actor, args) => {
      const member = args.assignedTo ? findMemberByNameOrId(actor, args.assignedTo) : undefined;
      const call = createCall(actor, {
        contactName: args.contactName,
        direction: args.direction,
        reason: args.reason,
        callbackAt: args.callbackAt ? iso(args.callbackAt, nowIso()) : null,
        assignedMemberId: member?.id,
        notes: args.notes,
      });
      return {
        ok: true,
        summary: `Recorded a ${args.direction} call with ${call.contact_name}${member ? ` for ${member.name}` : ""}.`,
        data: { callId: call.id },
      };
    },
  },
  {
    name: "create_reminder",
    description: "Create a reminder for a family member.",
    parameters: schema(
      { title: stringProp("What to remember."), remindAt: stringProp("Reminder timestamp ISO 8601."), memberName: stringProp("Member name or id; defaults to you.") },
      ["title", "remindAt"],
    ),
    schema: z.object({ title: z.string().min(1), remindAt: z.string().min(1), memberName: z.string().optional() }),
    execute: (actor, args) => {
      const member = args.memberName ? findMemberByNameOrId(actor, args.memberName) : undefined;
      const reminder = createReminder(actor, {
        title: args.title,
        remindAt: iso(args.remindAt, nowIso()),
        memberId: member?.id,
      });
      return { ok: true, summary: `Reminder set for ${formatDateTime(reminder.remind_at, actor.locale, actor.timezone)}.`, data: { reminderId: reminder.id } };
    },
  },
  {
    name: "search_family_notes",
    description: "Search shared notes and documents the requesting member is allowed to see.",
    parameters: schema({ query: stringProp("Search words.") }),
    schema: z.object({ query: z.string().min(1) }),
    execute: (actor, args) => {
      const notes = searchNotes(actor, args.query);
      return {
        ok: true,
        summary: notes.length === 0 ? "No accessible notes match." : `${notes.length} note(s) found.`,
        data: notes.map((note) => ({
          noteId: note.id,
          title: note.title,
          category: note.category,
          excerpt: note.body.slice(0, 240),
          sensitive: note.sensitive === 1,
        })),
      };
    },
  },
  {
    name: "create_family_note",
    description:
      "Save a shared note, instruction or document reference. Sensitive notes (codes, financial or medical details) require approval before sharing.",
    parameters: schema(
      {
        title: stringProp("Note title."),
        body: stringProp("Note content."),
        visibility: { type: "string", enum: ["household", "private", "restricted"] },
        category: stringProp("Category: general, emergency, appliance, recipe, school, travel, instruction, link."),
        sensitive: boolProp("True for access codes, financial or medical details."),
        sharedWith: stringArrayProp("Member names or ids for restricted notes."),
      },
      ["title", "body"],
    ),
    schema: z.object({
      title: z.string().min(1),
      body: z.string().min(1),
      visibility: z.enum(["household", "private", "restricted"]).optional(),
      category: z.string().optional(),
      sensitive: z.boolean().optional(),
      sharedWith: z.array(z.string()).optional(),
    }),
    requiresApproval: (actor, args) => Boolean(args.sensitive) && args.visibility !== "private",
    execute: (actor, args) => {
      const note = createNote(actor, {
        title: args.title,
        body: args.body,
        visibility: args.visibility,
        category: args.category,
        sensitive: args.sensitive,
        sharedWith: resolveMemberIds(actor, args.sharedWith),
      });
      return { ok: true, summary: `Saved note "${note.title}".`, data: { noteId: note.id } };
    },
  },
  {
    name: "create_holiday_poll",
    description: "Create a poll to choose dates, a destination or an activity for a trip or holiday.",
    parameters: schema(
      {
        tripId: stringProp("Optional trip id."),
        question: stringProp("Poll question."),
        kind: { type: "string", enum: ["date", "destination", "activity"] },
        options: { type: "array", items: { type: "string" }, description: "Two or more options." },
        closesAt: stringProp("Optional closing timestamp."),
      },
      ["question", "kind", "options"],
    ),
    schema: z.object({
      tripId: z.string().optional(),
      question: z.string().min(1),
      kind: z.enum(["date", "destination", "activity"]),
      options: z.array(z.string().min(1)).min(2),
      closesAt: z.string().optional(),
    }),
    execute: (actor, args) => {
      const poll = createPoll(actor, {
        tripId: args.tripId,
        question: args.question,
        kind: args.kind,
        options: args.options.map((label: string) => ({ label })),
        closesAt: args.closesAt ? iso(args.closesAt, nowIso()) : null,
      });
      return { ok: true, summary: `Created poll "${poll.question}" with ${args.options.length} options.`, data: { pollId: poll.id } };
    },
  },
  {
    name: "collect_event_rsvps",
    description: "Summarise who accepted, declined or has not replied. Unanswered invitations are never treated as confirmed.",
    parameters: schema({ eventId: stringProp("Event id.") }, ["eventId"]),
    schema: eventIdSchema,
    execute: (actor, args) => {
      const item = getAgendaItem(actor, args.eventId);
      const accepted = item.participants.filter((p) => p.response === "accepted");
      const awaiting = item.participants.filter((p) => p.response === "invited" || p.response === "awaiting");
      return {
        ok: true,
        summary:
          awaiting.length === 0
            ? "Everyone has replied."
            : `${awaiting.length} participant(s) have not confirmed yet.`,
        data: {
          title: item.title,
          accepted: accepted.map((p) => p.name),
          awaiting: awaiting.map((p) => p.name),
          declined: item.participants.filter((p) => p.response === "declined").map((p) => p.name),
          tentative: item.participants.filter((p) => p.response === "tentative").map((p) => p.name),
          note: "Only accepted responses count as confirmed.",
        },
      };
    },
  },
  {
    name: "generate_meal_plan",
    description: "Draft a dinner plan from stored recipes. Set save to true to write the draft into the meal plan.",
    parameters: schema(
      {
        fromDate: stringProp("First day YYYY-MM-DD. Defaults to today."),
        days: numberProp("Number of days, max 14."),
        save: boolProp("Persist the draft and add its ingredients to the shopping list."),
        avoidTags: stringArrayProp("Tags to avoid, e.g. nuts, dairy."),
      },
      [],
    ),
    schema: z.object({
      fromDate: z.string().optional(),
      days: z.number().int().min(1).max(14).optional(),
      save: z.boolean().optional(),
      avoidTags: z.array(z.string()).optional(),
    }),
    execute: (actor, args) => {
      const fromDate = args.fromDate ?? dateStringInZone(new Date(), actor.timezone);
      const draft = generateMealPlanDraft(actor, { fromDate, days: args.days, avoidTags: args.avoidTags });
      if (draft.length === 0) {
        return { ok: true, summary: "No recipes are stored yet, so I cannot draft a meal plan.", data: { draft: [] } };
      }
      if (args.save) {
        for (const entry of draft) {
          setMealPlanEntry(actor, { date: entry.date, mealType: entry.mealType, title: entry.title, recipeId: entry.recipeId });
        }
        const result = addMealPlanIngredientsToShoppingList(actor, {
          fromDate,
          toDate: addDaysToDateString(fromDate, draft.length - 1),
        });
        return {
          ok: true,
          summary: `Saved a ${draft.length}-day dinner plan and added ${result.added} shopping item(s).`,
          data: { draft, shoppingItems: result.added },
        };
      }
      return { ok: true, summary: `Prepared a ${draft.length}-day dinner plan draft.`, data: { draft } };
    },
  },
  {
    name: "generate_trip_checklist",
    description: "Create preparation tasks and a packing shopping list for a trip.",
    parameters: schema(
      { tripId: stringProp("Trip id."), days: numberProp("Trip length in days."), assignedTo: stringProp("Optional member name or id.") },
      ["tripId"],
    ),
    schema: z.object({ tripId: z.string().min(1), days: z.number().int().min(1).max(60).optional(), assignedTo: z.string().optional() }),
    execute: (actor, args) => {
      const member = args.assignedTo ? findMemberByNameOrId(actor, args.assignedTo) : undefined;
      const result = generateTripChecklist(actor, args.tripId, {
        days: args.days,
        assignToMemberId: member?.id ?? actor.id,
      });
      return {
        ok: true,
        summary: `Created ${result.tasks} preparation task(s) and ${result.shoppingItems} shopping item(s).`,
        data: result,
      };
    },
  },
  {
    name: "summarize_family_week",
    description: "Build a factual weekly briefing from the database: agenda, conflicts, tasks, packages, pickups and holidays.",
    parameters: schema({ dateFrom: stringProp("Optional first day YYYY-MM-DD.") }),
    schema: z.object({ dateFrom: z.string().optional() }),
    execute: (actor, args) => {
      const today = dateStringInZone(new Date(), actor.timezone);
      const fromDate = args.dateFrom ?? today;
      const toDate = addDaysToDateString(fromDate, 6);
      const { fromIso, toIso } = dayRangeIso(actor, fromDate, toDate);
      const agenda = agendaView(actor, fromIso, toIso);
      const conflicts = detectConflicts(actor, fromIso, toIso);
      const tasks = listTasks(actor, { status: "open" }).filter(
        (task) => task.due_at && task.due_at >= fromIso && task.due_at <= toIso,
      );
      const packages = listPackages(actor).filter(
        (pkg) => pkg.deadline && pkg.deadline <= toIso && pkg.deadline >= fromIso,
      );
      const missing = missingPickupArrangements(actor, fromDate, toDate);
      const holidays = upcomingHolidays(actor, fromDate, 7);
      return {
        ok: true,
        summary: `${agenda.length} event(s), ${tasks.length} task(s), ${conflicts.length} conflict(s) and ${missing.length} missing pickup arrangement(s) in the week.`,
        data: {
          from: fromDate,
          to: toDate,
          agenda,
          conflicts,
          tasks: tasks.map((task) => ({ title: task.title, dueAt: task.due_at, assignee: task.assigneeName })),
          packages: packages.map((pkg) => ({ description: pkg.description, deadline: pkg.deadline, status: pkg.status })),
          missingPickupArrangements: missing,
          holidays,
        },
      };
    },
  },
  {
    name: "list_school_pickups",
    description: "List school runs and flag missing or unconfirmed arrangements.",
    parameters: schema({ dateFrom: stringProp("First day YYYY-MM-DD."), dateTo: stringProp("Last day YYYY-MM-DD.") }, []),
    schema: z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }),
    execute: (actor, args) => {
      const today = dateStringInZone(new Date(), actor.timezone);
      const from = args.dateFrom ?? today;
      const to = args.dateTo ?? addDaysToDateString(from, 7);
      const pickups = listPickups(actor, from, to);
      const missing = missingPickupArrangements(actor, from, to);
      return {
        ok: true,
        summary: `${pickups.length} school run(s); ${missing.length} need attention.`,
        data: {
          pickups: pickups.map((pickup) => ({
            pickupId: pickup.id,
            child: pickup.childName,
            date: pickup.date,
            time: pickup.time,
            direction: pickup.direction,
            responsible: pickup.responsibleName,
            status: pickup.status,
          })),
          missing,
        },
      };
    },
  },
  {
    name: "assign_school_pickup",
    description:
      "Assign an adult to a school pickup. If someone else is already responsible, the change needs guardian approval.",
    parameters: schema(
      { pickupId: stringProp("Pickup id."), assignedTo: stringProp("Adult name or id.") },
      ["pickupId", "assignedTo"],
    ),
    schema: z.object({ pickupId: z.string().min(1), assignedTo: z.string().min(1) }),
    requiresApproval: (actor, args) => {
      const pickup = get<PickupRow>("SELECT * FROM pickups WHERE id = ? AND household_id = ?", [
        args.pickupId,
        actor.householdId,
      ]);
      return Boolean(pickup && pickup.responsible_member_id && pickup.responsible_member_id !== actor.id);
    },
    execute: (actor, args) => {
      const member = findMemberByNameOrId(actor, args.assignedTo);
      if (!member) throw new ValidationError("Member not found.");
      const pickup = assignPickup(actor, args.pickupId, member.id);
      return {
        ok: true,
        summary: `${member.name} is now responsible for the ${pickup.direction} on ${pickup.date} at ${pickup.time}. The arrangement is not confirmed yet.`,
        data: { pickupId: pickup.id, status: pickup.status },
      };
    },
  },
  {
    name: "list_holiday_options",
    description: "Show upcoming public holidays and open trip invitations, including who has not replied.",
    parameters: schema({ days: numberProp("Look-ahead window in days, default 120.") }, []),
    schema: z.object({ days: z.number().int().min(1).max(365).optional() }),
    execute: (actor, args) => {
      const today = dateStringInZone(new Date(), actor.timezone);
      const holidays = upcomingHolidays(actor, today, args.days ?? 120);
      const trips = listTrips(actor).map((trip) => ({
        tripId: trip.id,
        title: trip.title,
        destination: trip.destination,
        startsAt: trip.starts_at,
        status: trip.status,
        rsvpSummary: trip.rsvpSummary,
      }));
      return {
        ok: true,
        summary: `${holidays.length} upcoming public holiday(s) and ${trips.length} planned trip(s).`,
        data: { holidays, trips },
      };
    },
  },
];

const toolRegistry = new Map(definitions.map((definition) => [definition.name, definition]));

export function toolSpecs(): ToolSpec[] {
  return definitions.map((definition) => ({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  }));
}

export function toolNames(): string[] {
  return definitions.map((definition) => definition.name);
}

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name);
}

function logExecution(
  actor: Actor,
  name: string,
  args: unknown,
  outcome: ToolOutcome,
  context: ToolContext,
  durationMs: number,
  error?: string,
): void {
  run(
    `INSERT INTO tool_executions (id, household_id, member_id, conversation_id, tool_name, arguments_json,
      result_json, status, error, approval_id, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("tex"),
      actor.householdId,
      actor.id,
      context.conversationId ?? null,
      name,
      JSON.stringify(args ?? {}),
      outcome.data === undefined ? null : JSON.stringify(outcome.data),
      outcome.requiresApproval ? "pending_approval" : outcome.ok ? "success" : "error",
      error ?? outcome.error ?? null,
      outcome.approvalId ?? null,
      durationMs,
      nowIso(),
    ],
  );
}

export async function executeTool(
  actor: Actor,
  name: string,
  rawArgs: Record<string, unknown>,
  context: ToolContext = {},
): Promise<ToolOutcome> {
  const definition = toolRegistry.get(name);
  if (!definition) {
    return { ok: false, error: `Unknown tool: ${name}`, summary: `Unknown tool: ${name}` };
  }
  const parsed = definition.schema.safeParse(rawArgs);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
    const outcome = { ok: false, error: message, summary: `Invalid arguments for ${name}: ${message}` };
    logExecution(actor, name, rawArgs, outcome, context, 0, message);
    return outcome;
  }
  const started = Date.now();
  try {
    if (definition.requiresApproval?.(actor, parsed.data) && !context.approved) {
      const payload: ApprovalPayload = { toolName: name, arguments: parsed.data as Record<string, unknown> };
      const approval = requestApproval(actor, {
        action: name,
        summary: `${actor.name} asked the assistant to run ${name}.`,
        payload,
      });
      const outcome: ToolOutcome = {
        ok: false,
        requiresApproval: true,
        approvalId: approval.id,
        summary: `This action needs confirmation. Approval request ${approval.id} is waiting in Approvals.`,
        error: "pending_approval",
      };
      logExecution(actor, name, parsed.data, outcome, context, Date.now() - started);
      return outcome;
    }
    const outcome = await definition.execute(actor, parsed.data, context);
    logExecution(actor, name, parsed.data, outcome, context, Date.now() - started);
    return outcome;
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof Error
          ? error.message
          : "The action failed.";
    const outcome: ToolOutcome = {
      ok: false,
      error: message,
      summary: message,
    };
    logExecution(actor, name, parsed.data, outcome, context, Date.now() - started);
    return outcome;
  }
}

/** Executes a previously approved request. Called only after `decideApproval` succeeds. */
export async function executeApprovedTool(actor: Actor, approvalId: string): Promise<ToolOutcome> {
  const approval = getApproval(actor, approvalId);
  const payload = parseJson<ApprovalPayload>(approval.payload_json, { toolName: "", arguments: {} });
  if (!payload.toolName) return { ok: false, error: "Approval payload is invalid.", summary: "Invalid approval payload." };
  const outcome = await executeTool(actor, payload.toolName, payload.arguments, {
    approved: true,
  });
  recordAudit(actor, outcome.ok ? "approval.executed" : "approval.failed", "approval", approvalId, {
    tool: payload.toolName,
    error: outcome.error ?? null,
  });
  return outcome;
}
