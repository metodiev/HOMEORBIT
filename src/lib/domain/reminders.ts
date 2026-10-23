import { all, get, run } from "@/lib/db";
import type { MemberRow, ReminderRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso } from "@/lib/util/ids";
import { notifyMember } from "./notifications";
import { recordAudit } from "./audit";

export type ReminderView = ReminderRow & { memberName: string; memberColor: string };

export function listReminders(actor: Actor, options: { includeDone?: boolean } = {}): ReminderView[] {
  const clause = options.includeDone ? "" : " AND r.status = 'pending'";
  return all<ReminderView>(
    `SELECT r.*, m.name AS memberName, m.color AS memberColor
     FROM reminders r JOIN members m ON m.id = r.member_id
     WHERE r.household_id = ?${clause} ORDER BY r.remind_at`,
    [actor.householdId],
  );
}

export function createReminder(
  actor: Actor,
  input: { title: string; remindAt: string; memberId?: string | null },
): ReminderRow {
  const title = input.title.trim();
  if (!title) throw new ValidationError("A reminder needs a title.");
  const remindAt = new Date(input.remindAt);
  if (Number.isNaN(remindAt.getTime())) throw new ValidationError("Invalid reminder time.");
  const targetId = input.memberId ?? actor.id;
  if (targetId !== actor.id && !can(actor, "task.assign_others")) {
    throw new ForbiddenError("You can only set reminders for yourself.");
  }
  const member = get<MemberRow>(
    "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
    [targetId, actor.householdId],
  );
  if (!member) throw new ValidationError("That family member does not exist.");
  const id = newId("rmd");
  run(
    `INSERT INTO reminders (id, household_id, member_id, title, remind_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [id, actor.householdId, member.id, title, remindAt.toISOString(), nowIso()],
  );
  recordAudit(actor, "reminder.created", "reminder", id, { title, memberId: member.id });
  if (member.id !== actor.id) {
    notifyMember(member, {
      title: `Reminder: ${title}`,
      body: `${actor.name} set this for ${remindAt.toISOString()}.`,
      category: "reminders",
      dedupeKey: `reminder-created:${id}:${member.id}`,
      link: "/notifications",
    });
  }
  return get<ReminderRow>("SELECT * FROM reminders WHERE id = ?", [id]) as ReminderRow;
}

export function setReminderStatus(actor: Actor, reminderId: string, status: ReminderRow["status"]): void {
  const reminder = get<ReminderRow>("SELECT * FROM reminders WHERE id = ? AND household_id = ?", [
    reminderId,
    actor.householdId,
  ]);
  if (!reminder) throw new NotFoundError("Reminder not found.");
  if (reminder.member_id !== actor.id && !can(actor, "task.assign_others")) {
    throw new ForbiddenError("You cannot change this reminder.");
  }
  run("UPDATE reminders SET status = ? WHERE id = ?", [status, reminder.id]);
  recordAudit(actor, `reminder.${status}`, "reminder", reminder.id);
}
