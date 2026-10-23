/** Time-zone-safe date helpers. All storage is UTC ISO; display uses IANA zones. */

export const MS_MINUTE = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sunday
};

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }
  const weekdayIndex = WEEKDAYS.indexOf(lookup.weekday ?? "Sun");
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour ?? "0"),
    minute: Number(lookup.minute ?? "0"),
    second: Number(lookup.second ?? "0"),
    weekday: weekdayIndex < 0 ? 0 : weekdayIndex,
  };
}

/** Offset of the time zone at the given instant, in milliseconds east of UTC. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a wall-clock time in a zone to the corresponding UTC instant. */
export function zonedTimeToUtc(
  input: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date {
  const asUtc = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour ?? 0,
    input.minute ?? 0,
    input.second ?? 0,
  );
  let guess = asUtc - timeZoneOffsetMs(new Date(asUtc), timeZone);
  guess = asUtc - timeZoneOffsetMs(new Date(guess), timeZone);
  guess = asUtc - timeZoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

export function toDateString(parts: Pick<ZonedParts, "year" | "month" | "day">): string {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day
    .toString()
    .padStart(2, "0")}`;
}

export function dateStringInZone(date: Date | string, timeZone: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return toDateString(zonedParts(d, timeZone));
}

export function parseDateString(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

export function addDaysToDateString(value: string, days: number): string {
  const { year, month, day } = parseDateString(value);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOfDateString(value: string): number {
  const { year, month, day } = parseDateString(value);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function parseTimeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function combineDateTime(dateString: string, timeString: string, timeZone: string): Date {
  const { year, month, day } = parseDateString(dateString);
  const minutes = parseTimeToMinutes(timeString);
  return zonedTimeToUtc(
    { year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
    timeZone,
  );
}

export function startOfDayUtc(dateString: string, timeZone: string): Date {
  return combineDateTime(dateString, "00:00", timeZone);
}

export function endOfDayUtc(dateString: string, timeZone: string): Date {
  return new Date(startOfDayUtc(addDaysToDateString(dateString, 1), timeZone).getTime() - 1000);
}

export function startOfWeekDateString(dateString: string, weekStartsOn = 1): string {
  const day = weekdayOfDateString(dateString);
  const delta = (day - weekStartsOn + 7) % 7;
  return addDaysToDateString(dateString, -delta);
}

export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * MS_MINUTE).toISOString();
}

export function formatDate(
  value: Date | string,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" },
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
}

export function formatTime(value: Date | string, locale: string, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(date);
}

export function formatDateTime(value: Date | string, locale: string, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

export function isoDayRange(dateString: string, timeZone: string): { start: string; end: string } {
  return {
    start: startOfDayUtc(dateString, timeZone).toISOString(),
    end: endOfDayUtc(dateString, timeZone).toISOString(),
  };
}

export function daysBetween(startDate: string, endDate: string): number {
  const a = parseDateString(startDate);
  const b = parseDateString(endDate);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_DAY,
  );
}

export function monthName(dateString: string, locale: string): string {
  const { year, month } = parseDateString(dateString);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}
