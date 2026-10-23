import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDaysIso, cleanupDb, createFixture, freshDb, type Fixture } from "./helpers";
import { createEvent, detectConflicts, findAvailableSlots, listAgenda } from "@/lib/domain/events";
import { exportIcs, importIcs } from "@/lib/domain/ics";
import { expandOccurrences } from "@/lib/util/recurrence";
import { zonedParts, isoDayRange } from "@/lib/util/dates";

describe("calendar intelligence", () => {
  let dbFile: string;
  let f: Fixture;
  const tomorrow = addDaysIso(1, 9);

  beforeAll(() => {
    dbFile = freshDb();
    f = createFixture();
  });

  afterAll(() => cleanupDb(dbFile));

  it("detects overlapping events for the involved member only", () => {
    const day = tomorrow.slice(0, 10);
    createEvent(f.adminActor, {
      calendarId: f.familyCalendarId,
      title: "Swimming",
      startsAt: `${day}T10:00:00+03:00`,
      endsAt: `${day}T11:00:00+03:00`,
      participantIds: [f.adult.id],
    });
    createEvent(f.adminActor, {
      calendarId: f.familyCalendarId,
      title: "Physio",
      startsAt: `${day}T10:30:00+03:00`,
      endsAt: `${day}T11:30:00+03:00`,
      participantIds: [f.adult.id],
    });
    const conflicts = detectConflicts(f.adminActor, `${day}T00:00:00+03:00`, `${day}T23:59:59+03:00`);
    expect(conflicts.some((conflict) => conflict.memberId === f.adult.id && conflict.overlapMinutes === 30)).toBe(true);
    const childConflicts = detectConflicts(f.childActor, `${day}T00:00:00+03:00`, `${day}T23:59:59+03:00`);
    expect(childConflicts.some((conflict) => conflict.first.title === "Swimming")).toBe(false);
  });

  it("finds free slots that avoid existing events", () => {
    const day = addDaysIso(2, 0).slice(0, 10);
    createEvent(f.adminActor, {
      calendarId: f.familyCalendarId,
      title: "Morning call",
      startsAt: `${day}T09:00:00+03:00`,
      endsAt: `${day}T10:00:00+03:00`,
      participantIds: [f.adult.id],
    });
    const slots = findAvailableSlots(f.adminActor, {
      from: `${day}T07:00:00+03:00`,
      to: `${day}T12:00:00+03:00`,
      durationMinutes: 60,
      memberIds: [f.adult.id],
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const start = new Date(slot.startsAt);
      expect(start.getUTCHours() === 6 && start.getUTCMinutes() === 0).toBe(false);
    }
  });

  it("keeps weekly recurrence at local wall-clock time across a DST shift", () => {
    const occurrences = expandOccurrences(
      {
        id: "recurring-1",
        startsAt: "2026-03-01T14:00:00.000Z",
        endsAt: "2026-03-01T15:00:00.000Z",
        timezone: "America/New_York",
        recurrenceRule: "FREQ=WEEKLY",
        exceptionDates: ["2026-03-15"],
        status: "confirmed",
      },
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-31T00:00:00.000Z"),
    );
    const dates = occurrences.map((occurrence) => occurrence.localDate);
    expect(dates).toContain("2026-03-01");
    expect(dates).toContain("2026-03-08");
    expect(dates).not.toContain("2026-03-15");
    expect(dates).toContain("2026-03-22");
    for (const occurrence of occurrences) {
      const parts = zonedParts(occurrence.start, "America/New_York");
      expect(parts.hour).toBe(9);
      expect(parts.minute).toBe(0);
    }
  });

  it("imports ICS files and skips duplicates on a second import", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:school-trip-2026",
      "SUMMARY:School trip",
      "DTSTART:20260501T080000Z",
      "DTEND:20260501T150000Z",
      "LOCATION:Zoo",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:holiday-2026",
      "SUMMARY:All day holiday",
      "DTSTART;VALUE=DATE:20260502",
      "DTEND;VALUE=DATE:20260503",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const first = importIcs(f.adminActor, f.familyCalendarId, ics);
    expect(first.imported).toBe(2);
    const second = importIcs(f.adminActor, f.familyCalendarId, ics);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);

    const items = listAgenda(f.adminActor, {
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-03T23:59:59.000Z",
    }).filter((item) => item.calendarId === f.familyCalendarId);
    expect(items.filter((item) => item.title === "School trip")).toHaveLength(1);

    const exported = exportIcs(f.adminActor, "2026-05-01T00:00:00.000Z", "2026-05-03T23:59:59.000Z");
    expect(exported).toContain("SUMMARY:School trip");
    expect(exported).toContain("BEGIN:VCALENDAR");
  });

  it("records imported all-day dates without shifting them", () => {
    const items = listAgenda(f.adminActor, {
      from: isoDayRange("2026-05-02", "UTC").start,
      to: isoDayRange("2026-05-02", "UTC").end,
    }).filter((item) => item.title === "All day holiday");
    expect(items).toHaveLength(1);
    expect(items[0].allDay).toBe(true);
    expect(items[0].localDate).toBe("2026-05-02");
  });
});
