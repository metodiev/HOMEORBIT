import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupDb, createFixture, freshDb, type Fixture } from "./helpers";
import {
  closePoll,
  createPoll,
  createTrip,
  generateTripChecklist,
  inviteToTrip,
  listPolls,
  listTripRsvps,
  listTrips,
  recordGuestRsvp,
  respondToTrip,
  votePoll,
} from "@/lib/domain/trips";
import { listTasks } from "@/lib/domain/tasks";
import { listShoppingItems } from "@/lib/domain/shopping";
import { AppError } from "@/lib/errors";

describe("holidays, invitations and polls", () => {
  let dbFile: string;
  let f: Fixture;
  let tripId: string;
  let guestRsvpId: string;

  beforeAll(() => {
    dbFile = freshDb();
    f = createFixture();
    const trip = createTrip(f.adminActor, {
      title: "Long weekend",
      destination: "Vitosha",
      startsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 12 * 86_400_000).toISOString(),
    });
    tripId = trip.id;
  });

  afterAll(() => cleanupDb(dbFile));

  it("does not count unanswered invitations as confirmed", () => {
    inviteToTrip(f.adminActor, tripId, { memberIds: [f.adult.id], guests: [{ name: "Nikola" }] });
    const rsvps = listTripRsvps(f.adminActor, tripId);
    expect(rsvps).toHaveLength(2);
    const guest = rsvps.find((rsvp) => rsvp.guest_name === "Nikola")!;
    guestRsvpId = guest.id;
    expect(guest.response).toBe("awaiting");
    const trip = listTrips(f.adminActor).find((entry) => entry.id === tripId)!;
    expect(trip.rsvpSummary.accepted).toBe(0);
    expect(trip.rsvpSummary.invited + trip.rsvpSummary.awaiting).toBe(2);
  });

  it("lets a guardian record a relative's reply and then counts it", () => {
    recordGuestRsvp(f.adultActor, guestRsvpId, "accepted");
    const trip = listTrips(f.adminActor).find((entry) => entry.id === tripId)!;
    expect(trip.rsvpSummary.accepted).toBe(1);
    expect(listTripRsvps(f.adminActor, tripId).find((rsvp) => rsvp.id === guestRsvpId)?.response).toBe("accepted");
  });

  it("does not let a child record a guest reply", () => {
    expect(() => recordGuestRsvp(f.childActor, guestRsvpId, "declined")).toThrow(AppError);
  });

  it("records a member's own RSVP", () => {
    respondToTrip(f.adultActor, tripId, "tentative");
    const trip = listTrips(f.adminActor).find((entry) => entry.id === tripId)!;
    expect(trip.rsvpSummary.tentative).toBe(1);
  });

  it("runs a poll and stops accepting votes after closing", () => {
    const poll = createPoll(f.adminActor, {
      tripId,
      question: "Where should we go?",
      kind: "destination",
      options: [{ label: "Vitosha" }, { label: "Rila" }],
    });
    const view = listPolls(f.adminActor, tripId).find((entry) => entry.id === poll.id)!;
    expect(view.options).toHaveLength(2);
    votePoll(f.adultActor, poll.id, view.options[0].id);
    const afterVote = listPolls(f.adminActor, tripId).find((entry) => entry.id === poll.id)!;
    expect(afterVote.options[0].count).toBe(1);
    closePoll(f.adminActor, poll.id);
    expect(() => votePoll(f.adultActor, poll.id, view.options[1].id)).toThrow(AppError);
  });

  it("generates a checklist of tasks and shopping items", () => {
    const result = generateTripChecklist(f.adminActor, tripId, { days: 4, assignToMemberId: f.admin.id });
    expect(result.tasks).toBeGreaterThan(0);
    expect(listTasks(f.adminActor, { category: "trip" }).length).toBeGreaterThanOrEqual(result.tasks);
    expect(listShoppingItems(f.adminActor).some((item) => item.category === "travel")).toBe(true);
  });
});
