import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupDb, createFixture, freshDb, addDaysIso, type Fixture } from "./helpers";
import { createEvent, getAgendaItem, listAgenda, updateEvent } from "@/lib/domain/events";
import { createNote, listNotes } from "@/lib/domain/notes";
import { listTasks } from "@/lib/domain/tasks";
import { listShoppingLists, listShoppingItems } from "@/lib/domain/shopping";
import { listPackages } from "@/lib/domain/packages";
import { listCalls } from "@/lib/domain/calls";
import { listRecipes, listMealPlan, listInventory } from "@/lib/domain/household";
import { createHouseholdWithAdmin } from "@/lib/domain/settings";
import { actorForMember } from "@/lib/auth/session-store";
import { AppError } from "@/lib/errors";
import { isoDayRange } from "@/lib/util/dates";

describe("permissions and household isolation", () => {
  let dbFile: string;
  let f: Fixture;
  let privateEventId: string;
  let sharedEventId: string;
  let privateNoteId: string;
  let sensitiveNoteId: string;

  beforeAll(() => {
    dbFile = freshDb();
    f = createFixture();
    const day = new Date().toISOString().slice(0, 10);
    privateEventId = createEvent(f.adultActor, {
      calendarId: f.calendarFor(f.adult.id),
      title: "Private surprise plan",
      startsAt: `${day}T20:00:00+03:00`,
      endsAt: `${day}T21:00:00+03:00`,
      visibility: "private",
    }).id;
    sharedEventId = createEvent(f.adminActor, {
      calendarId: f.familyCalendarId,
      title: "Family dinner",
      startsAt: addDaysIso(1, 18),
      endsAt: addDaysIso(1, 19),
      participantIds: [f.child.id],
    }).id;
    privateNoteId = createNote(f.adminActor, {
      title: "Private journal",
      body: "Just for me",
      visibility: "private",
    }).id;
    sensitiveNoteId = createNote(f.adminActor, {
      title: "Alarm code",
      body: "1234",
      visibility: "household",
      sensitive: true,
    }).id;
  });

  afterAll(() => {
    cleanupDb(dbFile);
  });

  it("hides a member's private event from their partner and from guardians", () => {
    expect(getAgendaItem(f.adultActor, privateEventId).title).toBe("Private surprise plan");
    expect(() => getAgendaItem(f.adminActor, privateEventId)).toThrow(AppError);
    expect(() => getAgendaItem(f.childActor, privateEventId)).toThrow(AppError);
    const visible = listAgenda(f.adminActor, {
      from: isoDayRange(new Date().toISOString().slice(0, 10), "Europe/Sofia").start,
      to: isoDayRange(new Date().toISOString().slice(0, 10), "Europe/Sofia").end,
    });
    expect(visible.some((item) => item.eventId === privateEventId)).toBe(false);
  });

  it("prevents a member from modifying another member's private event", () => {
    expect(() => updateEvent(f.adminActor, privateEventId, { title: "Hijacked" })).toThrow(AppError);
  });

  it("shows a shared family event to a child and keeps the private note private", () => {
    const items = listAgenda(f.childActor, {
      from: isoDayRange(new Date().toISOString().slice(0, 10), "Europe/Sofia").start,
      to: isoDayRange(addDaysIso(3).slice(0, 10), "Europe/Sofia").end,
    });
    expect(items.some((item) => item.eventId === sharedEventId)).toBe(true);
    expect(listNotes(f.childActor).some((note) => note.id === privateNoteId)).toBe(false);
  });

  it("limits sensitive notes to members with the sensitive-notes permission", () => {
    expect(listNotes(f.adminActor).some((note) => note.id === sensitiveNoteId)).toBe(true);
    expect(listNotes(f.adultActor).some((note) => note.id === sensitiveNoteId)).toBe(true);
    expect(listNotes(f.childActor).some((note) => note.id === sensitiveNoteId)).toBe(false);
  });

  it("gives invited relatives no household-wide calendar visibility", () => {
    const items = listAgenda(f.relativeActor, {
      from: isoDayRange(new Date().toISOString().slice(0, 10), "Europe/Sofia").start,
      to: isoDayRange(addDaysIso(3).slice(0, 10), "Europe/Sofia").end,
    });
    expect(items).toHaveLength(0);
  });

  it("hides household modules from guest accounts", () => {
    expect(listTasks(f.relativeActor)).toHaveLength(0);
    expect(listShoppingLists(f.relativeActor)).toHaveLength(0);
    expect(listShoppingItems(f.relativeActor)).toHaveLength(0);
    expect(listPackages(f.relativeActor)).toHaveLength(0);
    expect(listCalls(f.relativeActor)).toHaveLength(0);
    expect(listRecipes(f.relativeActor)).toHaveLength(0);
    expect(listMealPlan(f.relativeActor, "2026-01-01", "2026-01-07")).toHaveLength(0);
    expect(listInventory(f.relativeActor)).toHaveLength(0);
  });

  it("does not leak data across households", () => {
    const other = createHouseholdWithAdmin({
      householdName: "Other Family",
      name: "Other Parent",
      email: "other@test.local",
      password: "OtherTest123!",
      timezone: "Europe/Sofia",
      locale: "en",
    });
    const otherActor = actorForMember(other.memberId)!;
    expect(() => getAgendaItem(otherActor, sharedEventId)).toThrow(AppError);
    expect(listAgenda(otherActor, { from: addDaysIso(-1), to: addDaysIso(5) })).toHaveLength(0);
    expect(() => updateEvent(otherActor, sharedEventId, { title: "Cross-household" })).toThrow(AppError);
  });

  it("enforces role capabilities server-side", () => {
    expect(f.adminActor.capabilities).toContain("members.manage");
    expect(f.childActor.capabilities).not.toContain("members.manage");
    expect(f.childActor.capabilities).not.toContain("audit.read");
    expect(f.relativeActor.capabilities).not.toContain("agent.use");
  });
});
