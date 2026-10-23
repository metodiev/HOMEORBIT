import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, resetDbCache } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { actorForMember } from "@/lib/auth/session-store";
import type { Actor } from "@/lib/auth/actor";
import { createHouseholdWithAdmin, addFamilyMember } from "@/lib/domain/settings";
import { get } from "@/lib/db";

export type Fixture = {
  householdId: string;
  admin: MemberRow;
  adminActor: Actor;
  adult: MemberRow;
  adultActor: Actor;
  child: MemberRow;
  childActor: Actor;
  relative: MemberRow;
  relativeActor: Actor;
  familyCalendarId: string;
  calendarFor: (memberId: string) => string;
};

export function freshDb(): string {
  const file = path.join(os.tmpdir(), `homeorbit-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  process.env.HOMEORBIT_DB_PATH = file;
  resetDbCache();
  getDb();
  return file;
}

export function cleanupDb(file: string): void {
  resetDbCache();
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      fs.rmSync(`${file}${suffix}`);
    } catch {
      // already gone
    }
  }
}

export function createFixture(): Fixture {
  const created = createHouseholdWithAdmin({
    householdName: "Test Family",
    name: "Ivan Testov",
    email: "admin@test.local",
    password: "OrbitTest123!",
    timezone: "Europe/Sofia",
    locale: "en",
  });
  const adminActor = actorForMember(created.memberId);
  if (!adminActor) throw new Error("Admin actor missing");
  const admin = get<MemberRow>("SELECT * FROM members WHERE id = ?", [created.memberId])!;

  const adult = addFamilyMember(adminActor, { name: "Maria Testova", role: "adult", relationship: "Partner" });
  const child = addFamilyMember(adminActor, { name: "Mia Testova", role: "child", relationship: "Daughter" });
  const relative = addFamilyMember(adminActor, { name: "Nina Guest", role: "relative", relationship: "Niece" });

  const adultActor = actorForMember(adult.id);
  const childActor = actorForMember(child.id);
  const relativeActor = actorForMember(relative.id);
  if (!adultActor || !childActor || !relativeActor) throw new Error("Fixture actors missing");

  const familyCalendarId = get<{ id: string }>(
    "SELECT id FROM calendars WHERE household_id = ? AND scope = 'shared' LIMIT 1",
    [created.householdId],
  )!.id;

  const calendarFor = (memberId: string) =>
    get<{ id: string }>("SELECT id FROM calendars WHERE owner_member_id = ? AND scope = 'personal' LIMIT 1", [
      memberId,
    ])!.id;

  return {
    householdId: created.householdId,
    admin,
    adminActor,
    adult,
    adultActor,
    child,
    childActor,
    relative,
    relativeActor,
    familyCalendarId,
    calendarFor,
  };
}

export function addDaysIso(days: number, hour = 10): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

export function clearAiEnv(): void {
  delete process.env.AI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
}
