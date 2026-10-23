import { zonedParts, zonedTimeToUtc, toDateString } from "./dates";

export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  interval: number;
  byDay: number[] | null; // 0=Sunday
  count: number | null;
  until: string | null; // ISO instant
};

const DAY_CODES: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

/** Parses the RFC 5545 subset HomeOrbit supports, e.g. `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH`. */
export function parseRecurrenceRule(rule: string | null | undefined): RecurrenceRule | null {
  if (!rule || !rule.trim()) return null;
  const fields = new Map<string, string>();
  for (const chunk of rule.split(";")) {
    const [rawKey, rawValue] = chunk.split("=");
    if (!rawKey || rawValue === undefined) continue;
    fields.set(rawKey.trim().toUpperCase(), rawValue.trim().toUpperCase());
  }
  const rawFrequency = fields.get("FREQ");
  if (!rawFrequency || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rawFrequency)) return null;
  const interval = Math.max(1, Number(fields.get("INTERVAL") ?? "1") || 1);
  const byDayRaw = fields.get("BYDAY");
  const byDay = byDayRaw
    ? byDayRaw
        .split(",")
        .map((code) => DAY_CODES[code.replace(/^[+-]?\d+/, "")])
        .filter((day): day is number => day !== undefined)
    : null;
  const count = fields.has("COUNT") ? Number(fields.get("COUNT")) : null;
  const until = fields.get("UNTIL");
  return {
    frequency: rawFrequency as RecurrenceFrequency,
    interval,
    byDay: byDay && byDay.length > 0 ? byDay : null,
    count: count && Number.isFinite(count) && count > 0 ? Math.floor(count) : null,
    until: until ? normalizeUntil(until) : null,
  };
}

function normalizeUntil(raw: string): string | null {
  const compact = /^\d{8}(T\d{6}Z?)?$/.exec(raw);
  if (compact) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    if (raw.includes("T")) {
      const hour = Number(raw.slice(9, 11));
      const minute = Number(raw.slice(11, 13));
      const second = Number(raw.slice(13, 15));
      return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
    }
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59)).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export type ExpandableEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  recurrenceRule: string | null;
  exceptionDates: string[];
  status?: string;
};

export type Occurrence = {
  eventId: string;
  start: Date;
  end: Date;
  localDate: string;
  isRecurringInstance: boolean;
};

const MAX_OCCURRENCES = 2000;

/**
 * Expands a (possibly recurring) event into occurrences intersecting the range.
 * Recurrence walks local wall-clock dates so weekly events keep their local time
 * across daylight-saving changes.
 */
export function expandOccurrences(
  event: ExpandableEvent,
  rangeStart: Date,
  rangeEnd: Date,
): Occurrence[] {
  if (event.status === "cancelled") return [];
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const baseParts = zonedParts(start, event.timezone);
  const rule = parseRecurrenceRule(event.recurrenceRule);

  if (!rule) {
    if (end.getTime() < rangeStart.getTime() || start.getTime() > rangeEnd.getTime()) return [];
    return [
      {
        eventId: event.id,
        start,
        end,
        localDate: toDateString(baseParts),
        isRecurringInstance: false,
      },
    ];
  }

  const exceptions = new Set(event.exceptionDates ?? []);
  const occurrences: Occurrence[] = [];
  const untilMs = rule.until ? new Date(rule.until).getTime() : null;
  const hardStop = new Date(
    Math.min(rangeEnd.getTime() + durationMs, Date.UTC(baseParts.year + 30, 0, 1)),
  );
  let generated = 0;
  let steps = 0;

  const pushOccurrence = (wall: {
    year: number;
    month: number;
    day: number;
    // time is captured from the base start
  }) => {
    const occurrenceStart = zonedTimeToUtc(
      {
        year: wall.year,
        month: wall.month,
        day: wall.day,
        hour: baseParts.hour,
        minute: baseParts.minute,
        second: baseParts.second,
      },
      event.timezone,
    );
    const localDate = toDateString(wall);
    if (exceptions.has(localDate)) return "continue" as const;
    generated += 1;
    if (rule.count !== null && generated > rule.count) return "stop" as const;
    if (untilMs !== null && occurrenceStart.getTime() > untilMs) return "stop" as const;
    const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
    if (occurrenceEnd.getTime() >= rangeStart.getTime() && occurrenceStart.getTime() <= rangeEnd.getTime()) {
      occurrences.push({
        eventId: event.id,
        start: occurrenceStart,
        end: occurrenceEnd,
        localDate,
        isRecurringInstance: true,
      });
    }
    if (occurrenceStart.getTime() > hardStop.getTime()) return "stop" as const;
    return "continue" as const;
  };

  if (rule.frequency === "DAILY") {
    let cursor = { ...baseParts };
    while (steps < MAX_OCCURRENCES) {
      steps += 1;
      const outcome = pushOccurrence(cursor);
      if (outcome === "stop") break;
      const next = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day));
      next.setUTCDate(next.getUTCDate() + rule.interval);
      cursor = {
        ...cursor,
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate(),
      };
    }
  } else if (rule.frequency === "WEEKLY") {
    const weekdays = rule.byDay ?? [baseParts.weekday];
    // Start from the beginning of the base week (Sunday) and walk day by day.
    const baseUtc = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day));
    baseUtc.setUTCDate(baseUtc.getUTCDate() - baseParts.weekday);
    let weekIndex = 0;
    while (steps < MAX_OCCURRENCES) {
      for (const weekday of weekdays) {
        steps += 1;
        const day = new Date(baseUtc);
        day.setUTCDate(day.getUTCDate() + weekIndex * 7 * rule.interval + weekday);
        const before = day.getTime() < Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day);
        if (before) continue;
        const outcome = pushOccurrence({
          year: day.getUTCFullYear(),
          month: day.getUTCMonth() + 1,
          day: day.getUTCDate(),
        });
        if (outcome === "stop") return occurrences;
      }
      weekIndex += 1;
      if (weekIndex * rule.interval > 520) break;
    }
  } else {
    const monthsPerStep = rule.frequency === "YEARLY" ? 12 : 1;
    let step = 0;
    while (steps < MAX_OCCURRENCES) {
      steps += 1;
      const monthIndex = baseParts.month - 1 + step * monthsPerStep * rule.interval;
      const year = baseParts.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (baseParts.day <= daysInMonth) {
        const outcome = pushOccurrence({ year, month, day: baseParts.day });
        if (outcome === "stop") break;
      }
      step += 1;
      if (year > baseParts.year + 30) break;
    }
  }

  return occurrences;
}
