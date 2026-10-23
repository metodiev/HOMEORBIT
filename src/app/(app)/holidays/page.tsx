import Link from "next/link";
import { all } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { can } from "@/lib/auth/actor";
import { requireActor } from "@/lib/auth/session";
import { intlLocale } from "@/lib/i18n";
import { addDaysToDateString, dateStringInZone, formatDate, formatDateTime, toDateString } from "@/lib/util/dates";
import { holidaysInRange, holidayCountryForHousehold, HOLIDAY_COUNTRIES } from "@/lib/domain/holidays";
import {
  listPolls,
  listTripRsvps,
  listTrips,
} from "@/lib/domain/trips";
import {
  closePollAction,
  createPollAction,
  createTripAction,
  generateChecklistAction,
  guestRsvpAction,
  inviteTripAction,
  rsvpTripAction,
  updateTripAction,
  votePollAction,
} from "@/lib/actions";
import { Badge, Card, EmptyState, FeedbackBanner, MemberAvatar, PageHeader } from "@/components/ui";

export const metadata = { title: "Holidays & trips" };

export default async function HolidaysPage({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string; ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const locale = intlLocale(actor.locale);
  const today = dateStringInZone(new Date(), actor.timezone);
  const country = holidayCountryForHousehold(actor.householdId);
  const holidays = holidaysInRange(country, today, addDaysToDateString(today, 180));
  const trips = listTrips(actor);
  const selected = trips.find((trip) => trip.id === params.trip) ?? trips[0];
  const rsvps = selected ? listTripRsvps(actor, selected.id) : [];
  const polls = selected ? listPolls(actor, selected.id) : [];
  const canManage = can(actor, "trip.manage");
  const members =
    actor.role === "relative"
      ? all<MemberRow>("SELECT * FROM members WHERE id = ?", [actor.id])
      : all<MemberRow>(
          "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
          [actor.householdId],
        );
  const countryLabel = HOLIDAY_COUNTRIES.find((entry) => entry.code === country)?.label ?? country;
  const myRsvp = rsvps.find((rsvp) => rsvp.member_id === actor.id);
  const waitingGuests = rsvps.filter((rsvp) => rsvp.member_id === null && (rsvp.response === "awaiting" || rsvp.response === "invited"));

  return (
    <>
      <PageHeader
        eyebrow={`Public holidays · ${countryLabel}`}
        title="Holidays & trips"
        subtitle="Plan long weekends, ask relatives, and only treat accepted replies as confirmed. An empty calendar is never treated as availability."
        actions={
          canManage ? (
            <Link href={`/holidays?trip=${selected?.id ?? ""}#new-trip`} className="btn">
              + New trip
            </Link>
          ) : undefined
        }
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {holidays.slice(0, 4).map((holiday) => (
          <div key={`${holiday.date}-${holiday.name}`} className="rounded-2xl border border-black/5 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terracotta">Public holiday</p>
            <p className="mt-1 text-sm font-semibold text-ink">{holiday.name}</p>
            <p className="text-xs text-ink-soft">{formatDate(holiday.date, locale, actor.timezone, { weekday: "short", day: "numeric", month: "long" })}</p>
            <p className="mt-1 text-[11px] text-ink-soft">
              {trips.some((trip) => trip.starts_at && trip.ends_at && trip.starts_at.slice(0, 10) <= holiday.date && trip.ends_at.slice(0, 10) >= holiday.date)
                ? "✓ A trip covers this date"
                : "No plan yet"}
            </p>
          </div>
        ))}
        {holidays.length === 0 ? <p className="text-sm text-ink-soft">No public holidays in the next six months.</p> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {trips.length === 0 ? (
            <EmptyState icon="🌄" title="No trips planned" description="Create a trip, invite the relatives and let the family vote." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {trips.map((trip) => (
                <Link
                  key={trip.id}
                  href={`/holidays?trip=${trip.id}`}
                  className={`rounded-full border px-4 py-2 text-sm ${
                    selected?.id === trip.id ? "border-teal bg-teal text-white" : "border-black/10 bg-white text-ink-soft hover:border-teal/40"
                  }`}
                >
                  {trip.title}
                </Link>
              ))}
            </div>
          )}

          {selected ? (
            <Card
              title={selected.title}
              subtitle={`${selected.destination ?? "Destination open"} · ${selected.starts_at ? formatDate(selected.starts_at, locale, actor.timezone) : "dates open"}${selected.ends_at ? ` – ${formatDate(selected.ends_at, locale, actor.timezone)}` : ""}`}
              action={<Badge tone={selected.status === "confirmed" ? "teal" : "amber"}>{selected.status}</Badge>}
            >
              <div className="grid grid-cols-2 gap-2 text-xs text-ink-soft sm:grid-cols-4">
                <div className="rounded-xl bg-sand/50 p-2 text-center">
                  <p className="text-lg font-semibold text-ink">{selected.rsvpSummary.accepted}</p>
                  <p>accepted</p>
                </div>
                <div className="rounded-xl bg-sand/50 p-2 text-center">
                  <p className="text-lg font-semibold text-ink">{selected.rsvpSummary.tentative}</p>
                  <p>tentative</p>
                </div>
                <div className="rounded-xl bg-sand/50 p-2 text-center">
                  <p className="text-lg font-semibold text-ink">{selected.rsvpSummary.invited + selected.rsvpSummary.awaiting}</p>
                  <p>awaiting</p>
                </div>
                <div className="rounded-xl bg-sand/50 p-2 text-center">
                  <p className="text-lg font-semibold text-ink">{selected.rsvpSummary.declined}</p>
                  <p>declined</p>
                </div>
              </div>

              {selected.notes ? <p className="mt-3 rounded-xl bg-sand/50 p-3 text-sm text-ink">{selected.notes}</p> : null}

              <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink-soft">Invitations</h3>
              <ul className="mt-2 space-y-2">
                {rsvps.map((rsvp) => (
                  <li key={rsvp.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-black/5 bg-white p-2.5">
                    {rsvp.member_id ? (
                      <MemberAvatar
                        name={rsvp.memberName ?? "Member"}
                        color={rsvp.memberColor ?? "#64748b"}
                        avatar={rsvp.memberAvatar}
                        size="sm"
                      />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sand text-xs">👤</span>
                    )}
                    <span className="min-w-0 flex-1 text-sm text-ink">{rsvp.memberName ?? rsvp.guest_name ?? "Guest"}</span>
                    <Badge tone={rsvp.response === "accepted" ? "teal" : rsvp.response === "declined" ? "red" : "amber"}>
                      {rsvp.response}
                    </Badge>
                    {rsvp.member_id === actor.id ? (
                      <form action={rsvpTripAction} className="flex gap-1">
                        <input type="hidden" name="tripId" value={selected.id} />
                        <input type="hidden" name="redirectTo" value={`/holidays?trip=${selected.id}`} />
                        <select name="response" defaultValue="accepted" className="rounded-full border border-black/10 bg-white px-2 py-1 text-[10px]">
                          <option value="accepted">Accept</option>
                          <option value="tentative">Maybe</option>
                          <option value="declined">Decline</option>
                        </select>
                        <button type="submit" className="btn-secondary px-2 py-1 text-[10px]">Reply</button>
                      </form>
                    ) : null}
                    {canManage && !rsvp.member_id && (rsvp.response === "awaiting" || rsvp.response === "invited" || rsvp.response === "tentative") ? (
                      <form action={guestRsvpAction} className="flex gap-1">
                        <input type="hidden" name="rsvpId" value={rsvp.id} />
                        <input type="hidden" name="redirectTo" value={`/holidays?trip=${selected.id}`} />
                        <select name="response" defaultValue="accepted" className="rounded-full border border-black/10 bg-white px-2 py-1 text-[10px]">
                          <option value="accepted">Accepted</option>
                          <option value="declined">Declined</option>
                          <option value="tentative">Tentative</option>
                        </select>
                        <button type="submit" className="btn-secondary px-2 py-1 text-[10px]">Record reply</button>
                      </form>
                    ) : null}
                  </li>
                ))}
                {rsvps.length === 0 ? <li className="text-sm text-ink-soft">Nobody invited yet.</li> : null}
              </ul>
              {waitingGuests.length > 0 ? (
                <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  {waitingGuests.length} invited relative(s) have not replied. HomeOrbit will not treat them as attending until a guardian records an accepted reply.
                </p>
              ) : null}

              {canManage ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <form action={generateChecklistAction}>
                    <input type="hidden" name="tripId" value={selected.id} />
                    <input type="hidden" name="redirectTo" value={`/holidays?trip=${selected.id}`} />
                    <button type="submit" className="btn-secondary text-xs">Generate checklist</button>
                  </form>
                  <form action={updateTripAction} className="flex items-center gap-1">
                    <input type="hidden" name="tripId" value={selected.id} />
                    <input type="hidden" name="redirectTo" value={`/holidays?trip=${selected.id}`} />
                    <select name="status" defaultValue={selected.status} className="rounded-full border border-black/10 bg-white px-2 py-1.5 text-xs">
                      <option value="planning">Planning</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <button type="submit" className="btn-secondary px-3 py-1.5 text-xs">Save status</button>
                  </form>
                </div>
              ) : null}
            </Card>
          ) : null}

          {selected ? (
            <Card title="Polls" subtitle="Choose dates, destinations or activities together.">
              {polls.length === 0 ? (
                <p className="text-sm text-ink-soft">No polls for this trip.</p>
              ) : (
                <ul className="space-y-4">
                  {polls.map((poll) => (
                    <li key={poll.id} className="rounded-xl border border-black/5 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-ink">{poll.question}</p>
                          <p className="text-[11px] text-ink-soft">{poll.kind} · {poll.status}</p>
                        </div>
                        {canManage && poll.status === "open" ? (
                          <form action={closePollAction}>
                            <input type="hidden" name="pollId" value={poll.id} />
                            <input type="hidden" name="redirectTo" value={`/holidays?trip=${selected.id}`} />
                            <button type="submit" className="btn-ghost text-[11px]">Close poll</button>
                          </form>
                        ) : null}
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {poll.options.map((option) => (
                          <li key={option.id} className="flex flex-wrap items-center gap-2">
                            <form action={votePollAction} className="flex flex-1 items-center gap-2">
                              <input type="hidden" name="pollId" value={poll.id} />
                              <input type="hidden" name="optionId" value={option.id} />
                              <input type="hidden" name="redirectTo" value={`/holidays?trip=${selected.id}`} />
                              <button
                                type="submit"
                                disabled={poll.status !== "open"}
                                className={`flex-1 rounded-full border px-3 py-1.5 text-left text-xs ${
                                  poll.myOptionIds.includes(option.id)
                                    ? "border-teal bg-teal-mist text-teal-deep"
                                    : "border-black/10 bg-white text-ink-soft hover:border-teal/40"
                                }`}
                              >
                                {option.label}
                              </button>
                            </form>
                            <span className="text-[11px] text-ink-soft">
                              {option.count} vote(s){option.votes.length > 0 ? ` · ${option.votes.map((vote) => vote.name.split(" ")[0]).join(", ")}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}

              {canManage ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-ink">Create a poll</summary>
                  <form action={createPollAction} className="mt-3 space-y-2">
                    <input type="hidden" name="tripId" value={selected.id} />
                    <input type="hidden" name="redirectTo" value={`/holidays?trip=${selected.id}`} />
                    <input name="question" required placeholder="Where should we go?" className="field mt-0" />
                    <div className="grid grid-cols-2 gap-2">
                      <select name="kind" className="field mt-0" defaultValue="destination">
                        <option value="destination">Destination</option>
                        <option value="date">Date</option>
                        <option value="activity">Activity</option>
                      </select>
                      <input name="closesAt" type="datetime-local" className="field mt-0" />
                    </div>
                    <textarea name="options" rows={3} required placeholder="One option per line" className="field mt-0" />
                    <button type="submit" className="btn w-full py-1.5 text-xs">Create poll</button>
                  </form>
                </details>
              ) : null}
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          {canManage ? (
            <>
              <Card title="Invite the relatives" subtitle="Guests without accounts are tracked by name; nothing is assumed.">
                <form action={inviteTripAction} className="space-y-3">
                  <input type="hidden" name="tripId" value={selected?.id ?? ""} />
                  <input type="hidden" name="redirectTo" value={`/holidays?trip=${selected?.id ?? ""}`} />
                  <div>
                    <label className="label">Family members</label>
                    <div className="mt-1 grid max-h-32 grid-cols-1 gap-1 overflow-y-auto rounded-xl border border-black/10 bg-white p-2 text-xs">
                      {members
                        .filter((member) => member.id !== actor.id)
                        .map((member) => (
                          <label key={member.id} className="flex items-center gap-2 px-1 py-0.5">
                            <input type="checkbox" name="memberIds" value={member.id} />
                            <span>{member.name}</span>
                          </label>
                        ))}
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="guest-names">Guests without accounts</label>
                    <input id="guest-names" name="guestNames" placeholder="Nikola, Lora" className="field" />
                  </div>
                  <button type="submit" className="btn w-full" disabled={!selected}>Send invitations</button>
                </form>
              </Card>

              <details id="new-trip" className="card p-5">
                <summary className="cursor-pointer text-base font-semibold">New trip</summary>
                <form action={createTripAction} className="mt-4 space-y-3">
                  <input type="hidden" name="redirectTo" value="/holidays" />
                  <div>
                    <label className="label" htmlFor="trip-title">Title</label>
                    <input id="trip-title" name="title" required className="field" placeholder="Long weekend in the mountains" />
                  </div>
                  <div>
                    <label className="label" htmlFor="trip-destination">Destination</label>
                    <input id="trip-destination" name="destination" className="field" placeholder="Vitosha" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label" htmlFor="trip-start">Starts</label>
                      <input id="trip-start" type="datetime-local" name="startsAt" className="field" />
                    </div>
                    <div>
                      <label className="label" htmlFor="trip-end">Ends</label>
                      <input id="trip-end" type="datetime-local" name="endsAt" className="field" />
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="trip-budget">Budget</label>
                    <input id="trip-budget" name="budget" type="number" min="0" step="10" className="field" placeholder="900" />
                  </div>
                  <div>
                    <label className="label" htmlFor="trip-notes">Notes</label>
                    <textarea id="trip-notes" name="notes" rows={2} className="field" />
                  </div>
                  <button type="submit" className="btn w-full">Create trip</button>
                </form>
              </details>
            </>
          ) : (
            <Card title="Guest access" subtitle="You can reply to invitations addressed to you.">
              <p className="text-xs text-ink-soft">
                Only shared trips you are invited to appear here. Ask a guardian to update the plan or add you to another trip.
              </p>
            </Card>
          )}

          <Card title="Public holidays" subtitle={`${countryLabel} · next six months`}>
            {holidays.length === 0 ? (
              <p className="text-sm text-ink-soft">No holidays in this window.</p>
            ) : (
              <ul className="space-y-1.5">
                {holidays.slice(0, 10).map((holiday) => (
                  <li key={`${holiday.date}-${holiday.name}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-ink">{holiday.name}</span>
                    <span className="text-ink-soft">{formatDate(holiday.date, locale, actor.timezone, { day: "numeric", month: "short" })}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[10px] text-ink-soft">
              Country is configured in Settings. Holiday dates are computed locally; school vacation dates must be entered manually.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
