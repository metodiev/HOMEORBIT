import { all, get, run } from "@/lib/db";
import type { MemberRow, TaskRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso } from "@/lib/util/ids";
import { notifyMember } from "./notifications";
import { recordAudit } from "./audit";
import { formatDateTime } from "@/lib/util/dates";

export type TaskFilter = {
  status?: TaskRow["status"] | "all";
  assignedTo?: string;
  category?: string;
  dueBefore?: string;
  limit?: number;
};

export function listTasks(actor: Actor, filter: TaskFilter = {}): (TaskRow & { assigneeName: string | null; assigneeColor: string | null })[] {
  if (actor.role === "relative") return [];
  const clauses = ["t.household_id = ?"];
  const params: unknown[] = [actor.householdId];
  if (filter.status && filter.status !== "all") {
    clauses.push("t.status = ?");
    params.push(filter.status);
  }
  if (filter.assignedTo) {
    clauses.push("t.assigned_member_id = ?");
    params.push(filter.assignedTo);
  }
  if (filter.category) {
    clauses.push("t.category = ?");
    params.push(filter.category);
  }
  if (filter.dueBefore) {
    clauses.push("t.due_at IS NOT NULL AND t.due_at <= ?");
    params.push(filter.dueBefore);
  }
  params.push(filter.limit ?? 200);
  return all<TaskRow & { assigneeName: string | null; assigneeColor: string | null }>(
    `SELECT t.*, m.name AS assigneeName, m.color AS assigneeColor
     FROM tasks t LEFT JOIN members m ON m.id = t.assigned_member_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at, t.created_at
     LIMIT ?`,
    params,
  );
}

export function getTask(actor: Actor, taskId: string): TaskRow {
  if (actor.role === "relative") throw new ForbiddenError("Tasks are not available to guest accounts.");
  const task = get<TaskRow>("SELECT * FROM tasks WHERE id = ? AND household_id = ?", [
    taskId,
    actor.householdId,
  ]);
  if (!task) throw new NotFoundError("Task not found.");
  return task;
}

export type TaskInput = {
  title: string;
  notes?: string | null;
  dueAt?: string | null;
  priority?: TaskRow["priority"];
  category?: string;
  assignedMemberId?: string | null;
  recurrenceRule?: string | null;
};

function assertAssignmentAllowed(actor: Actor, assignedMemberId: string | null | undefined): void {
  if (!assignedMemberId || assignedMemberId === actor.id) return;
  if (!can(actor, "task.assign_others")) {
    throw new ForbiddenError("You can only assign tasks to yourself.");
  }
  const member = get<MemberRow>("SELECT * FROM members WHERE id = ? AND household_id = ?", [
    assignedMemberId,
    actor.householdId,
  ]);
  if (!member) throw new ValidationError("The assignee is not part of this household.");
}

export function createTask(actor: Actor, input: TaskInput): TaskRow {
  if (!can(actor, "task.create")) throw new ForbiddenError("Your role cannot create tasks.");
  const title = input.title.trim();
  if (!title) throw new ValidationError("A task needs a title.");
  assertAssignmentAllowed(actor, input.assignedMemberId);
  const id = newId("tsk");
  run(
    `INSERT INTO tasks (id, household_id, title, notes, due_at, priority, status, category, assigned_member_id,
       created_by, recurrence_rule, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      actor.householdId,
      title,
      input.notes ?? null,
      input.dueAt ?? null,
      input.priority ?? "normal",
      input.category ?? "general",
      input.assignedMemberId ?? null,
      actor.id,
      input.recurrenceRule ?? null,
      nowIso(),
      nowIso(),
    ],
  );
  recordAudit(actor, "task.created", "task", id, { title, assignedMemberId: input.assignedMemberId ?? null });
  if (input.assignedMemberId && input.assignedMemberId !== actor.id) {
    const assignee = get<MemberRow>("SELECT * FROM members WHERE id = ?", [input.assignedMemberId]);
    if (assignee) {
      notifyMember(assignee, {
        title: `New task: ${title}`,
        body: `${actor.name} assigned this to you${input.dueAt ? ` — due ${formatDateTime(input.dueAt, assignee.locale, assignee.timezone)}` : ""}.`,
        category: "tasks",
        urgency: input.priority === "urgent" ? "high" : "normal",
        dedupeKey: `task-created:${id}:${assignee.id}`,
        link: "/tasks",
      });
    }
  }
  return getTask(actor, id);
}

export function updateTask(actor: Actor, taskId: string, input: Partial<TaskInput>): TaskRow {
  const task = getTask(actor, taskId);
  const canManage =
    task.created_by === actor.id || task.assigned_member_id === actor.id || can(actor, "task.assign_others");
  if (!canManage) throw new ForbiddenError("You cannot change this task.");
  if (input.assignedMemberId !== undefined) assertAssignmentAllowed(actor, input.assignedMemberId);
  run(
    `UPDATE tasks SET title = ?, notes = ?, due_at = ?, priority = ?, category = ?, assigned_member_id = ?,
      recurrence_rule = ?, updated_at = ? WHERE id = ?`,
    [
      input.title?.trim() || task.title,
      input.notes !== undefined ? input.notes : task.notes,
      input.dueAt !== undefined ? input.dueAt : task.due_at,
      input.priority ?? task.priority,
      input.category ?? task.category,
      input.assignedMemberId !== undefined ? input.assignedMemberId : task.assigned_member_id,
      input.recurrenceRule !== undefined ? input.recurrenceRule : task.recurrence_rule,
      nowIso(),
      task.id,
    ],
  );
  recordAudit(actor, "task.updated", "task", task.id);
  return getTask(actor, task.id);
}

export function setTaskStatus(actor: Actor, taskId: string, status: TaskRow["status"]): TaskRow {
  const task = getTask(actor, taskId);
  const canManage =
    task.created_by === actor.id || task.assigned_member_id === actor.id || can(actor, "task.assign_others");
  if (!canManage) throw new ForbiddenError("You cannot change this task.");
  run("UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?", [
    status,
    status === "done" ? nowIso() : null,
    nowIso(),
    task.id,
  ]);
  recordAudit(actor, `task.${status}`, "task", task.id);

  if (status === "done" && task.recurrence_rule && task.due_at) {
    const recurrence = task.recurrence_rule.toUpperCase();
    const stepDays = recurrence.includes("DAILY") ? 1 : recurrence.includes("MONTHLY") ? 30 : 7;
    const nextDue = new Date(new Date(task.due_at).getTime() + stepDays * 86_400_000);
    createTask(actor, {
      title: task.title,
      notes: task.notes,
      dueAt: nextDue.toISOString(),
      priority: task.priority,
      category: task.category,
      assignedMemberId: task.assigned_member_id,
      recurrenceRule: task.recurrence_rule,
    });
  }
  return getTask(actor, task.id);
}

export async function deleteTask(actor: Actor, taskId: string): Promise<void> {
  const task = getTask(actor, taskId);
  if (task.created_by !== actor.id && !can(actor, "task.assign_others")) {
    throw new ForbiddenError("You cannot delete this task.");
  }
  run("DELETE FROM tasks WHERE id = ?", [task.id]);
  recordAudit(actor, "task.deleted", "task", task.id);
}
