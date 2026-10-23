import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupDb, createFixture, freshDb, type Fixture } from "./helpers";
import { createTask, listTasks, setTaskStatus, updateTask } from "@/lib/domain/tasks";
import { AppError } from "@/lib/errors";

describe("tasks and chores", () => {
  let dbFile: string;
  let f: Fixture;

  beforeAll(() => {
    dbFile = freshDb();
    f = createFixture();
  });

  afterAll(() => cleanupDb(dbFile));

  it("creates a recurring chore and schedules the next occurrence on completion", () => {
    const due = new Date(Date.now() + 86_400_000).toISOString();
    const task = createTask(f.adminActor, {
      title: "Take out the recycling",
      dueAt: due,
      assignedMemberId: f.child.id,
      category: "chore",
      recurrenceRule: "FREQ=WEEKLY",
    });
    setTaskStatus(f.childActor, task.id, "done");
    const open = listTasks(f.adminActor, { status: "open", category: "chore" });
    const next = open.find((entry) => entry.title === "Take out the recycling");
    expect(next).toBeTruthy();
    expect(new Date(next!.due_at!).getTime()).toBeGreaterThan(new Date(due).getTime());
  });

  it("prevents children from assigning tasks to someone else", () => {
    expect(() =>
      createTask(f.childActor, {
        title: "Clean the garage",
        assignedMemberId: f.adult.id,
      }),
    ).toThrow(AppError);
  });

  it("lets a child complete their own task but not someone else's", () => {
    const own = createTask(f.childActor, { title: "Homework", assignedMemberId: f.child.id });
    expect(setTaskStatus(f.childActor, own.id, "done").status).toBe("done");
    const other = createTask(f.adminActor, { title: "Pay the bill", assignedMemberId: f.adult.id, category: "bill" });
    expect(() => setTaskStatus(f.childActor, other.id, "done")).toThrow(AppError);
  });

  it("only lets members with the assignment capability reassign another member's task", () => {
    const task = createTask(f.adminActor, { title: "Water the plants", assignedMemberId: f.adult.id });
    expect(() => updateTask(f.childActor, task.id, { assignedMemberId: f.child.id })).toThrow(AppError);
    expect(updateTask(f.adminActor, task.id, { assignedMemberId: f.child.id }).assigned_member_id).toBe(f.child.id);
  });
});
