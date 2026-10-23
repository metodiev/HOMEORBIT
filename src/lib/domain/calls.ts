import { all, get, run } from "@/lib/db";
import type { CallRow, MemberRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso } from "@/lib/util/ids";
import { notifyMember } from "./notifications";
import { recordAudit } from "./audit";

export type CallView = CallRow & { assigneeName: string | null; assigneeColor: string | null };

export function listCalls(actor: Actor, options: { includeDone?: boolean } = {}): CallView[] {
  if (actor.role === "relative") return [];
  const clause = options.includeDone ? "" : " AND c.status IN ('pending','postponed')";
  return all<CallView>(
    `SELECT c.*, m.name AS assigneeName, m.color AS assigneeColor
     FROM calls c LEFT JOIN members m ON m.id = c.assigned_member_id
     WHERE c.household_id = ?${clause}
     ORDER BY COALESCE(c.callback_at, c.deadline) IS NULL, COALESCE(c.callback_at, c.deadline), c.created_at`,
    [actor.householdId],
  );
}

export function getCall(actor: Actor, callId: string): CallRow {
  if (actor.role === "relative") throw new ForbiddenError("Calls are not available to guest accounts.");
  const call = get<CallRow>("SELECT * FROM calls WHERE id = ? AND household_id = ?", [
    callId,
    actor.householdId,
  ]);
  if (!call) throw new NotFoundError("Call not found.");
  return call;
}

export type CallInput = {
  direction: CallRow["direction"];
  contactName: string;
  phone?: string | null;
  reason?: string | null;
  notes?: string | null;
  callbackAt?: string | null;
  deadline?: string | null;
  assignedMemberId?: string | null;
};

export function createCall(actor: Actor, input: CallInput): CallRow {
  if (!can(actor, "call.manage")) throw new ForbiddenError("Your role cannot track calls.");
  const contactName = input.contactName.trim();
  if (!contactName) throw new ValidationError("A call needs a contact name.");
  if (input.assignedMemberId) {
    const member = get<MemberRow>(
      "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
      [input.assignedMemberId, actor.householdId],
    );
    if (!member) throw new ValidationError("That family member does not exist.");
  }
  const id = newId("cll");
  run(
    `INSERT INTO calls (id, household_id, direction, contact_name, phone, reason, notes, callback_at, deadline,
      assigned_member_id, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      id,
      actor.householdId,
      input.direction,
      contactName,
      input.phone ?? null,
      input.reason ?? null,
      input.notes ?? null,
      input.callbackAt ?? null,
      input.deadline ?? null,
      input.assignedMemberId ?? actor.id,
      actor.id,
      nowIso(),
      nowIso(),
    ],
  );
  recordAudit(actor, "call.created", "call", id, { contactName, direction: input.direction });
  if (input.assignedMemberId && input.assignedMemberId !== actor.id) {
    const assignee = get<MemberRow>("SELECT * FROM members WHERE id = ?", [input.assignedMemberId]);
    if (assignee) {
      notifyMember(assignee, {
        title: `Call ${contactName}`,
        body: input.reason ?? `${actor.name} asked you to follow up.`,
        category: "calls",
        dedupeKey: `call-assigned:${id}:${assignee.id}`,
        link: "/household",
      });
    }
  }
  return get<CallRow>("SELECT * FROM calls WHERE id = ?", [id]) as CallRow;
}

export function updateCall(actor: Actor, callId: string, input: Partial<CallInput>): CallRow {
  const call = getCall(actor, callId);
  const canManage = call.created_by === actor.id || call.assigned_member_id === actor.id || can(actor, "call.manage");
  if (!canManage) throw new ForbiddenError("You cannot change this call.");
  run(
    `UPDATE calls SET direction = ?, contact_name = ?, phone = ?, reason = ?, notes = ?, callback_at = ?,
      deadline = ?, assigned_member_id = ?, updated_at = ? WHERE id = ?`,
    [
      input.direction ?? call.direction,
      input.contactName?.trim() || call.contact_name,
      input.phone !== undefined ? input.phone : call.phone,
      input.reason !== undefined ? input.reason : call.reason,
      input.notes !== undefined ? input.notes : call.notes,
      input.callbackAt !== undefined ? input.callbackAt : call.callback_at,
      input.deadline !== undefined ? input.deadline : call.deadline,
      input.assignedMemberId !== undefined ? input.assignedMemberId : call.assigned_member_id,
      nowIso(),
      call.id,
    ],
  );
  recordAudit(actor, "call.updated", "call", call.id);
  return get<CallRow>("SELECT * FROM calls WHERE id = ?", [call.id]) as CallRow;
}

export function setCallStatus(
  actor: Actor,
  callId: string,
  status: CallRow["status"],
  note?: string,
): CallRow {
  const call = getCall(actor, callId);
  const canManage = call.created_by === actor.id || call.assigned_member_id === actor.id || can(actor, "call.manage");
  if (!canManage) throw new ForbiddenError("You cannot change this call.");
  run("UPDATE calls SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?", [
    status,
    note ?? null,
    nowIso(),
    call.id,
  ]);
  recordAudit(actor, `call.${status}`, "call", call.id);
  return get<CallRow>("SELECT * FROM calls WHERE id = ?", [call.id]) as CallRow;
}
