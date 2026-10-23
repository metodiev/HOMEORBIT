import Link from "next/link";
import { all } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { requireActor } from "@/lib/auth/session";
import { intlLocale } from "@/lib/i18n";
import {
  addDaysToDateString,
  dateStringInZone,
  formatDate,
  formatTime,
  isoDayRange,
  monthName,
  startOfWeekDateString,
  toDateString,
  zonedParts,
} from "@/lib/util/dates";
import { listAgenda, type AgendaItem } from "@/lib/domain/events";
import { listCalendars } from "@/lib/domain/calendars";
import {
  cancelEventAction,
  createEventAction,
  importIcsAction,
  rsvpEventAction,
  updateEventAction,
} from "@/lib/actions";
import { Badge, Card, EmptyState, FeedbackBanner, MemberAvatar, PageHeader } from "@/components/ui";

export const metadata = { title: "Calendar" };

function toLocalInput(iso: string, timeZone: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${toDateString(parts)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    date?: string;
    calendarId?: string | string[];
    ok?: string;
    error?: string;
    new?: string;
  }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const locale = intlLocale(actor.locale);
  const view = params.view === "week" || params.view === "day" ? params.view : "month";
  const today = dateStringInZone(new Date(), actor.timezone);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date! : today;
  const selectedCalendars = (Array.isArray(params.calendarId) ? params.calendarId : params.calendarId ? [params.calendarId] : []).filter(Boolean);
  const calendars = listCalendars(actor);
  const members =
    actor.role === "relative"
      ? all<MemberRow>("SELECT * FROM members WHERE id = ?", [actor.id])
      : all<MemberRow>(
          "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
          [actor.householdId],
        );

  const monthStart = `${date.slice(0, 7)}-01`;
  const gridStart = view === "month" ? startOfWeekDateString(monthStart, 1) : view === "week" ? startOfWeekDateString(date, 1) : date;
  const gridEnd = view === "month" ? addDaysToDateString(gridStart, 41) : view === "week" ? addDaysToDateString(gridStart, 6) : date;
  const items = listAgenda(actor, {
    from: isoDayRange(gridStart, actor.timezone).start,
    to: isoDayRange(gridEnd, actor.timezone).end,
    calendarIds: selectedCalendars.length > 0 ? selectedCalendars : undefined,
  });
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const list = byDay.get(item.localDate) ?? [];
    list.push(item);
    byDay.set(item.localDate, list);
  }

  const days =
    view === "month"
      ? Array.from({ length: 42 }, (_, index) => addDaysToDateString(gridStart, index))
      : view === "week"
        ? Array.from({ length: 7 }, (_, index) => addDaysToDateString(gridStart, index))
        : [date];

  const filterQuery = (overrides: Record<string, string>) => {
    const query = new URLSearchParams();
    const merged = { view, date, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) query.set(key, value);
    }
    for (const calendarId of selectedCalendars) query.append("calendarId", calendarId);
    return `/calendar?${query.toString()}`;
  };

  const createOptions = calendars.filter(
    (calendar) => calendar.scope === "shared" || calendar.access === "owner" || calendar.canEdit,
  );

  return (
    <>
      <PageHeader
        eyebrow="Family calendar"
        title={view === "month" ? monthName(monthStart, locale) : view === "week" ? `Week of ${formatDate(gridStart, locale, actor.timezone)}` : formatDate(date, locale, actor.timezone, { weekday: "long", day: "numeric", month: "long" })}
        subtitle="Shared and personal calendars, school days, shifts and everything in between. Private events stay private, even from guardians."
        actions={
          <>
            <div className="flex rounded-full border border-black/10 bg-white p-0.5">
              {(["month", "week", "day"] as const).map((option) => (
                <Link
                  key={option}
                  href={filterQuery({ view: option })}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${
                    view === option ? "bg-teal text-white" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {option}
                </Link>
              ))}
            </div>
            <Link href={`/calendar?new=1&date=${date}`} className="btn">
              + New event
            </Link>
          </>
        }
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={filterQuery({ date: view === "month" ? `${date.slice(0, 7)}-01` : view === "week" ? addDaysToDateString(gridStart, -7) : addDaysToDateString(date, -1) })} className="btn-secondary px-3 py-1.5">
            ←
          </Link>
          <Link href={filterQuery({ date: today })} className="btn-secondary px-3 py-1.5">
            Today
          </Link>
          <Link href={filterQuery({ date: view === "month" ? addDaysToDateString(`${date.slice(0, 7)}-28`, 7) : view === "week" ? addDaysToDateString(gridStart, 7) : addDaysToDateString(date, 1) })} className="btn-secondary px-3 py-1.5">
            →
          </Link>
        </div>
        <form method="get" action="/calendar" className="flex flex-wrap items-center gap-2 text-xs">
          <input type="hidden" name="view" value={view} />
          <input type="date" name="date" defaultValue={date} className="rounded-full border border-black/10 bg-white px-3 py-1.5" />
          <select name="calendarId" defaultValue={selectedCalendars[0] ?? ""} className="rounded-full border border-black/10 bg-white px-3 py-1.5">
            <option value="">All calendars</option>
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-secondary px-3 py-1.5">
            Filter
          </button>
          {selectedCalendars.length > 0 ? (
            <Link href={`/calendar?view=${view}&date=${date}`} className="text-xs text-ink-soft hover:text-teal">
              Clear
            </Link>
          ) : null}
        </form>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {calendars.map((calendar) => (
          <span key={calendar.id} className="chip">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: calendar.color }} />
            {calendar.name}
            {calendar.scope === "personal" ? <span className="text-[10px] uppercase tracking-wide opacity-70">personal</span> : null}
          </span>
        ))}
      </div>

      {view === "month" ? (
        <Card padded={false} className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-black/5 bg-sand/50 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
              <div key={label} className="px-1 py-2">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const dayItems = byDay.get(day) ?? [];
              const isCurrentMonth = day.slice(0, 7) === date.slice(0, 7);
              const isToday = day === today;
              return (
                <div
                  key={day}
                  className={`min-h-[104px] border-b border-r border-black/5 p-1.5 ${
                    isCurrentMonth ? "bg-white" : "bg-sand/30"
                  } ${isToday ? "ring-2 ring-inset ring-teal/40" : ""}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <Link
                      href={`/calendar?view=day&date=${day}`}
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                        isToday ? "bg-teal text-white" : isCurrentMonth ? "text-ink hover:bg-sand" : "text-ink-soft"
                      }`}
                    >
                      {Number(day.slice(8, 10))}
                    </Link>
                    {dayItems.length > 3 ? <span className="text-[10px] text-ink-soft">+{dayItems.length - 3}</span> : null}
                  </div>
                  <div className="space-y-1">
                    {dayItems.slice(0, 3).map((item) => (
                      <Link
                        key={`${item.eventId}-${item.startsAt}`}
                        href={`/calendar?view=day&date=${day}`}
                        className="block truncate rounded-md px-1.5 py-1 text-[10px] font-medium text-white sm:text-[11px]"
                        style={{ backgroundColor: item.calendarColor }}
                        title={`${item.title} · ${item.calendarName}`}
                      >
                        {item.allDay ? "" : `${formatTime(item.startsAt, locale, actor.timezone)} `}
                        {item.title}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <div className={`grid gap-4 ${view === "week" ? "md:grid-cols-7" : ""}`}>
          {days.map((day) => {
            const dayItems = byDay.get(day) ?? [];
            return (
              <Card key={day} title={formatDate(day, locale, actor.timezone, { weekday: "short", day: "numeric", month: view === "day" ? "long" : "short" })} subtitle={day === today ? "Today" : undefined}>
                {dayItems.length === 0 ? (
                  <p className="text-xs text-ink-soft">No events.</p>
                ) : (
                  <ul className="space-y-2">
                    {dayItems.map((item) => {
                      const isParticipant = item.participants.some((participant) => participant.memberId === actor.id);
                      return (
                        <li key={`${item.eventId}-${item.startsAt}`} className="rounded-xl border border-black/5 bg-white p-2.5">
                          <div className="flex items-start gap-2">
                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.calendarColor }} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-ink">{item.title}</p>
                              <p className="text-[11px] text-ink-soft">
                                {item.allDay ? "All day" : `${formatTime(item.startsAt, locale, actor.timezone)}–${formatTime(item.endsAt, locale, actor.timezone)}`}
                                {item.location ? ` · ${item.location}` : ""}
                              </p>
                              <p className="text-[10px] uppercase tracking-wide text-ink-soft/70">{item.calendarName}</p>
                            </div>
                          </div>
                          {item.participants.length > 0 ? (
                            <div className="mt-2 flex items-center gap-1">
                              {item.participants.map((participant) => (
                                <MemberAvatar
                                  key={participant.memberId}
                                  name={`${participant.name} (${participant.response})`}
                                  color={participant.color}
                                  avatar={participant.avatar}
                                  size="sm"
                                />
                              ))}
                            </div>
                          ) : null}
                          {isParticipant ? (
                            <div className="mt-2 flex gap-1">
                              {(["accepted", "tentative", "declined"] as const).map((response) => (
                                <form key={response} action={rsvpEventAction}>
                                  <input type="hidden" name="eventId" value={item.eventId} />
                                  <input type="hidden" name="response" value={response} />
                                  <input type="hidden" name="redirectTo" value={`/calendar?view=${view}&date=${date}`} />
                                  <button type="submit" className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] hover:border-teal/40">
                                    {response}
                                  </button>
                                </form>
                              ))}
                            </div>
                          ) : null}
                          {item.canEdit ? (
                            <details className="mt-2 text-[11px]">
                              <summary className="cursor-pointer text-ink-soft hover:text-teal">Edit</summary>
                              <form action={updateEventAction} className="mt-2 space-y-2">
                                <input type="hidden" name="eventId" value={item.eventId} />
                                <input type="hidden" name="redirectTo" value={`/calendar?view=${view}&date=${date}`} />
                                <input name="title" defaultValue={item.title} className="field mt-0 text-xs" />
                                <div className="grid grid-cols-2 gap-1">
                                  <input type="datetime-local" name="startsAt" defaultValue={toLocalInput(item.startsAt, actor.timezone)} className="field mt-0 text-[10px]" />
                                  <input type="datetime-local" name="endsAt" defaultValue={toLocalInput(item.endsAt, actor.timezone)} className="field mt-0 text-[10px]" />
                                </div>
                                <input name="location" defaultValue={item.location ?? ""} placeholder="Location" className="field mt-0 text-xs" />
                                <button type="submit" className="btn-secondary w-full py-1 text-[11px]">
                                  Save changes
                                </button>
                              </form>
                              <form action={cancelEventAction} className="mt-1">
                                <input type="hidden" name="eventId" value={item.eventId} />
                                <input type="hidden" name="redirectTo" value={`/calendar?view=${view}&date=${date}`} />
                                <button type="submit" className="rounded-full border border-red-200 px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-50">
                                  Cancel event
                                </button>
                              </form>
                            </details>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <details open={params.new === "1"} className="card p-5">
          <summary className="cursor-pointer text-base font-semibold text-ink">New event</summary>
          {createOptions.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">You do not have a calendar you can add events to.</p>
          ) : (
            <form action={createEventAction} className="mt-4 space-y-3">
              <input type="hidden" name="redirectTo" value={`/calendar?view=${view}&date=${date}`} />
              <div>
                <label className="label" htmlFor="event-title">Title</label>
                <input id="event-title" name="title" required className="field" placeholder="Football practice, dentist…" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="event-calendar">Calendar</label>
                  <select id="event-calendar" name="calendarId" className="field" required>
                    {createOptions.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.name} {calendar.scope === "personal" ? "(personal)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="event-visibility">Visibility</label>
                  <select id="event-visibility" name="visibility" className="field" defaultValue="household">
                    <option value="household">Visible to the household</option>
                    <option value="private">Private to me</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="event-start">Starts</label>
                  <input id="event-start" type="datetime-local" name="startsAt" required defaultValue={`${date}T09:00`} className="field" />
                </div>
                <div>
                  <label className="label" htmlFor="event-end">Ends</label>
                  <input id="event-end" type="datetime-local" name="endsAt" required defaultValue={`${date}T10:00`} className="field" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="event-location">Location</label>
                  <input id="event-location" name="location" className="field" placeholder="Optional" />
                </div>
                <div>
                  <label className="label" htmlFor="event-recurrence">Repeats</label>
                  <select id="event-recurrence" name="recurrenceRule" className="field" defaultValue="">
                    <option value="">Does not repeat</option>
                    <option value="FREQ=DAILY">Every day</option>
                    <option value="FREQ=WEEKLY">Every week</option>
                    <option value="FREQ=WEEKLY;BYDAY=MO,WE,FR">Mon / Wed / Fri</option>
                    <option value="FREQ=MONTHLY">Every month</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Participants</label>
                <div className="mt-1 grid max-h-32 grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-black/10 bg-white p-2 text-xs">
                  {members.map((member) => (
                    <label key={member.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-sand/60">
                      <input type="checkbox" name="participantIds" value={member.id} />
                      <span>{member.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="event-description">Notes</label>
                <textarea id="event-description" name="description" rows={2} className="field" />
              </div>
              <button type="submit" className="btn w-full">
                Create event
              </button>
            </form>
          )}
        </details>

        <div className="space-y-4">
          <Card title="Calendars and files" subtitle="Export the visible range or import an ICS feed.">
            <div className="flex flex-wrap gap-2">
              <a
                className="btn-secondary"
                href={`/api/calendar/export?from=${view === "month" ? monthStart : gridStart}&to=${view === "month" ? addDaysToDateString(gridStart, 41) : gridEnd}`}
              >
                ⬇ Export ICS
              </a>
              <Link href="/settings#calendars" className="btn-secondary">
                Manage calendars
              </Link>
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-ink">Import an ICS file</summary>
              <form action={importIcsAction} className="mt-3 space-y-2">
                <input type="hidden" name="redirectTo" value={`/calendar?view=${view}&date=${date}`} />
                <select name="calendarId" required className="field mt-0">
                  {createOptions.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
                </select>
                <textarea name="icsText" rows={4} required placeholder="Paste the contents of an .ics file" className="field mt-0" />
                <button type="submit" className="btn w-full">Import (duplicates are skipped)</button>
              </form>
            </details>
          </Card>
          <Card title="Privacy" subtitle="What the calendar guarantees">
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>🔒 Private events are visible only to their creator — not even to guardians.</li>
              <li>🧭 Personal calendars are shared only when their owner grants access.</li>
              <li>🛡️ Conflict checks only use events you are allowed to see.</li>
              <li>🌍 Times are stored in UTC and shown in {actor.timezone}.</li>
            </ul>
          </Card>
        </div>
      </div>

      {items.length === 0 && view !== "month" ? <div className="mt-6"><EmptyState title="Nothing scheduled" description="Add an event or ask the assistant to find a free slot." /></div> : null}
    </>
  );
}
