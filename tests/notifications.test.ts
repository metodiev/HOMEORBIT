import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupDb, createFixture, freshDb, type Fixture } from "./helpers";
import {
  isQuietHours,
  listNotifications,
  markNotificationRead,
  notifyMember,
  unreadNotificationCount,
  type NotificationPreferences,
  getNotificationPreferences,
} from "@/lib/domain/notifications";
import { updateMemberProfile } from "@/lib/domain/settings";
import { get } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { zonedParts } from "@/lib/util/dates";

describe("notifications", () => {
  let dbFile: string;
  let f: Fixture;

  beforeAll(() => {
    dbFile = freshDb();
    f = createFixture();
  });

  afterAll(() => cleanupDb(dbFile));

  it("evaluates quiet hours correctly across midnight", () => {
    const prefs: NotificationPreferences = { quietHours: { start: "22:00", end: "07:00", enabled: true } };
    expect(isQuietHours(prefs, "Europe/Sofia", new Date("2026-06-01T20:30:00.000Z"))).toBe(true); // 23:30 local
    expect(isQuietHours(prefs, "Europe/Sofia", new Date("2026-06-01T03:00:00.000Z"))).toBe(true); // 06:00 local
    expect(isQuietHours(prefs, "Europe/Sofia", new Date("2026-06-01T09:00:00.000Z"))).toBe(false); // 12:00 local
    expect(
      isQuietHours(
        { quietHours: { start: "22:00", end: "07:00", enabled: false } },
        "Europe/Sofia",
        new Date("2026-06-01T20:30:00.000Z"),
      ),
    ).toBe(false);
  });

  it("deduplicates by key per member", () => {
    const member = get<MemberRow>("SELECT * FROM members WHERE id = ?", [f.adult.id])!;
    updateMemberProfile(f.adminActor, f.adult.id, {
      notificationPrefs: { quietHours: { start: "22:00", end: "07:00", enabled: false } },
    });
    const fresh = get<MemberRow>("SELECT * FROM members WHERE id = ?", [f.adult.id])!;
    const input = {
      title: "Test alert",
      body: "One",
      category: "calendar",
      dedupeKey: "test-dedupe-key",
      urgency: "normal" as const,
    };
    expect(notifyMember(fresh, input)).toBe(true);
    expect(notifyMember(fresh, { ...input, title: "Duplicate" })).toBe(false);
    const count = listNotifications(member.id).filter((notification) => notification.dedupe_key === "test-dedupe-key");
    expect(count).toHaveLength(1);
    expect(getNotificationPreferences(fresh).quietHours?.enabled).toBe(false);
  });

  it("respects muted categories", () => {
    updateMemberProfile(f.adminActor, f.adult.id, {
      notificationPrefs: { categories: { shopping: false }, quietHours: { start: "22:00", end: "07:00", enabled: false } },
    });
    const member = get<MemberRow>("SELECT * FROM members WHERE id = ?", [f.adult.id])!;
    expect(
      notifyMember(member, {
        title: "Shopping",
        category: "shopping",
        dedupeKey: "muted-shopping",
      }),
    ).toBe(false);
  });

  it("suppresses normal alerts in quiet hours but lets urgent ones through", () => {
    updateMemberProfile(f.adminActor, f.adult.id, {
      notificationPrefs: { quietHours: { start: "00:00", end: "23:59", enabled: true } },
    });
    const member = get<MemberRow>("SELECT * FROM members WHERE id = ?", [f.adult.id])!;
    const local = zonedParts(new Date(), member.timezone);
    if (local.hour === 23 && local.minute === 59) return; // negligible boundary
    expect(
      notifyMember(member, { title: "Quiet", category: "calendar", dedupeKey: "quiet-normal", urgency: "normal" }),
    ).toBe(false);
    expect(
      notifyMember(member, { title: "Urgent", category: "calendar", dedupeKey: "quiet-urgent", urgency: "high" }),
    ).toBe(true);
  });

  it("marks notifications as read and reports unread counts", () => {
    const member = get<MemberRow>("SELECT * FROM members WHERE id = ?", [f.adult.id])!;
    const before = unreadNotificationCount(member.id);
    expect(before).toBeGreaterThan(0);
    const first = listNotifications(member.id).find((notification) => !notification.read_at)!;
    markNotificationRead(member.id, first.id);
    expect(unreadNotificationCount(member.id)).toBe(before - 1);
  });
});
