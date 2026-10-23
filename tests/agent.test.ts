import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDaysIso, cleanupDb, clearAiEnv, createFixture, freshDb, type Fixture } from "./helpers";
import { runAgent } from "@/lib/agent/runner";
import { executeTool } from "@/lib/agent/tools";
import { createEvent } from "@/lib/domain/events";
import { createTrip, inviteToTrip } from "@/lib/domain/trips";
import { decideApproval, listPendingApprovals, readApprovalPayload } from "@/lib/domain/approvals";
import { executeApprovedTool } from "@/lib/agent/tools";
import { all, get } from "@/lib/db";
import type { EventRow, ShoppingItemRow } from "@/lib/db/rows";
import { AppError } from "@/lib/errors";

describe("AI agent with real tools", () => {
  let dbFile: string;
  let f: Fixture;

  beforeAll(() => {
    dbFile = freshDb();
    f = createFixture();
    createEvent(f.adminActor, {
      calendarId: f.familyCalendarId,
      title: "Dentist appointment",
      startsAt: addDaysIso(3, 15),
      endsAt: addDaysIso(3, 16),
      participantIds: [f.admin.id],
    });
    createEvent(f.adminActor, {
      calendarId: f.familyCalendarId,
      title: "Grandma visit",
      startsAt: addDaysIso(1, 11),
      endsAt: addDaysIso(1, 13),
      participantIds: [f.child.id],
    });
    const trip = createTrip(f.adminActor, { title: "Long weekend", destination: "Vitosha" });
    inviteToTrip(f.adminActor, trip.id, { guests: [{ name: "Nikola" }] });
  });

  afterAll(() => cleanupDb(dbFile));

  beforeEach(() => clearAiEnv());

  it("answers from real database events", async () => {
    const result = await runAgent(f.adminActor, { message: "What is planned for tomorrow?" });
    expect(result.mode).toBe("local");
    expect(result.reply).toContain("Grandma visit");
    expect(result.toolRuns.some((run) => run.name === "get_family_agenda" && run.status === "success")).toBe(true);
  });

  it("answers with a weekly summary built from the database", async () => {
    const result = await runAgent(f.adminActor, { message: "Summarize our week" });
    expect(result.toolRuns.some((run) => run.name === "summarize_family_week" && run.status === "success")).toBe(true);
    expect(result.reply).toContain("Events:");
    expect(result.reply).toContain("conflicts:");
  });

  it("creates a shopping item through a real tool call", async () => {
    const result = await runAgent(f.adminActor, { message: "Add oat milk to the shopping list" });
    expect(result.reply.toLowerCase()).toContain("oat milk");
    const items = all<ShoppingItemRow>(
      "SELECT * FROM shopping_items WHERE household_id = ? AND lower(name) = 'oat milk'",
      [f.householdId],
    );
    expect(items).toHaveLength(1);
    expect(result.toolRuns.some((run) => run.name === "create_shopping_item" && run.status === "success")).toBe(true);
  });

  it("creates a task for task requests and a reminder for reminders", async () => {
    const taskResult = await runAgent(f.adminActor, { message: "Add a task to clean the garage tomorrow at 10" });
    expect(taskResult.toolRuns.some((run) => run.name === "create_task" && run.status === "success")).toBe(true);
    expect(
      all<{ title: string }>(
        "SELECT title FROM tasks WHERE household_id = ? AND lower(title) LIKE '%clean the garage%'",
        [f.householdId],
      ).length,
    ).toBe(1);
    const reminderResult = await runAgent(f.adminActor, { message: "Remind me to call the school tomorrow at 9" });
    expect(reminderResult.toolRuns.some((run) => run.name === "create_reminder" && run.status === "success")).toBe(true);
    expect(
      all("SELECT id FROM reminders WHERE household_id = ? AND lower(title) LIKE '%call the school%'", [f.householdId]),
    ).toHaveLength(1);
  });

  it("requires approval before cancelling an event and only cancels after confirmation", async () => {
    const event = get<EventRow>("SELECT * FROM events WHERE household_id = ? AND title = 'Dentist appointment'", [
      f.householdId,
    ])!;
    const result = await runAgent(f.adminActor, { message: "Cancel the dentist appointment" });
    expect(result.toolRuns.some((run) => run.status === "pending_approval")).toBe(true);
    expect(get<EventRow>("SELECT * FROM events WHERE id = ?", [event.id])!.status).toBe("confirmed");
    const pending = listPendingApprovals(f.adminActor);
    expect(pending.length).toBeGreaterThan(0);
    const approval = pending[0];
    const payload = readApprovalPayload(approval);
    expect(payload.toolName).toBe("cancel_event");
    decideApproval(f.adminActor, approval.id, "approved");
    const outcome = await executeApprovedTool(f.adminActor, approval.id);
    expect(outcome.ok).toBe(true);
    expect(get<EventRow>("SELECT * FROM events WHERE id = ?", [event.id])!.status).toBe("cancelled");
  });

  it("does not treat an unconfirmed nephew as attending", async () => {
    const result = await runAgent(f.adminActor, { message: "Are the nephews coming on the holiday?" });
    expect(result.reply.toLowerCase()).toContain("not confirmed");
    expect(result.reply.toLowerCase()).not.toContain("they are free");
  });

  it("denies assistant access to invited relatives", async () => {
    await expect(runAgent(f.relativeActor, { message: "What is planned tomorrow?" })).rejects.toBeInstanceOf(AppError);
  });

  it("denies tools the member's role cannot use", async () => {
    const outcome = await executeTool(f.childActor, "create_family_note", {
      title: "Codes",
      body: "secret",
      visibility: "household",
      sensitive: true,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
  });

  it("rejects invalid tool arguments without writing data", async () => {
    const outcome = await executeTool(f.adminActor, "create_event", { title: "" });
    expect(outcome.ok).toBe(false);
    expect(all("SELECT * FROM events WHERE title = ''")).toHaveLength(0);
  });

  it("requires a guardian to approve a child's consequential request", async () => {
    const childEvent = createEvent(f.childActor, {
      calendarId: f.calendarFor(f.child.id),
      title: "Mia's own plan",
      startsAt: addDaysIso(5, 10),
      endsAt: addDaysIso(5, 11),
    });
    const outcome = await executeTool(f.childActor, "cancel_event", { eventId: childEvent.id });
    expect(outcome.requiresApproval).toBe(true);
    expect(() => decideApproval(f.childActor, outcome.approvalId!, "approved")).toThrow(AppError);
    const approved = decideApproval(f.adminActor, outcome.approvalId!, "approved");
    const executed = await executeApprovedTool(f.adminActor, approved.id);
    expect(executed.ok).toBe(true);
  });

  it("falls back to the local engine when the AI provider is unreachable", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_BASE_URL = "http://127.0.0.1:9/v1";
    process.env.AI_MODEL = "test-model";
    const result = await runAgent(f.adminActor, { message: "What is planned for tomorrow?" });
    expect(result.mode).toBe("local");
    expect(result.providerError).toBeTruthy();
    expect(result.reply).toContain("Grandma visit");
  });

  it("keeps an auditable tool execution log", () => {
    const executions = all<{ tool_name: string; status: string }>(
      "SELECT tool_name, status FROM tool_executions WHERE household_id = ?",
      [f.householdId],
    );
    expect(executions.length).toBeGreaterThan(0);
    expect(executions.every((execution) => ["success", "error", "pending_approval", "denied"].includes(execution.status))).toBe(true);
  });
});
