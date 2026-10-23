import { all, get, run } from "@/lib/db";
import type { EventRow, MemberRow } from "@/lib/db/rows";
import { actorForMember } from "@/lib/auth/session-store";
import type { Actor } from "@/lib/auth/actor";
import { newId, nowIso } from "@/lib/util/ids";
import {
  addDaysToDateString,
  dateStringInZone,
  daysBetween,
  formatDate,
  formatDateTime,
  isoDayRange,
} from "@/lib/util/dates";
import { detectConflicts, listAgenda } from "@/lib/domain/events";
import { listPackages } from "@/lib/domain/packages";
import { listTasks } from "@/lib/domain/tasks";
import { missingPickupArrangements } from "@/lib/domain/school";
import { listTrips } from "@/lib/domain/trips";
import { upcomingHolidays } from "@/lib/domain/holidays";
import { listShoppingItems } from "@/lib/domain/shopping";
import { listMealPlan } from "@/lib/domain/household";
import { notifyMember } from "@/lib/domain/notifications";
import { recordAudit } from "@/lib/domain/audit";

export type InsightSeverity = "info" | "warning" | "critical";

export type Insight = {
  key: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  link: string;
  recipients: string[];
};

export function computeInsights(actor: Actor, now = new Date()): Insight[] {
  const today = dateStringInZone(now, actor.householdTimezone);
  const horizon = addDaysToDateString(today, 14);
  const fromIso = isoDayRange(today, actor.householdTimezone).start;
  const toIso = isoDayRange(horizon, actor.householdTimezone).end;
  const insights: Insight[] = [];

  const members = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL",
    [actor.householdId],
  );
  const parents = members.filter((member) => member.role === "parent");
  const adults = members.filter((member) => member.role === "parent" || member.role === "adult");

  // 1. Scheduling conflicts
  for (const conflict of detectConflicts(actor, fromIso, toIso)) {
    insights.push({
      key: `conflict:${conflict.first.eventId}:${conflict.second.eventId}:${conflict.memberId}`,
      severity: "warning",
      title: `Schedule clash for ${conflict.memberName}`,
      body: `"${conflict.first.title}" overlaps "${conflict.second.title}" on ${formatDate(conflict.first.startsAt, actor.locale, actor.householdTimezone)} by ${conflict.overlapMinutes} minutes.`,
      link: "/calendar",
      recipients: [...new Set([conflict.memberId, ...parents.map((member) => member.id)])],
    });
  }

  // 2. Missing school pickups
  for (const missing of missingPickupArrangements(actor, today, addDaysToDateString(today, 7))) {
    insights.push({
      key: `pickup-missing:${missing.childId}:${missing.date}`,
      severity: "critical",
      title: `No confirmed pickup for ${missing.childName}`,
      body: `${missing.childName} finishes at ${missing.time} on ${missing.date}, but nobody is responsible yet. This is an arrangement reminder, not proof of arrival.`,
      link: "/school",
      recipients: parents.map((member) => member.id),
    });
  }

  // 3. Packages needing attention
  for (const pkg of listPackages(actor)) {
    const deadlineSoon =
      pkg.deadline && pkg.deadline <= addDaysToDateString(today, 2) && pkg.deadline >= today;
    if (deadlineSoon || (!pkg.collector_member_id && pkg.expected_to && pkg.expected_to.slice(0, 10) <= addDaysToDateString(today, 1))) {
      insights.push({
        key: `package-attention:${pkg.id}:${today}`,
        severity: deadlineSoon ? "critical" : "warning",
        title: deadlineSoon ? `Collect “${pkg.description}” soon` : `Someone must receive “${pkg.description}”`,
        body: deadlineSoon
          ? `Collection deadline is ${pkg.deadline ? formatDateTime(pkg.deadline, actor.locale, actor.householdTimezone) : "soon"}.`
          : `Expected ${pkg.expected_to ? formatDateTime(pkg.expected_to, actor.locale, actor.householdTimezone) : "today"} and no collector is assigned.`,
        link: "/deliveries",
        recipients: [...adults.map((member) => member.id)],
      });
    }
  }

  // 4. Unconfirmed invitations (events and trips)
  const agenda = listAgenda(actor, { from: fromIso, to: toIso });
  const seenEvents = new Set<string>();
  for (const item of agenda) {
    if (seenEvents.has(item.eventId)) continue;
    const awaiting = item.participants.filter((p) => p.response === "invited" || p.response === "awaiting");
    if (awaiting.length === 0) continue;
    seenEvents.add(item.eventId);
    insights.push({
      key: `rsvp-pending:${item.eventId}`,
      severity: "info",
      title: `Waiting for replies: ${item.title}`,
      body: `${awaiting.map((p) => p.name).join(", ")} ${awaiting.length === 1 ? "has" : "have"} not confirmed. Unanswered invitations are never treated as confirmed.`,
      link: "/calendar",
      recipients: [...new Set([item.createdBy, ...parents.map((member) => member.id)])],
    });
  }
  for (const trip of listTrips(actor)) {
    const awaiting = get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM trip_rsvps WHERE trip_id = ? AND response IN ('invited','awaiting')",
      [trip.id],
    );
    if ((awaiting?.count ?? 0) > 0) {
      insights.push({
        key: `trip-rsvp-pending:${trip.id}`,
        severity: "info",
        title: `Trip invitations unanswered: ${trip.title}`,
        body: `${awaiting?.count} invited participant(s) have not replied. Ask their guardians rather than assuming they are free.`,
        link: `/holidays?trip=${trip.id}`,
        recipients: [...new Set([trip.created_by, ...parents.map((member) => member.id)])],
      });
    }
  }

  // 5. Upcoming birthdays
  for (const member of members) {
    if (!member.birthday) continue;
    const thisYear = new Date(`${today.slice(0, 4)}-${member.birthday.slice(5, 10)}T00:00:00Z`);
    let birthdayDate = thisYear.toISOString().slice(0, 10);
    if (birthdayDate < today) {
      birthdayDate = new Date(`${Number(today.slice(0, 4)) + 1}-${member.birthday.slice(5, 10)}T00:00:00Z`)
        .toISOString()
        .slice(0, 10);
    }
    const inDays = daysBetween(today, birthdayDate);
    if (inDays <= 14) {
      insights.push({
        key: `birthday:${member.id}:${birthdayDate}`,
        severity: "info",
        title: `Birthday coming up: ${member.name}`,
        body: `${member.name}'s birthday is on ${birthdayDate} (${inDays === 0 ? "today" : `in ${inDays} day(s)`}).`,
        link: "/calendar",
        recipients: [...adults.map((adult) => adult.id)],
      });
    }
  }

  // 6. Tasks due soon or overdue
  for (const task of listTasks(actor, { status: "open" })) {
    if (!task.due_at) continue;
    const dueDay = task.due_at.slice(0, 10);
    if (dueDay > addDaysToDateString(today, 3)) continue;
    const overdue = dueDay < today;
    insights.push({
      key: `task-due:${task.id}:${dueDay}`,
      severity: overdue ? "warning" : "info",
      title: overdue ? `Overdue: ${task.title}` : `Due soon: ${task.title}`,
      body: `${task.assigneeName ? `${task.assigneeName} — ` : ""}${formatDate(task.due_at, actor.locale, actor.householdTimezone)}${overdue ? " (overdue)" : ""}.`,
      link: "/tasks",
      recipients: [...new Set([task.assigned_member_id ?? task.created_by, ...parents.map((member) => member.id)])],
    });
  }

  // 7. Urgent shopping
  for (const item of listShoppingItems(actor).filter((item) => item.priority === "urgent")) {
    insights.push({
      key: `shopping-urgent:${item.id}`,
      severity: "warning",
      title: `Urgent shopping: ${item.name}`,
      body: `${item.name} is marked urgent${item.assigneeName ? ` and assigned to ${item.assigneeName}` : ""}.`,
      link: "/shopping",
      recipients: [...adults.map((member) => member.id)],
    });
  }

  // 8. Public holidays without a plan
  const holidays = upcomingHolidays(actor, today, 30);
  const trips = listTrips(actor);
  for (const holiday of holidays) {
    const planned = trips.some(
      (trip) => trip.starts_at && trip.ends_at && trip.starts_at.slice(0, 10) <= holiday.date && trip.ends_at.slice(0, 10) >= holiday.date,
    );
    if (planned) continue;
    if (holiday.date < today) continue;
    insights.push({
      key: `holiday-plan:${holiday.date}`,
      severity: "info",
      title: `No plan yet for ${holiday.name}`,
      body: `${holiday.name} is on ${holiday.date}. Ask the family about availability before making a plan.`,
      link: "/holidays",
      recipients: parents.map((member) => member.id),
    });
  }

  // 9. Meal plan gaps for the next 3 evenings
  const meals = listMealPlan(actor, today, addDaysToDateString(today, 3)).filter((meal) => meal.meal_type === "dinner");
  for (let index = 0; index < 3; index += 1) {
    const day = addDaysToDateString(today, index);
    if (!meals.some((meal) => meal.date === day)) {
      insights.push({
        key: `meal-gap:${day}`,
        severity: "info",
        title: "No dinner planned",
        body: `There is no dinner planned for ${day}.`,
        link: "/household",
        recipients: parents.map((member) => member.id),
      });
    }
  }

  return insights;
}

export type ProactiveRunResult = {
  householdId: string;
  insights: number;
  notificationsCreated: number;
  remindersSent: number;
  eventRemindersSent: number;
};

function householdAdminActor(householdId: string): Actor | null {
  const admin = get<MemberRow>(
    `SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL AND role = 'parent'
     ORDER BY is_admin DESC, created_at LIMIT 1`,
    [householdId],
  );
  return admin ? actorForMember(admin.id) : null;
}

function notifyInsight(insight: Insight, members: MemberRow[], dateKey: string): number {
  let created = 0;
  for (const memberId of [...new Set(insight.recipients)]) {
    const member = members.find((entry) => entry.id === memberId);
    if (!member) continue;
    if (notifyMember(member, {
      title: insight.title,
      body: insight.body,
      category: insight.severity === "critical" ? "alerts" : "briefing",
      urgency: insight.severity === "critical" ? "high" : insight.severity === "warning" ? "normal" : "low",
      dedupeKey: `insight:${insight.key}:${dateKey}`,
      link: insight.link,
    })) {
      created += 1;
    }
  }
  return created;
}

/** Runs proactive checks for every household. Safe to call from cron or the admin UI. */
export function runProactiveChecks(householdId?: string): ProactiveRunResult[] {
  const households = householdId
    ? [{ id: householdId }]
    : all<{ id: string }>("SELECT id FROM households");
  const results: ProactiveRunResult[] = [];
  for (const household of households) {
    const actor = householdAdminActor(household.id);
    if (!actor) continue;
    const members = all<MemberRow>(
      "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL",
      [household.id],
    );
    const today = dateStringInZone(new Date(), actor.householdTimezone);
    const insights = computeInsights(actor);
    let notificationsCreated = 0;
    for (const insight of insights) {
      notificationsCreated += notifyInsight(insight, members, today);
    }

    let remindersSent = 0;
    const dueReminders = all<{ id: string; member_id: string; title: string; remind_at: string }>(
      "SELECT * FROM reminders WHERE household_id = ? AND status = 'pending' AND remind_at <= ?",
      [household.id, new Date().toISOString()],
    );
    for (const reminder of dueReminders) {
      const member = members.find((entry) => entry.id === reminder.member_id);
      if (member) {
        notifyMember(member, {
          title: `Reminder: ${reminder.title}`,
          body: `Scheduled for ${formatDateTime(reminder.remind_at, member.locale, member.timezone)}.`,
          category: "reminders",
          urgency: "high",
          dedupeKey: `reminder-due:${reminder.id}`,
          link: "/notifications",
        });
      }
      run("UPDATE reminders SET status = 'sent' WHERE id = ?", [reminder.id]);
      remindersSent += 1;
    }

    let eventRemindersSent = 0;
    const now = Date.now();
    const upcoming = all<EventRow>(
      "SELECT * FROM events WHERE household_id = ? AND status = 'confirmed' AND starts_at BETWEEN ? AND ? AND recurrence_rule IS NULL",
      [household.id, new Date(now).toISOString(), new Date(now + 86_400_000).toISOString()],
    );
    for (const event of upcoming) {
      const reminders = JSON.parse(event.reminder_minutes_json || "[]") as number[];
      for (const minutes of reminders.length > 0 ? reminders : [15]) {
        const remindAt = new Date(event.starts_at).getTime() - minutes * 60_000;
        if (remindAt > now || now - remindAt > 3_600_000) continue;
        const participants = all<{ member_id: string }>(
          "SELECT member_id FROM event_participants WHERE event_id = ?",
          [event.id],
        );
        for (const participant of participants) {
          const member = members.find((entry) => entry.id === participant.member_id);
          if (!member) continue;
          if (
            notifyMember(member, {
              title: `Starting soon: ${event.title}`,
              body: `${formatDateTime(event.starts_at, member.locale, member.timezone)}${event.location ? ` at ${event.location}` : ""}.`,
              category: "calendar",
              urgency: "high",
              dedupeKey: `event-reminder:${event.id}:${member.id}:${minutes}`,
              link: "/calendar",
            })
          ) {
            eventRemindersSent += 1;
          }
        }
      }
    }

    recordAudit(actor, "proactive.run", "household", household.id, {
      insights: insights.length,
      notificationsCreated,
      remindersSent,
      eventRemindersSent,
    });
    results.push({
      householdId: household.id,
      insights: insights.length,
      notificationsCreated,
      remindersSent,
      eventRemindersSent,
    });
  }
  return results;
}

export function dailyBriefing(actor: Actor): string {
  const today = dateStringInZone(new Date(), actor.timezone);
  const { start } = isoDayRange(today, actor.timezone);
  const agenda = listAgenda(actor, {
    from: start,
    to: isoDayRange(today, actor.timezone).end,
  });
  const insights = computeInsights(actor).filter(
    (insight) => /pickup|package|conflict|task-due|birthday|holiday/.test(insight.key),
  );
  const parts: string[] = [`Good morning, ${actor.name}!`];
  if (agenda.length === 0) {
    parts.push("There are no events on the visible calendar today.");
  } else {
    parts.push(
      `Today: ${agenda
        .slice(0, 5)
        .map((item) => `${item.title} at ${formatDateTime(item.startsAt, actor.locale, actor.timezone).split(", ").pop()}`)
        .join("; ")}.`,
    );
  }
  if (insights.length > 0) {
    parts.push(`Needs attention: ${insights.slice(0, 4).map((insight) => insight.title).join("; ")}.`);
  }
  return parts.join(" ");
}
