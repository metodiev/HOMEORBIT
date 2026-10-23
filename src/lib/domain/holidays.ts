import { get } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { addDaysToDateString, dateStringInZone } from "@/lib/util/dates";

export type Holiday = { date: string; name: string; country: string };

export const HOLIDAY_COUNTRIES: { code: string; label: string }[] = [
  { code: "BG", label: "Bulgaria" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "DE", label: "Germany" },
  { code: "GR", label: "Greece" },
  { code: "RO", label: "Romania" },
];

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function dateOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Anonymous Gregorian algorithm. `orthodox` shifts to the Julian-based Easter. */
export function easterSunday(year: number, orthodox = false): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  let month = Math.floor((h + l - 7 * m + 114) / 31);
  let day = ((h + l - 7 * m + 114) % 31) + 1;
  if (orthodox) {
    // Convert the Julian result to the Gregorian calendar (13-day offset, 20th–21st c.).
    const julian = new Date(Date.UTC(year, month - 1, day));
    julian.setUTCDate(julian.getUTCDate() + 13);
    month = julian.getUTCMonth() + 1;
    day = julian.getUTCDate();
  }
  return dateOf(year, month, day);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return dateOf(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return dateOf(year, month, last.getUTCDate() - offset);
}

export function publicHolidays(country: string, year: number): Holiday[] {
  const code = country.toUpperCase();
  const add = (date: string, name: string): Holiday => ({ date, name, country: code });
  const list: Holiday[] = [];
  if (code === "BG") {
    list.push(
      add(dateOf(year, 1, 1), "New Year's Day"),
      add(dateOf(year, 3, 3), "Liberation Day"),
      add(dateOf(year, 5, 1), "Labour Day"),
      add(dateOf(year, 5, 6), "St George's Day"),
      add(dateOf(year, 5, 24), "Day of Bulgarian Culture"),
      add(dateOf(year, 9, 6), "Unification Day"),
      add(dateOf(year, 9, 22), "Independence Day"),
      add(dateOf(year, 12, 24), "Christmas Eve"),
      add(dateOf(year, 12, 25), "Christmas Day"),
      add(dateOf(year, 12, 26), "Second Day of Christmas"),
    );
    const easter = easterSunday(year, true);
    list.push(add(easter, "Orthodox Easter"), add(addDaysToDateString(easter, 1), "Easter Monday"));
  } else if (code === "US") {
    list.push(
      add(dateOf(year, 1, 1), "New Year's Day"),
      add(nthWeekdayOfMonth(year, 1, 1, 3), "Martin Luther King Jr. Day"),
      add(nthWeekdayOfMonth(year, 2, 1, 3), "Presidents' Day"),
      add(lastWeekdayOfMonth(year, 5, 1), "Memorial Day"),
      add(dateOf(year, 6, 19), "Juneteenth"),
      add(dateOf(year, 7, 4), "Independence Day"),
      add(nthWeekdayOfMonth(year, 9, 1, 1), "Labor Day"),
      add(nthWeekdayOfMonth(year, 10, 1, 2), "Columbus Day"),
      add(dateOf(year, 11, 11), "Veterans Day"),
      add(nthWeekdayOfMonth(year, 11, 4, 4), "Thanksgiving"),
      add(dateOf(year, 12, 25), "Christmas Day"),
    );
  } else if (code === "GB") {
    const easter = easterSunday(year, false);
    list.push(
      add(dateOf(year, 1, 1), "New Year's Day"),
      add(easter, "Easter Sunday"),
      add(addDaysToDateString(easter, 1), "Easter Monday"),
      add(nthWeekdayOfMonth(year, 5, 1, 1), "Early May bank holiday"),
      add(lastWeekdayOfMonth(year, 5, 1), "Spring bank holiday"),
      add(lastWeekdayOfMonth(year, 8, 1), "Summer bank holiday"),
      add(dateOf(year, 12, 25), "Christmas Day"),
      add(dateOf(year, 12, 26), "Boxing Day"),
    );
  } else if (code === "DE") {
    const easter = easterSunday(year, false);
    list.push(
      add(dateOf(year, 1, 1), "Neujahr"),
      add(addDaysToDateString(easter, -2), "Karfreitag"),
      add(addDaysToDateString(easter, 1), "Ostermontag"),
      add(dateOf(year, 5, 1), "Tag der Arbeit"),
      add(dateOf(year, 10, 3), "Tag der Deutschen Einheit"),
      add(dateOf(year, 12, 25), "1. Weihnachtstag"),
      add(dateOf(year, 12, 26), "2. Weihnachtstag"),
    );
  } else if (code === "GR") {
    const easter = easterSunday(year, true);
    list.push(
      add(dateOf(year, 1, 1), "New Year's Day"),
      add(dateOf(year, 3, 25), "Independence Day"),
      add(dateOf(year, 5, 1), "Labour Day"),
      add(addDaysToDateString(easter, -2), "Good Friday"),
      add(addDaysToDateString(easter, 1), "Easter Monday"),
      add(dateOf(year, 8, 15), "Assumption of Mary"),
      add(dateOf(year, 10, 28), "Ochi Day"),
      add(dateOf(year, 12, 25), "Christmas Day"),
    );
  } else if (code === "RO") {
    const easter = easterSunday(year, true);
    list.push(
      add(dateOf(year, 1, 1), "Anul Nou"),
      add(dateOf(year, 1, 24), "Unification Day"),
      add(addDaysToDateString(easter, -2), "Good Friday"),
      add(addDaysToDateString(easter, 1), "Easter Monday"),
      add(dateOf(year, 5, 1), "Labour Day"),
      add(dateOf(year, 6, 1), "Children's Day"),
      add(dateOf(year, 8, 15), "Assumption of Mary"),
      add(dateOf(year, 11, 30), "St Andrew's Day"),
      add(dateOf(year, 12, 1), "National Day"),
      add(dateOf(year, 12, 25), "Christmas Day"),
    );
  } else {
    return publicHolidays("BG", year);
  }
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

export function holidaysInRange(country: string, fromDate: string, toDate: string): Holiday[] {
  const fromYear = Number(fromDate.slice(0, 4));
  const toYear = Number(toDate.slice(0, 4));
  const results: Holiday[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    for (const holiday of publicHolidays(country, year)) {
      if (holiday.date >= fromDate && holiday.date <= toDate) results.push(holiday);
    }
  }
  return results;
}

export function holidayCountryForHousehold(householdId: string): string {
  const row = get<{ holiday_country: string }>("SELECT holiday_country FROM households WHERE id = ?", [
    householdId,
  ]);
  return row?.holiday_country ?? "BG";
}

export function upcomingHolidays(actor: Actor, fromDate: string, withinDays = 120): Holiday[] {
  const country = holidayCountryForHousehold(actor.householdId);
  return holidaysInRange(country, fromDate, addDaysToDateString(fromDate, withinDays));
}

export function todayInZone(timeZone: string): string {
  return dateStringInZone(new Date(), timeZone);
}
