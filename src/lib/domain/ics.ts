import { all, get, run } from "@/lib/db";
import type { CalendarRow, EventRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { canViewCalendar, canViewEvent } from "@/lib/auth/access";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { nowIso, sha256 } from "@/lib/util/ids";
import { parseRecurrenceRule } from "@/lib/util/recurrence";
import { zonedTimeToUtc } from "@/lib/util/dates";
import { createEvent } from "./events";

type IcsField = { name: string; params: Record<string, string>; value: string };

function unfold(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function parseFields(block: string): IcsField[] {
  const fields: IcsField[] = [];
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...paramParts] = head.split(";");
    const params: Record<string, string> = {};
    for (const part of paramParts) {
      const eq = part.indexOf("=");
      if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
    }
    fields.push({ name: name.toUpperCase(), params, value });
  }
  return fields;
}

function isValidTimeZone(value: string | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function parseIcsDate(value: string, params: Record<string, string>, fallbackTz: string) {
  const allDay = params.VALUE === "DATE" || /^\d{8}$/.test(value);
  if (allDay) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    return { date: zonedTimeToUtc({ year, month, day }, fallbackTz), allDay: true };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : { date: parsed, allDay: false };
  }
  const [, y, mo, d, h, mi, s, z] = match;
  if (z === "Z") {
    return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
  }
  const tz = isValidTimeZone(params.TZID) ? params.TZID : fallbackTz;
  return {
    date: zonedTimeToUtc(
      { year: +y, month: +mo, day: +d, hour: +h, minute: +mi, second: +s },
      tz,
    ),
    allDay: false,
  };
}

function parseIcsDuration(value: string): number {
  const match = /^(-)?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return 0;
  const sign = match[1] ? -1 : 1;
  const days = Number(match[2] ?? 0);
  const hours = Number(match[3] ?? 0);
  const minutes = Number(match[4] ?? 0);
  const seconds = Number(match[5] ?? 0);
  return sign * ((days * 24 * 60 + hours * 60 + minutes) * 60 + seconds) * 1000;
}

export type ParsedIcsEvent = {
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  recurrenceRule: string | null;
  exceptionDates: string[];
};

export function parseIcs(text: string, fallbackTz: string): ParsedIcsEvent[] {
  const unfolded = unfold(text);
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
  const events: ParsedIcsEvent[] = [];
  for (const block of blocks) {
    const fields = parseFields(block);
    const getField = (name: string) => fields.find((field) => field.name === name);
    const dtStart = getField("DTSTART");
    if (!dtStart) continue;
    const start = parseIcsDate(dtStart.value, dtStart.params, fallbackTz);
    if (!start) continue;
    const dtEnd = getField("DTEND");
    const parsedEnd = dtEnd ? parseIcsDate(dtEnd.value, dtEnd.params, fallbackTz) : null;
    let endMs = parsedEnd?.date.getTime() ?? 0;
    if (!parsedEnd) {
      const durationField = getField("DURATION");
      const durationMs = durationField ? parseIcsDuration(durationField.value) : 0;
      endMs = start.date.getTime() + (durationMs > 0 ? durationMs : 3_600_000);
    }
    if (start.allDay && !parsedEnd) endMs = start.date.getTime() + 86_400_000;
    const summary = getField("SUMMARY")?.value?.trim() || "Imported event";
    const uid = getField("UID")?.value?.trim();
    const rrule = getField("RRULE")?.value?.trim();
    const exceptionDates = fields
      .filter((field) => field.name === "EXDATE")
      .flatMap((field) => field.value.split(","))
      .map((value) => {
        const parsed = parseIcsDate(value.trim(), {}, fallbackTz);
        return parsed ? parsed.date.toISOString().slice(0, 10) : null;
      })
      .filter((value): value is string => Boolean(value));
    events.push({
      uid: uid || `ics-${sha256(`${summary}|${start.date.toISOString()}|${new Date(endMs).toISOString()}`).slice(0, 24)}`,
      summary,
      description: getField("DESCRIPTION")?.value?.trim() || null,
      location: getField("LOCATION")?.value?.trim() || null,
      startsAt: start.date.toISOString(),
      endsAt: new Date(Math.max(endMs, start.date.getTime() + 60_000)).toISOString(),
      allDay: start.allDay,
      recurrenceRule: rrule && parseRecurrenceRule(rrule) ? rrule : null,
      exceptionDates,
    });
  }
  return events;
}

export type ImportResult = {
  imported: number;
  skipped: number;
  failed: number;
  messages: string[];
  eventIds: string[];
};

export function importIcs(actor: Actor, calendarId: string, icsText: string): ImportResult {
  if (!can(actor, "event.create")) throw new ForbiddenError("Your role cannot import events.");
  const calendar = get<CalendarRow>(
    "SELECT * FROM calendars WHERE id = ? AND household_id = ? AND archived_at IS NULL",
    [calendarId, actor.householdId],
  );
  if (!calendar) throw new NotFoundError("Calendar not found.");
  if (!canViewCalendar(actor, calendar)) throw new ForbiddenError("You cannot import into this calendar.");
  if (icsText.length > 2_000_000) throw new ValidationError("The calendar file is too large (max 2 MB).");

  const parsed = parseIcs(icsText, calendar.id === actor.id ? actor.timezone : actor.householdTimezone);
  if (parsed.length === 0) throw new ValidationError("No events were found in this calendar file.");

  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, messages: [], eventIds: [] };
  for (const item of parsed) {
    const duplicate = get<EventRow>(
      `SELECT * FROM events WHERE household_id = ? AND source = 'ics' AND external_uid = ?`,
      [actor.householdId, item.uid],
    );
    if (duplicate) {
      result.skipped += 1;
      continue;
    }
    const fingerprint = get<EventRow>(
      `SELECT * FROM events WHERE household_id = ? AND title = ? AND starts_at = ? AND ends_at = ?`,
      [actor.householdId, item.summary, item.startsAt, item.endsAt],
    );
    if (fingerprint) {
      result.skipped += 1;
      continue;
    }
    try {
      const created = createEvent(actor, {
        calendarId,
        title: item.summary,
        description: item.description,
        location: item.location,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        allDay: item.allDay,
        recurrenceRule: item.recurrenceRule,
        exceptionDates: item.exceptionDates,
        timezone: actor.householdTimezone,
      });
      run("UPDATE events SET source = 'ics', external_uid = ? WHERE id = ?", [item.uid, created.id]);
      result.imported += 1;
      result.eventIds.push(created.id);
    } catch (error) {
      result.failed += 1;
      result.messages.push(error instanceof Error ? error.message : "Unknown import error");
    }
  }
  return result;
}

function formatIcsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function exportIcs(actor: Actor, from: string, to: string, calendarIds?: string[]): string {
  const rows = all<EventRow>(
    `SELECT * FROM events WHERE household_id = ? AND starts_at <= ? AND (recurrence_rule IS NOT NULL OR ends_at >= ?)
     ORDER BY starts_at`,
    [actor.householdId, to, from],
  );
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HomeOrbit//Family Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcs(actor.householdName)}`,
  ];
  for (const event of rows) {
    if (!canViewEvent(actor, event)) continue;
    if (calendarIds && calendarIds.length > 0 && !calendarIds.includes(event.calendar_id)) continue;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id}@homeorbit`);
    lines.push(`DTSTAMP:${formatIcsDate(nowIso())}`);
    lines.push(`DTSTART:${formatIcsDate(event.starts_at)}`);
    lines.push(`DTEND:${formatIcsDate(event.ends_at)}`);
    lines.push(`SUMMARY:${escapeIcs(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    if (event.recurrence_rule) lines.push(`RRULE:${event.recurrence_rule}`);
    const exceptions = JSON.parse(event.recurrence_exception_dates_json || "[]") as string[];
    for (const exception of exceptions) {
      lines.push(`EXDATE;VALUE=DATE:${exception.replace(/-/g, "")}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
