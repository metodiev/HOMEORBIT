import Link from "next/link";
import { all } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { requireActor } from "@/lib/auth/session";
import { intlLocale } from "@/lib/i18n";
import { addDaysToDateString, dateStringInZone, formatDate } from "@/lib/util/dates";
import {
  listPickups,
  listSchoolDays,
  missingPickupArrangements,
  schoolChildren,
} from "@/lib/domain/school";
import { listNotes } from "@/lib/domain/notes";
import {
  assignPickupAction,
  completePickupAction,
  confirmPickupAction,
  createPickupAction,
  ensurePickupsAction,
  upsertSchoolDayAction,
} from "@/lib/actions";
import { Badge, Card, EmptyState, FeedbackBanner, MemberAvatar, PageHeader } from "@/components/ui";

export const metadata = { title: "School & kids" };

export default async function SchoolPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const locale = intlLocale(actor.locale);
  const today = dateStringInZone(new Date(), actor.timezone);
  const end = addDaysToDateString(today, 9);

  if (actor.role === "relative") {
    return (
      <>
        <PageHeader eyebrow="School & kids" title="School & kids" subtitle="School information is limited to household members." />
        <EmptyState icon="🔐" title="Restricted area" description="Your guest account does not include school schedules or pickup coordination." />
      </>
    );
  }

  const children = schoolChildren(actor);
  const days = listSchoolDays(actor, today, end);
  const pickups = listPickups(actor, today, end);
  const missing = missingPickupArrangements(actor, today, end);
  const adults = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL AND role IN ('parent','adult') ORDER BY created_at",
    [actor.householdId],
  );
  const emergencyNotes = listNotes(actor, { category: "emergency" });
  const daysByDate = new Map<string, typeof days>();
  for (const day of days) {
    const list = daysByDate.get(day.date) ?? [];
    list.push(day);
    daysByDate.set(day.date, list);
  }
  const dates = [...daysByDate.keys()].sort();
  const pickupsByKey = new Map(pickups.map((pickup) => [`${pickup.member_id}:${pickup.date}`, pickup]));

  return (
    <>
      <PageHeader
        eyebrow="Children & routines"
        title="School & kids"
        subtitle="Timetables, drop-offs and pickups. Confirmation means the arrangement is agreed — never that a child actually arrived."
        actions={
          <>
            <Link href="/notes?category=emergency" className="btn-secondary">Emergency contacts</Link>
            <form action={ensurePickupsAction}>
              <input type="hidden" name="from" value={today} />
              <input type="hidden" name="to" value={end} />
              <input type="hidden" name="redirectTo" value="/school" />
              <button type="submit" className="btn">Create school runs from timetable</button>
            </form>
          </>
        }
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      {missing.length > 0 ? (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">{missing.length} pickup arrangement(s) missing or unassigned</p>
          <ul className="mt-1 list-inside list-disc text-xs">
            {missing.slice(0, 4).map((item) => (
              <li key={`${item.childId}-${item.date}`}>
                {item.childName} — {item.date} at {item.time}
                {item.reason === "no_pickup_row" ? " (no school run recorded)" : " (nobody responsible)"}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Every recorded school day in this window has someone responsible.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {dates.length === 0 ? (
            <EmptyState
              icon="🎒"
              title="No school days recorded"
              description="Add the timetable for each child, then generate school runs in one click."
            />
          ) : (
            dates.map((date) => {
              const dayEntries = daysByDate.get(date)!;
              const isToday = date === today;
              return (
                <Card
                  key={date}
                  title={formatDate(date, locale, actor.timezone, { weekday: "long", day: "numeric", month: "long" })}
                  subtitle={isToday ? "Today" : undefined}
                >
                  <ul className="space-y-3">
                    {dayEntries.map((day) => {
                      const pickup = pickupsByKey.get(`${day.member_id}:${date}`);
                      return (
                        <li key={day.id} className="rounded-xl border border-black/5 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <MemberAvatar name={day.childName} color={day.childColor} avatar={day.childAvatar} size="sm" />
                              <div>
                                <p className="text-sm font-medium text-ink">{day.childName}</p>
                                <p className="text-[11px] text-ink-soft">
                                  {day.start_time ?? "—"}–{day.end_time ?? "—"}
                                  {day.early_dismissal ? " · early dismissal" : ""}
                                </p>
                              </div>
                            </div>
                            {pickup ? (
                              <Badge
                                tone={
                                  pickup.status === "confirmed" || pickup.status === "completed"
                                    ? "teal"
                                    : pickup.responsible_member_id
                                      ? "blue"
                                      : "red"
                                }
                              >
                                {pickup.status.replace(/_/g, " ")}
                              </Badge>
                            ) : (
                              <Badge tone="red">no school run</Badge>
                            )}
                          </div>
                          {day.notes ? <p className="mt-1 text-[11px] text-ink-soft">{day.notes}</p> : null}

                          {pickup ? (
                            <div className="mt-2 flex flex-wrap items-end gap-2">
                              <div className="min-w-0 flex-1 text-xs text-ink-soft">
                                <p>
                                  Pickup {pickup.time} ·{" "}
                                  <strong className="text-ink">{pickup.responsibleName ?? "nobody assigned"}</strong>
                                </p>
                                {pickup.confirmedByName ? (
                                  <p className="text-[10px]">
                                    Confirmed by {pickup.confirmedByName}
                                    {pickup.confirmed_at ? ` · ${formatDate(pickup.confirmed_at, locale, actor.timezone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                                  </p>
                                ) : (
                                  <p className="text-[10px]">Not confirmed yet.</p>
                                )}
                              </div>
                              <form action={assignPickupAction} className="flex items-end gap-1">
                                <input type="hidden" name="pickupId" value={pickup.id} />
                                <input type="hidden" name="redirectTo" value="/school" />
                                <select
                                  name="responsibleMemberId"
                                  defaultValue={pickup.responsible_member_id ?? ""}
                                  className="rounded-full border border-black/10 bg-white px-2 py-1 text-[11px]"
                                >
                                  <option value="">Nobody</option>
                                  {adults.map((adult) => (
                                    <option key={adult.id} value={adult.id}>
                                      {adult.name.split(" ")[0]}
                                    </option>
                                  ))}
                                </select>
                                <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">Assign</button>
                              </form>
                              {pickup.responsible_member_id ? (
                                <>
                                  <form action={confirmPickupAction}>
                                    <input type="hidden" name="pickupId" value={pickup.id} />
                                    <input type="hidden" name="redirectTo" value="/school" />
                                    <button type="submit" className="btn-secondary px-2 py-1 text-[11px]">Confirm</button>
                                  </form>
                                  <form action={completePickupAction}>
                                    <input type="hidden" name="pickupId" value={pickup.id} />
                                    <input type="hidden" name="redirectTo" value="/school" />
                                    <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">Report done</button>
                                  </form>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })
          )}
        </div>

        <div className="space-y-4">
          <details className="card p-5">
            <summary className="cursor-pointer text-base font-semibold">Add a school day</summary>
            <form action={upsertSchoolDayAction} className="mt-4 space-y-3">
              <input type="hidden" name="redirectTo" value="/school" />
              <div>
                <label className="label" htmlFor="school-child">Child</label>
                <select id="school-child" name="memberId" required className="field">
                  {children.map((child) => (
                    <option key={child.id} value={child.id}>{child.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="school-date">Date</label>
                  <input id="school-date" type="date" name="date" required defaultValue={today} className="field" />
                </div>
                <div>
                  <label className="label" htmlFor="school-start">Starts</label>
                  <input id="school-start" type="time" name="startTime" defaultValue="08:15" className="field" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="school-end">Finishes</label>
                  <input id="school-end" type="time" name="endTime" defaultValue="14:30" className="field" />
                </div>
                <label className="flex items-end gap-2 pb-2 text-xs">
                  <input type="checkbox" name="earlyDismissal" /> Early dismissal
                </label>
              </div>
              <div>
                <label className="label" htmlFor="school-notes">Notes</label>
                <input id="school-notes" name="notes" className="field" placeholder="Swimming kit, club…" />
              </div>
              <button type="submit" className="btn w-full">Save school day</button>
            </form>
          </details>

          <details className="card p-5">
            <summary className="cursor-pointer text-base font-semibold">Add a school run</summary>
            <form action={createPickupAction} className="mt-4 space-y-3">
              <input type="hidden" name="redirectTo" value="/school" />
              <div>
                <label className="label" htmlFor="pickup-child">Child</label>
                <select id="pickup-child" name="memberId" required className="field">
                  {children.map((child) => (
                    <option key={child.id} value={child.id}>{child.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="pickup-date">Date</label>
                  <input id="pickup-date" type="date" name="date" required defaultValue={today} className="field" />
                </div>
                <div>
                  <label className="label" htmlFor="pickup-time">Time</label>
                  <input id="pickup-time" type="time" name="time" required defaultValue="14:30" className="field" />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="pickup-direction">Direction</label>
                <select id="pickup-direction" name="direction" className="field" defaultValue="pickup">
                  <option value="pickup">Pickup</option>
                  <option value="dropoff">Drop-off</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="pickup-adult">Responsible adult</label>
                <select id="pickup-adult" name="responsibleMemberId" className="field" defaultValue="">
                  <option value="">Nobody yet</option>
                  {adults.map((adult) => (
                    <option key={adult.id} value={adult.id}>{adult.name}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn w-full">Add school run</button>
            </form>
          </details>

          <Card title="Emergency information" subtitle="Visible only to members allowed to see it.">
            {emergencyNotes.length === 0 ? (
              <p className="text-sm text-ink-soft">No emergency notes are visible to you.</p>
            ) : (
              <ul className="space-y-2">
                {emergencyNotes.map((note) => (
                  <li key={note.id} className="rounded-xl bg-sand/50 p-3 text-xs">
                    <p className="font-semibold text-ink">{note.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-ink-soft">{note.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Consent first" subtitle="Child safety principles">
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>📍 Location tracking is off by default and is not implemented.</li>
              <li>✅ “Confirmed” means the adults agreed the arrangement. It is not GPS proof of arrival.</li>
              <li>🛡️ Guardians control pickup changes; the assistant always asks before reassigning someone else.</li>
              <li>🔔 Children see only their own and shared family information.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
