import Link from "next/link";
import { all } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { requireActor } from "@/lib/auth/session";
import { intlLocale } from "@/lib/i18n";
import { addDaysToDateString, dateStringInZone, formatDate, formatDateTime } from "@/lib/util/dates";
import { listTasks } from "@/lib/domain/tasks";
import {
  assignTaskAction,
  createTaskAction,
  deleteTaskAction,
  setTaskStatusAction,
} from "@/lib/actions";
import { Badge, Card, EmptyState, FeedbackBanner, MemberAvatar, PageHeader } from "@/components/ui";
import { GuestRestricted } from "@/components/ui";

export const metadata = { title: "Tasks & chores" };

const CATEGORIES = ["general", "chore", "school", "household", "bill", "maintenance", "trip", "errand"];

function assignmentOptions(actor: Actor): MemberRow[] {
  const members = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
    [actor.householdId],
  );
  if (can(actor, "task.assign_others")) return members;
  return members.filter((member) => member.id === actor.id);
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; assignee?: string; category?: string; ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  if (actor.role === "relative") {
    return (
      <>
        <PageHeader eyebrow="Household operations" title="Tasks & chores" />
        <GuestRestricted title="Tasks and chores" />
      </>
    );
  }
  const locale = intlLocale(actor.locale);
  const status = params.status === "done" || params.status === "all" ? params.status : "open";
  const tasks = listTasks(actor, {
    status,
    assignedTo: params.assignee || undefined,
    category: params.category || undefined,
    limit: 300,
  });
  const members = assignmentOptions(actor);
  const today = dateStringInZone(new Date(), actor.timezone);
  const openTasks = listTasks(actor, { status: "open", limit: 500 });
  const overdue = openTasks.filter((task) => task.due_at && task.due_at.slice(0, 10) < today);
  const nextWeek = addDaysToDateString(today, 7);
  const dueSoon = openTasks.filter(
    (task) => task.due_at && task.due_at.slice(0, 10) >= today && task.due_at.slice(0, 10) <= nextWeek,
  );
  const groups = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const key = !task.due_at
      ? "No date"
      : task.due_at.slice(0, 10) < today && task.status === "open"
        ? "Overdue"
        : task.due_at.slice(0, 10) === today
          ? "Today"
          : task.due_at.slice(0, 10) <= nextWeek
            ? "This week"
            : "Later";
    const list = groups.get(key) ?? [];
    list.push(task);
    groups.set(key, list);
  }
  const order = ["Overdue", "Today", "This week", "Later", "No date"];

  return (
    <>
      <PageHeader
        eyebrow="Household operations"
        title="Tasks & chores"
        subtitle="Assign fairly, keep recurring chores moving, and let the assistant create tasks from conversation."
        actions={
          <Link href="/assistant" className="btn">
            ✨ Ask the assistant
          </Link>
        }
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-red-900">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">Overdue</p>
          <p className="text-2xl font-semibold">{overdue.length}</p>
        </div>
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">Next 7 days</p>
          <p className="text-2xl font-semibold">{dueSoon.length}</p>
        </div>
        <div className="rounded-2xl bg-teal-mist px-4 py-3 text-teal-deep">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">Open</p>
          <p className="text-2xl font-semibold">{openTasks.length}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {(["open", "done", "all"] as const).map((option) => (
          <Link
            key={option}
            href={`/tasks?status=${option}${params.category ? `&category=${params.category}` : ""}`}
            className={`rounded-full px-3 py-1.5 font-semibold capitalize ${
              status === option ? "bg-teal text-white" : "bg-white text-ink-soft hover:text-ink"
            }`}
          >
            {option}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-black/10" />
        <Link href={`/tasks?status=${status}`} className={`rounded-full px-2 py-1 ${!params.category ? "bg-sand font-semibold" : ""}`}>
          All categories
        </Link>
        {CATEGORIES.map((category) => (
          <Link
            key={category}
            href={`/tasks?status=${status}&category=${category}`}
            className={`rounded-full px-2 py-1 capitalize ${params.category === category ? "bg-sand font-semibold" : ""}`}
          >
            {category}
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {tasks.length === 0 ? (
            <EmptyState icon="✅" title="No tasks here" description="Create one, or ask the assistant to add a chore." />
          ) : (
            order
              .filter((key) => (groups.get(key) ?? []).length > 0)
              .map((key) => (
                <section key={key}>
                  <h2 className={`mb-2 text-xs font-semibold uppercase tracking-[0.16em] ${key === "Overdue" ? "text-red-700" : "text-ink-soft"}`}>
                    {key} · {groups.get(key)!.length}
                  </h2>
                  <ul className="space-y-2">
                    {groups.get(key)!.map((task) => {
                      const done = task.status === "done";
                      const canManage = task.created_by === actor.id || task.assigned_member_id === actor.id || can(actor, "task.assign_others");
                      return (
                        <li key={task.id} className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                          <form action={setTaskStatusAction} className="pt-0.5">
                            <input type="hidden" name="taskId" value={task.id} />
                            <input type="hidden" name="status" value={done ? "open" : "done"} />
                            <input type="hidden" name="redirectTo" value={`/tasks?status=${status}`} />
                            <button
                              type="submit"
                              aria-label={done ? "Reopen task" : "Complete task"}
                              className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
                                done ? "border-teal bg-teal text-white" : "border-black/20 bg-white text-transparent hover:border-teal hover:text-teal"
                              }`}
                            >
                              ✓
                            </button>
                          </form>
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-medium ${done ? "text-ink-soft line-through" : "text-ink"}`}>{task.title}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft">
                              {task.due_at ? <span>{formatDateTime(task.due_at, locale, actor.timezone)}</span> : <span>No due date</span>}
                              <Badge tone={task.priority === "urgent" ? "red" : task.priority === "high" ? "amber" : "neutral"}>{task.priority}</Badge>
                              <Badge tone="blue">{task.category}</Badge>
                              {task.recurrence_rule ? <Badge tone="teal">↻ recurring</Badge> : null}
                              {task.assigneeName ? (
                                <span className="inline-flex items-center gap-1">
                                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: task.assigneeColor ?? "#64748b" }} />
                                  {task.assigneeName}
                                </span>
                              ) : (
                                <span>Unassigned</span>
                              )}
                            </div>
                          </div>
                          {canManage ? (
                            <div className="flex items-center gap-1">
                              <form action={assignTaskAction} className="flex items-center gap-1">
                                <input type="hidden" name="taskId" value={task.id} />
                                <input type="hidden" name="redirectTo" value={`/tasks?status=${status}`} />
                                <select name="assignedMemberId" defaultValue={task.assigned_member_id ?? ""} className="rounded-full border border-black/10 bg-white px-2 py-1 text-[11px]">
                                  <option value="">Unassigned</option>
                                  {members.map((member) => (
                                    <option key={member.id} value={member.id}>
                                      {member.name.split(" ")[0]}
                                    </option>
                                  ))}
                                </select>
                                <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">
                                  Assign
                                </button>
                              </form>
                              <form action={deleteTaskAction}>
                                <input type="hidden" name="taskId" value={task.id} />
                                <input type="hidden" name="redirectTo" value={`/tasks?status=${status}`} />
                                <button type="submit" className="btn-ghost px-2 py-1 text-[11px] text-red-700 hover:bg-red-50">
                                  Delete
                                </button>
                              </form>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
          )}
        </div>

        <div className="space-y-4">
          <Card title="New task" subtitle="Recurring chores create the next occurrence when completed.">
            <form action={createTaskAction} className="space-y-3">
              <input type="hidden" name="redirectTo" value={`/tasks?status=${status}`} />
              <div>
                <label className="label" htmlFor="task-title">Title</label>
                <input id="task-title" name="title" required className="field" placeholder="Take out the recycling" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="task-due">Due</label>
                  <input id="task-due" type="datetime-local" name="dueAt" defaultValue={`${today}T18:00`} className="field" />
                </div>
                <div>
                  <label className="label" htmlFor="task-assignee">Assignee</label>
                  <select id="task-assignee" name="assignedMemberId" className="field" defaultValue="">
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="task-priority">Priority</label>
                  <select id="task-priority" name="priority" className="field" defaultValue="normal">
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="task-category">Category</label>
                  <select id="task-category" name="category" className="field" defaultValue="general">
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category} className="capitalize">
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="task-recurrence">Repeats</label>
                <select id="task-recurrence" name="recurrenceRule" className="field" defaultValue="">
                  <option value="">One-off</option>
                  <option value="FREQ=DAILY">Every day</option>
                  <option value="FREQ=WEEKLY">Every week</option>
                  <option value="FREQ=MONTHLY">Every month</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="task-notes">Notes</label>
                <textarea id="task-notes" name="notes" rows={2} className="field" />
              </div>
              <button type="submit" className="btn w-full">Create task</button>
            </form>
          </Card>
          <Card title="Fair assignment" subtitle="A small nudge, not a rule">
            <ul className="space-y-2 text-xs text-ink-soft">
              {members.map((member) => {
                const count = openTasks.filter((task) => task.assigned_member_id === member.id).length;
                return (
                  <li key={member.id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <MemberAvatar name={member.name} color={member.color} avatar={member.avatar} size="sm" />
                      {member.name.split(" ")[0]}
                    </span>
                    <Badge tone={count === 0 ? "teal" : count > 3 ? "amber" : "neutral"}>{count} open</Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
