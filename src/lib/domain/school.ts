import { all, get, run } from "@/lib/db";
import type { MemberRow, PickupRow, SchoolDayRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso } from "@/lib/util/ids";
import { notifyKidsGuardians, notifyMember } from "./notifications";
import { recordAudit } from "./audit";

export type SchoolDayView = SchoolDayRow & { childName: string; childColor: string; childAvatar: string };
export type PickupView = PickupRow & {
  childName: string;
  childColor: string;
  childAvatar: string;
  responsibleName: string | null;
  responsibleColor: string | null;
  confirmedByName: string | null;
};

export function schoolChildren(actor: Actor): MemberRow[] {
  return all<MemberRow>(
    `SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL AND role IN ('child','teen')
     ORDER BY name`,
    [actor.householdId],
  );
}

export function listSchoolDays(actor: Actor, from: string, to: string): SchoolDayView[] {
  if (actor.role === "relative") {
    throw new ForbiddenError("School information is limited to household members.");
  }
  return all<SchoolDayView>(
    `SELECT sd.*, m.name AS childName, m.color AS childColor, m.avatar AS childAvatar
     FROM school_days sd JOIN members m ON m.id = sd.member_id
     WHERE sd.household_id = ? AND sd.date >= ? AND sd.date <= ? ORDER BY sd.date, m.name`,
    [actor.householdId, from, to],
  );
}

export function upsertSchoolDay(
  actor: Actor,
  input: {
    memberId: string;
    date: string;
    startTime?: string | null;
    endTime?: string | null;
    earlyDismissal?: boolean;
    notes?: string | null;
  },
): SchoolDayRow {
  if (!can(actor, "school.manage")) throw new ForbiddenError("Your role cannot change school schedules.");
  const child = get<MemberRow>(
    "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
    [input.memberId, actor.householdId],
  );
  if (!child) throw new ValidationError("That child is not part of this household.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError("Use a valid date (YYYY-MM-DD).");
  const existing = get<SchoolDayRow>(
    "SELECT * FROM school_days WHERE member_id = ? AND date = ?",
    [child.id, input.date],
  );
  if (existing) {
    run(
      `UPDATE school_days SET start_time = ?, end_time = ?, early_dismissal = ?, notes = ?, source = 'manual'
       WHERE id = ?`,
      [
        input.startTime ?? existing.start_time,
        input.endTime ?? existing.end_time,
        input.earlyDismissal ? 1 : 0,
        input.notes !== undefined ? input.notes : existing.notes,
        existing.id,
      ],
    );
    recordAudit(actor, "school_day.updated", "school_day", existing.id, { date: input.date });
    return get<SchoolDayRow>("SELECT * FROM school_days WHERE id = ?", [existing.id]) as SchoolDayRow;
  }
  const id = newId("scd");
  run(
    `INSERT INTO school_days (id, household_id, member_id, date, start_time, end_time, early_dismissal, notes, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
    [
      id,
      actor.householdId,
      child.id,
      input.date,
      input.startTime ?? "08:00",
      input.endTime ?? "14:30",
      input.earlyDismissal ? 1 : 0,
      input.notes ?? null,
    ],
  );
  recordAudit(actor, "school_day.created", "school_day", id, { date: input.date, child: child.name });
  return get<SchoolDayRow>("SELECT * FROM school_days WHERE id = ?", [id]) as SchoolDayRow;
}

export function listPickups(actor: Actor, from: string, to: string): PickupView[] {
  if (actor.role === "relative") throw new ForbiddenError("School run information is limited to the household.");
  return all<PickupView>(
    `SELECT p.*, c.name AS childName, c.color AS childColor, c.avatar AS childAvatar,
            r.name AS responsibleName, r.color AS responsibleColor, cb.name AS confirmedByName
     FROM pickups p
     JOIN members c ON c.id = p.member_id
     LEFT JOIN members r ON r.id = p.responsible_member_id
     LEFT JOIN members cb ON cb.id = p.confirmed_by
     WHERE p.household_id = ? AND p.date >= ? AND p.date <= ? AND p.status != 'cancelled'
     ORDER BY p.date, p.time`,
    [actor.householdId, from, to],
  );
}

export function createPickup(
  actor: Actor,
  input: {
    memberId: string;
    date: string;
    direction: "dropoff" | "pickup";
    time: string;
    responsibleMemberId?: string | null;
    notes?: string | null;
  },
): PickupRow {
  if (!can(actor, "school.manage")) throw new ForbiddenError("Your role cannot change the school run.");
  const child = get<MemberRow>(
    "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
    [input.memberId, actor.householdId],
  );
  if (!child) throw new ValidationError("That child is not part of this household.");
  if (!/^\d{2}:\d{2}$/.test(input.time)) throw new ValidationError("Use a time like 14:30.");
  if (input.responsibleMemberId) assertAdultResponsible(actor, input.responsibleMemberId);
  const id = newId("pck");
  run(
    `INSERT INTO pickups (id, household_id, member_id, date, direction, time, responsible_member_id, status,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      actor.householdId,
      child.id,
      input.date,
      input.direction,
      input.time,
      input.responsibleMemberId ?? null,
      input.responsibleMemberId ? "assigned" : "unassigned",
      nowIso(),
      nowIso(),
    ],
  );
  recordAudit(actor, "pickup.created", "pickup", id, { child: child.name, date: input.date, direction: input.direction });
  if (input.responsibleMemberId) {
    notifyPickupAssignees(actor, child, input.responsibleMemberId, input.date, input.time, input.direction);
  }
  return get<PickupRow>("SELECT * FROM pickups WHERE id = ?", [id]) as PickupRow;
}

function assertAdultResponsible(actor: Actor, memberId: string): void {
  const member = get<MemberRow>(
    "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
    [memberId, actor.householdId],
  );
  if (!member) throw new ValidationError("That family member does not exist.");
  if (member.role === "child") throw new ValidationError("A child cannot be responsible for the school run.");
}

function notifyPickupAssignees(
  actor: Actor,
  child: MemberRow,
  responsibleId: string,
  date: string,
  time: string,
  direction: "dropoff" | "pickup",
): void {
  const responsible = get<MemberRow>("SELECT * FROM members WHERE id = ?", [responsibleId]);
  if (!responsible) return;
  notifyMember(responsible, {
    title: `${direction === "pickup" ? "Pickup" : "Drop-off"} for ${child.name}`,
    body: `${date} at ${time}. Added by ${actor.name}.`,
    category: "school",
    urgency: "high",
    dedupeKey: `pickup-assigned:${child.id}:${date}:${direction}:${responsible.id}`,
    link: "/school",
  });
}

/** Creates school-run rows for every recorded school day that has no pickup entry yet. */
export function ensurePickupsForRange(actor: Actor, from: string, to: string): number {
  if (!can(actor, "school.manage")) throw new ForbiddenError("Your role cannot change the school run.");
  const schoolDays = listSchoolDays(actor, from, to);
  let created = 0;
  for (const day of schoolDays) {
    if (!day.end_time) continue;
    const existing = get<PickupRow>(
      "SELECT * FROM pickups WHERE member_id = ? AND date = ? AND direction = 'pickup'",
      [day.member_id, day.date],
    );
    if (existing) continue;
    createPickup(actor, {
      memberId: day.member_id,
      date: day.date,
      direction: "pickup",
      time: day.end_time,
      notes: day.early_dismissal ? "Early dismissal" : null,
    });
    created += 1;
  }
  return created;
}

export function assignPickup(
  actor: Actor,
  pickupId: string,
  responsibleMemberId: string | null,
): PickupRow {
  const pickup = get<PickupRow>("SELECT * FROM pickups WHERE id = ? AND household_id = ?", [
    pickupId,
    actor.householdId,
  ]);
  if (!pickup) throw new NotFoundError("Pickup not found.");
  const isResponsible = pickup.responsible_member_id === actor.id;
  if (!can(actor, "school.manage") && !isResponsible) {
    throw new ForbiddenError("You cannot change this pickup.");
  }
  if (responsibleMemberId && responsibleMemberId !== actor.id) {
    if (!can(actor, "school.manage")) throw new ForbiddenError("Only a guardian can assign someone else.");
    assertAdultResponsible(actor, responsibleMemberId);
  }
  run("UPDATE pickups SET responsible_member_id = ?, status = ?, confirmed_by = NULL, confirmed_at = NULL, updated_at = ? WHERE id = ?", [
    responsibleMemberId,
    responsibleMemberId ? "assigned" : "unassigned",
    nowIso(),
    pickup.id,
  ]);
  recordAudit(actor, "pickup.assigned", "pickup", pickup.id, { responsibleMemberId });
  if (responsibleMemberId) {
    const child = get<MemberRow>("SELECT * FROM members WHERE id = ?", [pickup.member_id]);
    if (child) {
      notifyPickupAssignees(actor, child, responsibleMemberId, pickup.date, pickup.time, pickup.direction);
    }
  }
  return get<PickupRow>("SELECT * FROM pickups WHERE id = ?", [pickup.id]) as PickupRow;
}

/**
 * A guardian or the responsible adult explicitly confirms the arrangement.
 * This is a coordination confirmation, never proof that a child arrived.
 */
export function confirmPickup(actor: Actor, pickupId: string): PickupRow {
  const pickup = get<PickupRow>("SELECT * FROM pickups WHERE id = ? AND household_id = ?", [
    pickupId,
    actor.householdId,
  ]);
  if (!pickup) throw new NotFoundError("Pickup not found.");
  if (pickup.responsible_member_id !== actor.id && !can(actor, "school.manage")) {
    throw new ForbiddenError("Only the responsible adult or a guardian can confirm this pickup.");
  }
  if (!pickup.responsible_member_id) {
    throw new ValidationError("Assign someone responsible before confirming.");
  }
  run("UPDATE pickups SET status = 'confirmed', confirmed_by = ?, confirmed_at = ?, updated_at = ? WHERE id = ?", [
    actor.id,
    nowIso(),
    nowIso(),
    pickup.id,
  ]);
  recordAudit(actor, "pickup.confirmed", "pickup", pickup.id, {
    note: "Coordination confirmed; not a verified arrival.",
  });
  notifyKidsGuardians(actor, {
    title: "School run confirmed",
    body: `${actor.name} confirmed the arrangement for ${pickup.date} at ${pickup.time}.`,
    category: "school",
    dedupeKey: `pickup-confirmed:${pickup.id}:${actor.id}`,
    urgency: "normal",
    link: "/school",
  });
  return get<PickupRow>("SELECT * FROM pickups WHERE id = ?", [pickup.id]) as PickupRow;
}

export function completePickup(actor: Actor, pickupId: string): PickupRow {
  const pickup = get<PickupRow>("SELECT * FROM pickups WHERE id = ? AND household_id = ?", [
    pickupId,
    actor.householdId,
  ]);
  if (!pickup) throw new NotFoundError("Pickup not found.");
  if (pickup.responsible_member_id !== actor.id && !can(actor, "school.manage")) {
    throw new ForbiddenError("Only the responsible adult or a guardian can report completion.");
  }
  run("UPDATE pickups SET status = 'completed', confirmed_by = ?, confirmed_at = ?, updated_at = ? WHERE id = ?", [
    actor.id,
    nowIso(),
    nowIso(),
    pickup.id,
  ]);
  recordAudit(actor, "pickup.completed", "pickup", pickup.id, {
    reportedBy: actor.id,
    note: "Member-reported completion.",
  });
  return get<PickupRow>("SELECT * FROM pickups WHERE id = ?", [pickup.id]) as PickupRow;
}

export type MissingArrangement = {
  childId: string;
  childName: string;
  date: string;
  time: string;
  reason: "unassigned" | "no_pickup_row";
  pickupId: string | null;
};

export function missingPickupArrangements(actor: Actor, from: string, to: string): MissingArrangement[] {
  const schoolDays = listSchoolDays(actor, from, to);
  const pickups = listPickups(actor, from, to);
  const missing: MissingArrangement[] = [];
  for (const day of schoolDays) {
    if (!day.end_time) continue;
    const pickup = pickups.find(
      (item) => item.member_id === day.member_id && item.date === day.date && item.direction === "pickup",
    );
    if (!pickup) {
      missing.push({
        childId: day.member_id,
        childName: day.childName,
        date: day.date,
        time: day.end_time,
        reason: "no_pickup_row",
        pickupId: null,
      });
    } else if (!pickup.responsible_member_id) {
      missing.push({
        childId: day.member_id,
        childName: day.childName,
        date: day.date,
        time: day.end_time,
        reason: "unassigned",
        pickupId: pickup.id,
      });
    }
  }
  return missing;
}
