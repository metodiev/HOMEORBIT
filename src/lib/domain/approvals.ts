import { all, get, run } from "@/lib/db";
import type { ApprovalRow, MemberRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso, parseJson, toJson } from "@/lib/util/ids";
import { notifyMember } from "./notifications";
import { recordAudit } from "./audit";

export type ApprovalPayload = {
  toolName: string;
  arguments: Record<string, unknown>;
};

export const CONSEQUENTIAL_ACTIONS: Record<string, { risk: "high" | "critical"; label: string }> = {
  cancel_event: { risk: "critical", label: "Cancel an existing event" },
  update_other_event: { risk: "high", label: "Edit another member's event" },
  send_external_message: { risk: "high", label: "Send a message outside the household" },
  book_travel: { risk: "critical", label: "Book travel or a paid activity" },
  make_purchase: { risk: "critical", label: "Make a purchase or payment" },
  change_pickup: { risk: "high", label: "Change a child's pickup arrangement" },
  share_sensitive_document: { risk: "high", label: "Share a sensitive document" },
};

export function isConsequentialAction(action: string): boolean {
  return action in CONSEQUENTIAL_ACTIONS;
}

export function requestApproval(
  actor: Actor,
  input: { action: string; summary: string; payload: ApprovalPayload; risk?: string },
): ApprovalRow {
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const id = newId("apr");
  run(
    `INSERT INTO approval_requests
      (id, household_id, requested_by, action, summary, payload_json, risk, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id,
      actor.householdId,
      actor.id,
      input.action,
      input.summary,
      toJson(input.payload),
      input.risk ?? CONSEQUENTIAL_ACTIONS[input.action]?.risk ?? "high",
      nowIso(),
      expiresAt,
    ],
  );
  recordAudit(actor, "approval.requested", "approval", id, { action: input.action, summary: input.summary });

  const approvers = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL",
    [actor.householdId],
  ).filter((member) => member.id === actor.id || member.role === "parent");
  for (const member of approvers) {
    notifyMember(member, {
      title: "Confirmation needed",
      body: input.summary,
      category: "approvals",
      urgency: "high",
      dedupeKey: `approval:${id}:${member.id}`,
      link: "/approvals",
    });
  }
  return get<ApprovalRow>("SELECT * FROM approval_requests WHERE id = ?", [id]) as ApprovalRow;
}

export function listPendingApprovals(actor: Actor): ApprovalRow[] {
  if (can(actor, "agent.approve")) {
    return all<ApprovalRow>(
      "SELECT * FROM approval_requests WHERE household_id = ? AND status = 'pending' ORDER BY created_at DESC",
      [actor.householdId],
    );
  }
  return all<ApprovalRow>(
    `SELECT * FROM approval_requests WHERE household_id = ? AND requested_by = ? AND status = 'pending'
     ORDER BY created_at DESC`,
    [actor.householdId, actor.id],
  );
}

export function getApproval(actor: Actor, approvalId: string): ApprovalRow {
  const approval = get<ApprovalRow>(
    "SELECT * FROM approval_requests WHERE id = ? AND household_id = ?",
    [approvalId, actor.householdId],
  );
  if (!approval) throw new NotFoundError("Approval request not found.");
  return approval;
}

export function decideApproval(
  actor: Actor,
  approvalId: string,
  decision: "approved" | "rejected",
): ApprovalRow {
  const approval = getApproval(actor, approvalId);
  if (approval.status !== "pending") throw new ValidationError("This request has already been decided.");
  if (approval.expires_at && approval.expires_at < nowIso()) {
    run("UPDATE approval_requests SET status = 'expired' WHERE id = ?", [approval.id]);
    throw new ValidationError("This request has expired. Ask the assistant again.");
  }
  if (!can(actor, "agent.approve")) {
    throw new ForbiddenError("A guardian must approve this request.");
  }
  run("UPDATE approval_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?", [
    decision,
    actor.id,
    nowIso(),
    approval.id,
  ]);
  recordAudit(actor, `approval.${decision}`, "approval", approval.id, { action: approval.action });

  const requester = get<MemberRow>("SELECT * FROM members WHERE id = ?", [approval.requested_by]);
  if (requester) {
    notifyMember(requester, {
      title: decision === "approved" ? "Request approved" : "Request declined",
      body: approval.summary,
      category: "approvals",
      urgency: "high",
      dedupeKey: `approval-decision:${approval.id}:${decision}`,
      link: "/approvals",
    });
  }
  return get<ApprovalRow>("SELECT * FROM approval_requests WHERE id = ?", [approval.id]) as ApprovalRow;
}

export function readApprovalPayload(approval: ApprovalRow): ApprovalPayload {
  return parseJson<ApprovalPayload>(approval.payload_json, { toolName: "", arguments: {} });
}

export type ApprovalHistoryRow = ApprovalRow & {
  requesterName: string;
  deciderName: string | null;
  toolName: string;
};

export function listApprovalHistory(actor: Actor, limit = 30): ApprovalHistoryRow[] {
  return all<ApprovalHistoryRow>(
    `SELECT a.*, req.name AS requesterName, dec.name AS deciderName,
            json_extract(a.payload_json, '$.toolName') AS toolName
     FROM approval_requests a
     JOIN members req ON req.id = a.requested_by
     LEFT JOIN members dec ON dec.id = a.decided_by
     WHERE a.household_id = ? AND a.status != 'pending'
       AND (? = 1 OR a.requested_by = ?)
     ORDER BY a.created_at DESC LIMIT ?`,
    [actor.householdId, can(actor, "agent.approve") ? 1 : 0, actor.id, limit],
  );
}
