import { all, get, run } from "@/lib/db";
import type { MemberRow, PollOptionRow, PollRow, TripRow, TripRsvpRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso } from "@/lib/util/ids";
import { notifyMember } from "./notifications";
import { recordAudit } from "./audit";
import { createTask } from "./tasks";
import { addShoppingItem, getOrCreateDefaultList } from "./shopping";

export type TripView = TripRow & {
  rsvpSummary: { accepted: number; invited: number; awaiting: number; declined: number; tentative: number };
  myResponse: TripRsvpRow["response"] | null;
};

export type RsvpView = TripRsvpRow & { memberName: string | null; memberColor: string | null; memberAvatar: string | null };

function tripVisible(actor: Actor, tripId: string): boolean {
  if (actor.role !== "relative") return true;
  return Boolean(
    get<{ id: string }>("SELECT id FROM trip_rsvps WHERE trip_id = ? AND member_id = ?", [tripId, actor.id]),
  );
}

export function listTrips(actor: Actor): TripView[] {
  const rows = all<TripRow>(
    "SELECT * FROM trips WHERE household_id = ? AND status != 'cancelled' ORDER BY COALESCE(starts_at, created_at)",
    [actor.householdId],
  ).filter((trip) => tripVisible(actor, trip.id));
  return rows.map((trip) => {
    const rsvps = listTripRsvps(actor, trip.id);
    const summary = { accepted: 0, invited: 0, awaiting: 0, declined: 0, tentative: 0 };
    for (const rsvp of rsvps) summary[rsvp.response] += 1;
    const mine = rsvps.find((rsvp) => rsvp.member_id === actor.id);
    return { ...trip, rsvpSummary: summary, myResponse: mine?.response ?? null };
  });
}

export function getTrip(actor: Actor, tripId: string): TripRow {
  const trip = get<TripRow>("SELECT * FROM trips WHERE id = ? AND household_id = ?", [
    tripId,
    actor.householdId,
  ]);
  if (!trip || !tripVisible(actor, trip.id)) throw new NotFoundError("Trip not found.");
  return trip;
}

export function createTrip(
  actor: Actor,
  input: {
    title: string;
    destination?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    notes?: string | null;
    budget?: number | null;
  },
): TripRow {
  if (!can(actor, "trip.manage")) throw new ForbiddenError("Your role cannot plan trips.");
  const title = input.title.trim();
  if (!title) throw new ValidationError("A trip needs a title.");
  if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) {
    throw new ValidationError("The trip must end after it starts.");
  }
  const id = newId("trp");
  run(
    `INSERT INTO trips (id, household_id, title, destination, starts_at, ends_at, notes, budget, status, created_by,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planning', ?, ?, ?)`,
    [
      id,
      actor.householdId,
      title,
      input.destination ?? null,
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.notes ?? null,
      input.budget ?? null,
      actor.id,
      nowIso(),
      nowIso(),
    ],
  );
  recordAudit(actor, "trip.created", "trip", id, { title });
  return get<TripRow>("SELECT * FROM trips WHERE id = ?", [id]) as TripRow;
}

export function updateTrip(
  actor: Actor,
  tripId: string,
  input: { title?: string; destination?: string | null; startsAt?: string | null; endsAt?: string | null; notes?: string | null; budget?: number | null; status?: TripRow["status"] },
): TripRow {
  if (!can(actor, "trip.manage")) throw new ForbiddenError("Your role cannot plan trips.");
  const trip = getTrip(actor, tripId);
  run(
    `UPDATE trips SET title = ?, destination = ?, starts_at = ?, ends_at = ?, notes = ?, budget = ?, status = ?,
      updated_at = ? WHERE id = ?`,
    [
      input.title?.trim() || trip.title,
      input.destination !== undefined ? input.destination : trip.destination,
      input.startsAt !== undefined ? input.startsAt : trip.starts_at,
      input.endsAt !== undefined ? input.endsAt : trip.ends_at,
      input.notes !== undefined ? input.notes : trip.notes,
      input.budget !== undefined ? input.budget : trip.budget,
      input.status ?? trip.status,
      nowIso(),
      trip.id,
    ],
  );
  recordAudit(actor, "trip.updated", "trip", trip.id, { status: input.status });
  return get<TripRow>("SELECT * FROM trips WHERE id = ?", [trip.id]) as TripRow;
}

export function listTripRsvps(actor: Actor, tripId: string): RsvpView[] {
  getTrip(actor, tripId);
  return all<RsvpView>(
    `SELECT r.*, m.name AS memberName, m.color AS memberColor, m.avatar AS memberAvatar
     FROM trip_rsvps r LEFT JOIN members m ON m.id = r.member_id
     WHERE r.trip_id = ? ORDER BY r.created_at`,
    [tripId],
  );
}

export function inviteToTrip(
  actor: Actor,
  tripId: string,
  input: { memberIds?: string[]; guests?: { name: string; email?: string }[] },
): { invitedMembers: number; invitedGuests: number } {
  if (!can(actor, "trip.manage")) throw new ForbiddenError("Your role cannot invite people.");
  const trip = getTrip(actor, tripId);
  let invitedMembers = 0;
  let invitedGuests = 0;
  for (const memberId of input.memberIds ?? []) {
    const member = get<MemberRow>(
      "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
      [memberId, actor.householdId],
    );
    if (!member) throw new ValidationError("That family member does not exist.");
    const existing = get<TripRsvpRow>("SELECT * FROM trip_rsvps WHERE trip_id = ? AND member_id = ?", [
      trip.id,
      member.id,
    ]);
    if (existing) continue;
    run(
      `INSERT INTO trip_rsvps (id, household_id, trip_id, member_id, guest_name, response, created_at)
       VALUES (?, ?, ?, ?, NULL, 'invited', ?)`,
      [newId("rsv"), actor.householdId, trip.id, member.id, nowIso()],
    );
    invitedMembers += 1;
    notifyMember(member, {
      title: `Invitation: ${trip.title}`,
      body: `${actor.name} invited you${trip.destination ? ` to ${trip.destination}` : ""}. Please reply.`,
      category: "holidays",
      urgency: "normal",
      dedupeKey: `trip-invite:${trip.id}:${member.id}`,
      link: `/holidays?trip=${trip.id}`,
    });
  }
  for (const guest of input.guests ?? []) {
    const name = guest.name.trim();
    if (!name) continue;
    const existing = get<TripRsvpRow>(
      "SELECT * FROM trip_rsvps WHERE trip_id = ? AND guest_name = ?",
      [trip.id, name],
    );
    if (existing) continue;
    run(
      `INSERT INTO trip_rsvps (id, household_id, trip_id, member_id, guest_name, response, created_at)
       VALUES (?, ?, ?, NULL, ?, 'awaiting', ?)`,
      [newId("rsv"), actor.householdId, trip.id, name, nowIso()],
    );
    invitedGuests += 1;
  }
  recordAudit(actor, "trip.invited", "trip", trip.id, { invitedMembers, invitedGuests });
  return { invitedMembers, invitedGuests };
}

export function respondToTrip(
  actor: Actor,
  tripId: string,
  response: Exclude<TripRsvpRow["response"], "awaiting" | "invited">,
): void {
  const trip = getTrip(actor, tripId);
  const existing = get<TripRsvpRow>("SELECT * FROM trip_rsvps WHERE trip_id = ? AND member_id = ?", [
    trip.id,
    actor.id,
  ]);
  if (existing) {
    run("UPDATE trip_rsvps SET response = ?, responded_at = ? WHERE id = ?", [response, nowIso(), existing.id]);
  } else {
    run(
      `INSERT INTO trip_rsvps (id, household_id, trip_id, member_id, guest_name, response, responded_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
      [newId("rsv"), actor.householdId, trip.id, actor.id, response, nowIso(), nowIso()],
    );
  }
  recordAudit(actor, "trip.rsvp", "trip", trip.id, { response });
}

/**
 * Guards record a response on behalf of an invited relative who has no account.
 * The audit log keeps who recorded it; the app never assumes a guest is coming.
 */
export function recordGuestRsvp(
  actor: Actor,
  rsvpId: string,
  response: Exclude<TripRsvpRow["response"], "invited">,
): TripRsvpRow {
  if (!can(actor, "trip.manage")) throw new ForbiddenError("Only a guardian can record a guest response.");
  const rsvp = get<TripRsvpRow>(
    "SELECT * FROM trip_rsvps WHERE id = ? AND household_id = ?",
    [rsvpId, actor.householdId],
  );
  if (!rsvp) throw new NotFoundError("Invitation not found.");
  if (rsvp.member_id) throw new ValidationError("This invitation belongs to a household member.");
  run("UPDATE trip_rsvps SET response = ?, responded_at = ? WHERE id = ?", [response, nowIso(), rsvp.id]);
  recordAudit(actor, "trip.guest_rsvp", "trip_rsvp", rsvp.id, { response, recordedBy: actor.id, guest: rsvp.guest_name });
  return get<TripRsvpRow>("SELECT * FROM trip_rsvps WHERE id = ?", [rsvp.id]) as TripRsvpRow;
}

export type PollView = PollRow & {
  options: (PollOptionRow & { votes: { memberId: string; name: string }[]; count: number })[];
  myOptionIds: string[];
};

export function createPoll(
  actor: Actor,
  input: {
    tripId?: string | null;
    question: string;
    kind: PollRow["kind"];
    options: { label: string; startsAt?: string | null; endsAt?: string | null }[];
    closesAt?: string | null;
  },
): PollRow {
  if (!can(actor, "trip.manage")) throw new ForbiddenError("Your role cannot create polls.");
  const question = input.question.trim();
  if (!question) throw new ValidationError("A poll needs a question.");
  if (input.tripId) getTrip(actor, input.tripId);
  const options = (input.options ?? []).filter((option) => option.label.trim());
  if (options.length < 2) throw new ValidationError("Provide at least two options.");
  const id = newId("pol");
  run(
    `INSERT INTO polls (id, household_id, trip_id, question, kind, status, closes_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    [id, actor.householdId, input.tripId ?? null, question, input.kind, input.closesAt ?? null, actor.id, nowIso()],
  );
  for (const option of options) {
    run("INSERT INTO poll_options (id, poll_id, label, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)", [
      newId("pop"),
      id,
      option.label.trim(),
      option.startsAt ?? null,
      option.endsAt ?? null,
    ]);
  }
  recordAudit(actor, "poll.created", "poll", id, { question, options: options.length });
  return get<PollRow>("SELECT * FROM polls WHERE id = ?", [id]) as PollRow;
}

export function listPolls(actor: Actor, tripId?: string): PollView[] {
  const polls = all<PollRow>(
    `SELECT * FROM polls WHERE household_id = ?${tripId ? " AND trip_id = ?" : ""} ORDER BY created_at DESC`,
    tripId ? [actor.householdId, tripId] : [actor.householdId],
  );
  return polls.map((poll) => {
    const options = all<PollOptionRow>("SELECT * FROM poll_options WHERE poll_id = ? ORDER BY rowid", [poll.id]);
    const votes = all<{ option_id: string; member_id: string; name: string }>(
      `SELECT pv.option_id, pv.member_id, m.name FROM poll_votes pv JOIN members m ON m.id = pv.member_id
       WHERE pv.poll_id = ?`,
      [poll.id],
    );
    return {
      ...poll,
      options: options.map((option) => {
        const optionVotes = votes.filter((vote) => vote.option_id === option.id);
        return {
          ...option,
          votes: optionVotes.map((vote) => ({ memberId: vote.member_id, name: vote.name })),
          count: optionVotes.length,
        };
      }),
      myOptionIds: votes.filter((vote) => vote.member_id === actor.id).map((vote) => vote.option_id),
    };
  });
}

export function votePoll(actor: Actor, pollId: string, optionId: string): void {
  const poll = get<PollRow>("SELECT * FROM polls WHERE id = ? AND household_id = ?", [
    pollId,
    actor.householdId,
  ]);
  if (!poll) throw new NotFoundError("Poll not found.");
  if (poll.status !== "open") throw new ValidationError("This poll is closed.");
  const option = get<PollOptionRow>("SELECT * FROM poll_options WHERE id = ? AND poll_id = ?", [optionId, pollId]);
  if (!option) throw new NotFoundError("Poll option not found.");
  run("DELETE FROM poll_votes WHERE poll_id = ? AND member_id = ?", [pollId, actor.id]);
  run("INSERT INTO poll_votes (poll_id, option_id, member_id, created_at) VALUES (?, ?, ?, ?)", [
    pollId,
    optionId,
    actor.id,
    nowIso(),
  ]);
  recordAudit(actor, "poll.voted", "poll", pollId, { optionId });
}

export function closePoll(actor: Actor, pollId: string): void {
  if (!can(actor, "trip.manage")) throw new ForbiddenError("Your role cannot close polls.");
  run("UPDATE polls SET status = 'closed' WHERE id = ? AND household_id = ?", [pollId, actor.householdId]);
  recordAudit(actor, "poll.closed", "poll", pollId);
}

const CHECKLIST_BASE = [
  "Check passports / ID documents",
  "Pack chargers and adapters",
  "Pack medications and first-aid kit",
  "Arrange pet or plant care",
  "Secure the house (windows, heating, bins)",
];

export function generateTripChecklist(
  actor: Actor,
  tripId: string,
  options: { days?: number; assignToMemberId?: string | null; createShoppingItems?: boolean } = {},
): { tasks: number; shoppingItems: number } {
  const trip = getTrip(actor, tripId);
  const items = [...CHECKLIST_BASE];
  const days = options.days ?? 3;
  if (days > 2) items.push("Pack clothing for the full trip", "Download offline maps");
  if (days > 5) items.push("Arrange mail hold", "Check travel insurance");
  let tasks = 0;
  for (const title of items) {
    createTask(actor, {
      title: `${trip.title}: ${title}`,
      category: "trip",
      assignedMemberId: options.assignToMemberId ?? null,
      dueAt: trip.starts_at,
      notes: "Generated by the trip checklist",
    });
    tasks += 1;
  }
  let shoppingItems = 0;
  if (options.createShoppingItems !== false) {
    getOrCreateDefaultList(actor);
    for (const name of ["Travel snacks", "Sunscreen", "Toothpaste", "Phone power bank"]) {
      addShoppingItem(actor, { name, category: "travel" });
      shoppingItems += 1;
    }
  }
  recordAudit(actor, "trip.checklist_generated", "trip", trip.id, { tasks, shoppingItems });
  return { tasks, shoppingItems };
}

export function tripGuests(actor: Actor, tripId: string): RsvpView[] {
  return listTripRsvps(actor, tripId).filter((rsvp) => rsvp.member_id === null);
}
