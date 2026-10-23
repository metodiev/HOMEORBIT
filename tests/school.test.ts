import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupDb, createFixture, freshDb, type Fixture } from "./helpers";
import {
  assignPickup,
  completePickup,
  confirmPickup,
  createPickup,
  ensurePickupsForRange,
  listPickups,
  listSchoolDays,
  missingPickupArrangements,
  upsertSchoolDay,
} from "@/lib/domain/school";
import { AppError } from "@/lib/errors";
import { dateStringInZone } from "@/lib/util/dates";

describe("school run coordination", () => {
  let dbFile: string;
  let f: Fixture;
  const today = dateStringInZone(new Date(), "Europe/Sofia");

  beforeAll(() => {
    dbFile = freshDb();
    f = createFixture();
  });

  afterAll(() => cleanupDb(dbFile));

  it("creates school runs from the timetable and flags missing arrangements", () => {
    upsertSchoolDay(f.adminActor, { memberId: f.child.id, date: today, startTime: "08:15", endTime: "14:30" });
    const days = listSchoolDays(f.adminActor, today, today);
    expect(days).toHaveLength(1);
    const created = ensurePickupsForRange(f.adminActor, today, today);
    expect(created).toBe(1);
    const missing = missingPickupArrangements(f.adminActor, today, today);
    expect(missing).toHaveLength(1);
    expect(missing[0].reason).toBe("unassigned");
  });

  it("assigns and confirms a pickup, and never claims a verified arrival", () => {
    const pickup = listPickups(f.adminActor, today, today)[0];
    const assigned = assignPickup(f.adminActor, pickup.id, f.adult.id);
    expect(assigned.responsible_member_id).toBe(f.adult.id);
    expect(assigned.status).toBe("assigned");
    const confirmed = confirmPickup(f.adultActor, pickup.id);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmed_by).toBe(f.adult.id);
    expect(missingPickupArrangements(f.adminActor, today, today)).toHaveLength(0);
    const completed = completePickup(f.adultActor, pickup.id);
    expect(completed.status).toBe("completed");
  });

  it("rejects confirmation without a responsible adult", () => {
    const pickup = createPickup(f.adminActor, {
      memberId: f.child.id,
      date: today,
      direction: "pickup",
      time: "16:00",
    });
    expect(() => confirmPickup(f.adminActor, pickup.id)).toThrow(AppError);
  });

  it("keeps school information away from invited relatives", () => {
    expect(() => listSchoolDays(f.relativeActor, today, today)).toThrow(AppError);
  });

  it("does not let a child be made responsible for a school run", () => {
    expect(() => assignPickup(f.adminActor, listPickups(f.adminActor, today, today)[0].id, f.child.id)).toThrow(AppError);
  });
});
