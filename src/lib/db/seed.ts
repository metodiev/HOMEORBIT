import { all, get, getDb, run } from "./index";
import { newId, nowIso, toJson } from "@/lib/util/ids";
import { hashPassword } from "@/lib/auth/password";
import { SAMPLE_WORKFLOWS } from "@/lib/images/samples";
import {
  addDaysToDateString,
  combineDateTime,
  dateStringInZone,
  startOfWeekDateString,
} from "@/lib/util/dates";

/**
 * Seeds a fictional household so the product can be explored immediately.
 * All names, emails and data are invented. Passwords are demo-only.
 */
export function seedDemoData(): { seeded: boolean; householdId: string; summary: string } {
  const existing = get<{ id: string }>("SELECT id FROM households WHERE name = 'Orbit Family' LIMIT 1");
  if (existing) {
    return { seeded: false, householdId: existing.id, summary: "Demo household already exists." };
  }
  const db = getDb();
  const householdId = newId("hsh");
  const now = nowIso();
  const tz = "Europe/Sofia";
  const today = dateStringInZone(new Date(), tz);
  const password = hashPassword("OrbitDemo123!");

  db.transaction(() => {
    run("INSERT INTO households (id, name, timezone, locale, holiday_country, created_at) VALUES (?, 'Orbit Family', ?, 'en', 'BG', ?)", [
      householdId,
      tz,
      now,
    ]);

    const members: {
      id: string;
      name: string;
      email: string | null;
      role: "parent" | "adult" | "teen" | "child" | "relative";
      color: string;
      avatar: string;
      relationship: string;
      birthday: string | null;
      isAdmin: number;
      password: string | null;
    }[] = [
      { id: newId("mem"), name: "Ivan Petrov", email: "ivan@homeorbit.demo", role: "parent", color: "#0f766e", avatar: "🧑", relationship: "Parent", birthday: "1984-04-12", isAdmin: 1, password },
      { id: newId("mem"), name: "Maria Petrova", email: "maria@homeorbit.demo", role: "parent", color: "#b45309", avatar: "👩", relationship: "Parent", birthday: "1986-09-03", isAdmin: 1, password },
      { id: newId("mem"), name: "Alex Petrov", email: "alex@homeorbit.demo", role: "teen", color: "#2563eb", avatar: "🧑‍🎓", relationship: "Son", birthday: "2011-02-17", isAdmin: 0, password },
      { id: newId("mem"), name: "Mia Petrova", email: null, role: "child", color: "#db2777", avatar: "👧", relationship: "Daughter", birthday: "2016-06-21", isAdmin: 0, password: null },
      { id: newId("mem"), name: "Sofia Petrova", email: null, role: "child", color: "#7c3aed", avatar: "🧒", relationship: "Daughter", birthday: "2019-11-08", isAdmin: 0, password: null },
      { id: newId("mem"), name: "Elena Petrova", email: "elena@homeorbit.demo", role: "relative", color: "#64748b", avatar: "👵", relationship: "Grandmother", birthday: "1958-01-30", isAdmin: 0, password },
      { id: newId("mem"), name: "Nikola Dimitrov", email: null, role: "relative", color: "#0891b2", avatar: "🧑", relationship: "Nephew", birthday: "2009-08-14", isAdmin: 0, password: null },
      { id: newId("mem"), name: "Lora Dimitrova", email: null, role: "relative", color: "#c2410c", avatar: "👧", relationship: "Niece", birthday: "2012-12-02", isAdmin: 0, password: null },
    ];

    for (const member of members) {
      run(
        `INSERT INTO members (id, household_id, email, password_hash, name, color, avatar, role, relationship,
          birthday, timezone, locale, is_admin, notification_prefs_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?, ?, ?, ?)`,
        [
          member.id,
          householdId,
          member.email,
          member.password,
          member.name,
          member.color,
          member.avatar,
          member.role,
          member.relationship,
          member.birthday,
          tz,
          member.isAdmin,
          toJson({
            categories: { marketing: false },
            quietHours: { start: "22:00", end: "07:00" },
            dailyBriefing: true,
            weeklySummary: true,
          }),
          now,
          now,
        ],
      );
    }

    const byName = (name: string) => members.find((member) => member.name === name)!;
    const calendar = (name: string, color: string, scope: "shared" | "personal", kind: string, owner?: string) => {
      const id = newId("cal");
      run(
        `INSERT INTO calendars (id, household_id, name, color, scope, owner_member_id, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, householdId, name, color, scope, owner ?? null, kind, now],
      );
      return id;
    };
    const familyCal = calendar("Family", "#0f766e", "shared", "family");
    const schoolCal = calendar("School", "#2563eb", "shared", "school");
    const workCal = calendar("Work & shifts", "#b45309", "shared", "work");
    const sportsCal = calendar("Sports & clubs", "#16a34a", "shared", "sports");
    const medicalCal = calendar("Medical", "#dc2626", "shared", "medical");
    const personalCalendars = new Map<string, string>();
    for (const member of members) {
      personalCalendars.set(
        member.id,
        calendar(`${member.name.split(" ")[0]}'s calendar`, member.color, "personal", "personal", member.id),
      );
    }
    // Grandma shares her calendar with the household so the family can help with appointments.
    run(
      "INSERT OR IGNORE INTO calendar_shares (calendar_id, member_id, access) VALUES (?, ?, 'view')",
      [personalCalendars.get(byName("Elena Petrova").id)!, byName("Ivan Petrov").id],
    );

    const event = (input: {
      calendarId: string;
      createdBy: string;
      title: string;
      day: string;
      startTime: string;
      endTime: string;
      location?: string;
      description?: string;
      participants?: string[];
      visibility?: "household" | "private";
      recurrenceRule?: string | null;
      status?: "confirmed" | "tentative";
      reminderMinutes?: number[];
      allDay?: boolean;
    }) => {
      const startsAt = combineDateTime(input.day, input.startTime, tz).toISOString();
      const endsAt = combineDateTime(input.day, input.endTime, tz).toISOString();
      const id = newId("evt");
      run(
        `INSERT INTO events (id, household_id, calendar_id, created_by, title, description, location, starts_at, ends_at,
          all_day, timezone, visibility, status, recurrence_rule, recurrence_exception_dates_json,
          reminder_minutes_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
        [
          id,
          householdId,
          input.calendarId,
          input.createdBy,
          input.title,
          input.description ?? null,
          input.location ?? null,
          startsAt,
          endsAt,
          input.allDay ? 1 : 0,
          tz,
          input.visibility ?? "household",
          input.status ?? "confirmed",
          input.recurrenceRule ?? null,
          toJson(input.reminderMinutes ?? [15]),
          now,
          now,
        ],
      );
      for (const participantName of input.participants ?? []) {
        run(
          "INSERT INTO event_participants (event_id, member_id, response, is_required) VALUES (?, ?, 'accepted', 1)",
          [id, byName(participantName).id],
        );
      }
      return id;
    };

    const ivan = byName("Ivan Petrov").id;
    const maria = byName("Maria Petrova").id;
    const alex = byName("Alex Petrov").id;
    const mia = byName("Mia Petrova").id;
    const sofia = byName("Sofia Petrova").id;
    const elena = byName("Elena Petrova").id;
    const nikola = byName("Nikola Dimitrov").id;
    const lora = byName("Lora Dimitrova").id;

    event({ calendarId: familyCal, createdBy: maria, title: "Family dinner", day: today, startTime: "19:00", endTime: "20:00", participants: ["Ivan Petrov", "Maria Petrova", "Alex Petrov", "Mia Petrova", "Sofia Petrova"] });
    event({ calendarId: workCal, createdBy: maria, title: "Maria — office shift", day: today, startTime: "09:00", endTime: "17:00", participants: ["Maria Petrova"] });
    event({ calendarId: sportsCal, createdBy: alex, title: "Football practice", day: today, startTime: "17:00", endTime: "18:30", location: "Orbit Sports Hall", participants: ["Alex Petrov"] });
    const dentist = addDaysToDateString(today, 1);
    event({ calendarId: medicalCal, createdBy: ivan, title: "Mia — dentist check-up", day: dentist, startTime: "15:00", endTime: "15:45", location: "Central Dental Clinic", participants: ["Mia Petrova", "Ivan Petrov"], reminderMinutes: [60, 15] });
    event({ calendarId: workCal, createdBy: maria, title: "Maria — late shift", day: dentist, startTime: "16:00", endTime: "21:00", participants: ["Maria Petrova"] });
    // A deliberate clash for Alex on the next school day.
    const clashDay = addDaysToDateString(today, 2);
    event({ calendarId: sportsCal, createdBy: alex, title: "Football practice", day: clashDay, startTime: "17:00", endTime: "18:30", location: "Orbit Sports Hall", participants: ["Alex Petrov"] });
    event({ calendarId: schoolCal, createdBy: maria, title: "Alex — maths tutoring", day: clashDay, startTime: "17:30", endTime: "18:30", location: "Room 12", participants: ["Alex Petrov"] });
    const saturday = addDaysToDateString(startOfWeekDateString(today, 1), 5);
    const outing = event({
      calendarId: familyCal,
      createdBy: ivan,
      title: "Saturday walk in the park",
      day: saturday,
      startTime: "11:00",
      endTime: "13:00",
      location: "Borisova Gradina",
      participants: ["Ivan Petrov", "Maria Petrova", "Alex Petrov", "Mia Petrova", "Sofia Petrova", "Elena Petrova"],
      status: "tentative",
    });
    const schoolEvent = event({
      calendarId: schoolCal,
      createdBy: maria,
      title: "School assembly — parents invited",
      day: addDaysToDateString(today, 4),
      startTime: "08:30",
      endTime: "09:15",
      location: "Main hall",
      participants: ["Maria Petrova"],
    });
    // An invitation that has not been answered yet.
    run(
      "UPDATE event_participants SET response = 'invited' WHERE event_id = ? AND member_id = ?",
      [outing, elena],
    );
    run(
      "UPDATE event_participants SET response = 'invited' WHERE event_id = ? AND member_id = ?",
      [schoolEvent, mia],
    );
    const holidayTripStart = addDaysToDateString(today, 30);
    const holidayTripEnd = addDaysToDateString(today, 33);
    event({
      calendarId: familyCal,
      createdBy: ivan,
      title: "Long weekend in the mountains",
      day: holidayTripStart,
      startTime: "09:00",
      endTime: "18:00",
      description: "Draft plan — waiting for confirmations from the nephews.",
      participants: ["Ivan Petrov", "Maria Petrova", "Alex Petrov", "Mia Petrova", "Sofia Petrova"],
      status: "tentative",
    });
    for (const index of [0, 1, 2, 3, 4]) {
      const day = addDaysToDateString(today, index);
      if ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) continue;
      event({ calendarId: schoolCal, createdBy: maria, title: "Mia — school", day, startTime: "08:15", endTime: "14:30", participants: ["Mia Petrova"] });
      event({ calendarId: schoolCal, createdBy: maria, title: "Sofia — school", day, startTime: "08:15", endTime: "15:10", participants: ["Sofia Petrova"] });
    }
    event({
      calendarId: personalCalendars.get(ivan)!,
      createdBy: ivan,
      title: "Private: anniversary gift research",
      day: addDaysToDateString(today, 3),
      startTime: "20:00",
      endTime: "20:30",
      visibility: "private",
    });

    // School days and school run
    for (let index = 0; index < 10; index += 1) {
      const day = addDaysToDateString(today, index);
      if ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) continue;
      for (const [childId, endTime] of [
        [mia, "14:30"],
        [sofia, "15:10"],
      ] as const) {
        if (
          get<{ id: string }>("SELECT id FROM school_days WHERE member_id = ? AND date = ?", [childId, day])
        ) {
          continue;
        }
        run(
          `INSERT INTO school_days (id, household_id, member_id, date, start_time, end_time, early_dismissal, notes, source)
           VALUES (?, ?, ?, ?, '08:15', ?, 0, NULL, 'seed')`,
          [newId("scd"), householdId, childId, day, endTime],
        );
        const pickupId = newId("pck");
        run(
          `INSERT INTO pickups (id, household_id, member_id, date, direction, time, responsible_member_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pickup', ?, ?, ?, ?, ?)`,
          [
            pickupId,
            householdId,
            childId,
            day,
            endTime,
            index === 0 ? maria : null,
            index === 0 ? "assigned" : "unassigned",
            now,
            now,
          ],
        );
      }
    }

    const task = (title: string, dueDay: string, assignedName: string | null, category: string, priority: "low" | "normal" | "high" | "urgent" = "normal", recurrenceRule?: string) => {
      run(
        `INSERT INTO tasks (id, household_id, title, notes, due_at, priority, status, category, assigned_member_id,
          created_by, recurrence_rule, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
        [
          newId("tsk"),
          householdId,
          title,
          combineDateTime(dueDay, "18:00", tz).toISOString(),
          priority,
          category,
          assignedName ? byName(assignedName).id : null,
          ivan,
          recurrenceRule ?? null,
          now,
          now,
        ],
      );
    };
    task("Take out the recycling", today, "Alex Petrov", "chore", "normal", "FREQ=WEEKLY;BYDAY=TU");
    task("Finish the school science project", addDaysToDateString(today, 3), "Mia Petrova", "school", "high");
    task("Pay the electricity bill", addDaysToDateString(today, 5), "Maria Petrova", "bill", "urgent");
    task("Book the boiler service", addDaysToDateString(today, 9), "Ivan Petrov", "maintenance");
    task("Buy a birthday present for Grandma", addDaysToDateString(today, 12), "Maria Petrova", "general", "high");
    task("Clean the balcony", addDaysToDateString(today, 2), null, "chore");

    const groceries = newId("lst");
    run(
      "INSERT INTO shopping_lists (id, household_id, name, store, created_by, created_at) VALUES (?, ?, 'Groceries', 'Kaufland', ?, ?)",
      [groceries, householdId, ivan, now],
    );
    const pharmacy = newId("lst");
    run(
      "INSERT INTO shopping_lists (id, household_id, name, store, created_by, created_at) VALUES (?, ?, 'Pharmacy & personal care', 'Apteka', ?, ?)",
      [pharmacy, householdId, maria, now],
    );
    const shoppingItem = (listId: string, name: string, quantity: string | null, priority: "low" | "normal" | "high" | "urgent", assignedName?: string) => {
      run(
        `INSERT INTO shopping_items (id, household_id, list_id, name, quantity, brand, category, priority,
          estimated_price, assigned_member_id, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'groceries', ?, NULL, ?, 'open', ?, ?, ?)`,
        [newId("itm"), householdId, listId, name, quantity, priority, assignedName ? byName(assignedName).id : null, ivan, now, now],
      );
    };
    shoppingItem(groceries, "Milk", "2 l", "normal");
    shoppingItem(groceries, "Bread", "1 loaf", "normal");
    shoppingItem(groceries, "Eggs", "10", "normal");
    shoppingItem(groceries, "Dishwasher tablets", "1 pack", "urgent", "Ivan Petrov");
    shoppingItem(pharmacy, "Children's paracetamol", "1 bottle", "high", "Maria Petrova");

    run(
      `INSERT INTO packages (id, household_id, description, merchant, tracking_number, carrier, tracking_url, expected_from,
        expected_to, status, recipient_member_id, collector_member_id, instructions, pickup_point, collection_code,
        deadline, created_by, created_at, updated_at)
       VALUES (?, ?, 'Sofia''s new backpack', 'Orbit Kids', 'BG123456789', 'Speedy', 'https://example.com/track/BG123456789',
        ?, ?, 'out_for_delivery', ?, NULL, 'Ring twice; leave with the neighbour if nobody is home.', NULL, NULL, NULL, ?, ?, ?)`,
      [
        newId("pkg"),
        householdId,
        combineDateTime(today, "09:00", tz).toISOString(),
        combineDateTime(today, "18:00", tz).toISOString(),
        sofia,
        ivan,
        now,
        now,
      ],
    );
    run(
      `INSERT INTO packages (id, household_id, description, merchant, tracking_number, carrier, tracking_url, expected_from,
        expected_to, status, recipient_member_id, collector_member_id, instructions, pickup_point, collection_code,
        deadline, created_by, created_at, updated_at)
       VALUES (?, ?, 'Kitchen scales', 'HomeStore', NULL, NULL, NULL, ?, ?, 'in_transit', ?, ?, 'Collect from the parcel locker.',
        'Locker 24, Mall Center', '8842', ?, ?, ?, ?)`,
      [
        newId("pkg"),
        householdId,
        combineDateTime(addDaysToDateString(today, 1), "10:00", tz).toISOString(),
        combineDateTime(addDaysToDateString(today, 1), "20:00", tz).toISOString(),
        maria,
        ivan,
        combineDateTime(addDaysToDateString(today, 3), "20:00", tz).toISOString(),
        maria,
        now,
        now,
      ],
    );

    run(
      `INSERT INTO calls (id, household_id, direction, contact_name, phone, reason, notes, callback_at, deadline,
        assigned_member_id, status, created_by, created_at, updated_at)
       VALUES (?, ?, 'missed', 'Grandma Elena', '+359 888 000 111', 'Sunday lunch plans', 'She called about Sunday lunch.',
        ?, NULL, ?, 'pending', ?, ?, ?)`,
      [
        newId("cll"),
        householdId,
        combineDateTime(addDaysToDateString(today, 1), "10:00", tz).toISOString(),
        ivan,
        ivan,
        now,
        now,
      ],
    );

    const note = (title: string, body: string, visibility: "household" | "private" | "restricted", category: string, sensitive: boolean, ownerId: string) => {
      run(
        `INSERT INTO notes (id, household_id, title, body, visibility, owner_member_id, category, sensitive,
          attachments_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
        [newId("not"), householdId, title, body, visibility, ownerId, category, sensitive ? 1 : 0, now, now],
      );
    };
    note("Wi-Fi network", "Network: OrbitHome\nPassword: sunflower-42", "household", "instruction", false, ivan);
    note("Emergency contacts", "Doctor: Dr. Petrova +359 2 555 0100\nPoison control: 112\nSchool office: +359 2 555 0199", "restricted", "emergency", true, maria);
    note("Dishwasher warranty", "Bosch SMS46 — purchased 2024, warranty until 2029. Manual in the kitchen drawer.", "household", "appliance", false, maria);
    note("Spare house key", "The spare house key is held by Grandma Elena.", "household", "general", false, ivan);
    note("Sofia's allergy note", "Sofia is allergic to peanuts. Keep emergency antihistamine in the hallway cabinet.", "restricted", "emergency", true, maria);
    note("Alex's school portal", "Portal: school.example.bg — login stored in the family password manager.", "household", "school", true, ivan);
    run(
      "INSERT INTO note_shares (note_id, member_id) SELECT id, ? FROM notes WHERE household_id = ? AND title = 'Emergency contacts'",
      [alex, householdId],
    );

    const recipe = (title: string, ingredients: { name: string; quantity?: string; unit?: string }[], instructions: string, tags: string) => {
      const id = newId("rcp");
      run(
        `INSERT INTO recipes (id, household_id, title, ingredients_json, instructions, tags, servings, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 4, ?, ?)`,
        [id, householdId, title, toJson(ingredients), instructions, tags, maria, now],
      );
      return id;
    };
    const musaka = recipe(
      "Musaka",
      [
        { name: "Potatoes", quantity: "1", unit: "kg" },
        { name: "Minced meat", quantity: "500", unit: "g" },
        { name: "Onions", quantity: "2" },
        { name: "Yogurt", quantity: "400", unit: "g" },
        { name: "Eggs", quantity: "3" },
      ],
      "Layer potatoes and mince, bake, then top with the yogurt-egg mixture.",
      "bulgarian,dinner",
    );
    const pasta = recipe(
      "Tomato pasta",
      [
        { name: "Pasta", quantity: "500", unit: "g" },
        { name: "Tomatoes", quantity: "6" },
        { name: "Garlic", quantity: "3", unit: "cloves" },
        { name: "Basil", quantity: "1", unit: "bunch" },
      ],
      "Simmer tomatoes with garlic, toss with pasta and basil.",
      "vegetarian,quick",
    );
    const soup = recipe(
      "Chicken soup",
      [
        { name: "Chicken", quantity: "1", unit: "kg" },
        { name: "Carrots", quantity: "3" },
        { name: "Celery", quantity: "1", unit: "head" },
        { name: "Noodles", quantity: "100", unit: "g" },
      ],
      "Boil the chicken, add vegetables, finish with noodles.",
      "comfort",
    );
    recipe(
      "Pancakes",
      [
        { name: "Flour", quantity: "300", unit: "g" },
        { name: "Milk", quantity: "500", unit: "ml" },
        { name: "Eggs", quantity: "2" },
      ],
      "Whisk and fry on a hot pan.",
      "breakfast",
    );
    run(
      `INSERT INTO meal_plan (id, household_id, date, meal_type, title, recipe_id, notes, created_by, created_at)
       VALUES (?, ?, ?, 'dinner', 'Musaka', ?, NULL, ?, ?)`,
      [newId("mel"), householdId, addDaysToDateString(today, 1), musaka, maria, now],
    );
    run(
      `INSERT INTO meal_plan (id, household_id, date, meal_type, title, recipe_id, notes, created_by, created_at)
       VALUES (?, ?, ?, 'dinner', 'Tomato pasta', ?, NULL, ?, ?)`,
      [newId("mel"), householdId, addDaysToDateString(today, 2), pasta, maria, now],
    );
    run(
      `INSERT INTO meal_plan (id, household_id, date, meal_type, title, recipe_id, notes, created_by, created_at)
       VALUES (?, ?, ?, 'dinner', 'Chicken soup', ?, NULL, ?, ?)`,
      [newId("mel"), householdId, addDaysToDateString(today, 3), soup, maria, now],
    );

    run(
      `INSERT INTO inventory_items (id, household_id, name, category, quantity, unit, min_stock, updated_at)
       VALUES (?, ?, 'Dishwasher tablets', 'household', 1, 'pack', 2, ?)`,
      [newId("inv"), householdId, now],
    );
    run(
      `INSERT INTO inventory_items (id, household_id, name, category, quantity, unit, min_stock, updated_at)
       VALUES (?, ?, 'Olive oil', 'groceries', 2, 'bottles', 1, ?)`,
      [newId("inv"), householdId, now],
    );

    const tripId = newId("trp");
    run(
      `INSERT INTO trips (id, household_id, title, destination, starts_at, ends_at, notes, budget, status, created_by,
        created_at, updated_at)
       VALUES (?, ?, 'Long weekend in the mountains', 'Vitosha', ?, ?, 'Draft plan, waiting for the nephews to reply.',
        900, 'planning', ?, ?, ?)`,
      [
        tripId,
        householdId,
        combineDateTime(holidayTripStart, "09:00", tz).toISOString(),
        combineDateTime(holidayTripEnd, "18:00", tz).toISOString(),
        ivan,
        now,
        now,
      ],
    );
    const rsvp = (memberId: string | null, guestName: string | null, response: "invited" | "accepted" | "declined" | "tentative" | "awaiting") => {
      run(
        `INSERT INTO trip_rsvps (id, household_id, trip_id, member_id, guest_name, response, responded_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId("rsv"), householdId, tripId, memberId, guestName, response, response === "awaiting" ? null : now, now],
      );
    };
    rsvp(ivan, null, "accepted");
    rsvp(maria, null, "accepted");
    rsvp(alex, null, "tentative");
    rsvp(mia, null, "accepted");
    rsvp(sofia, null, "accepted");
    rsvp(nikola, "Nikola Dimitrov", "awaiting");
    rsvp(lora, "Lora Dimitrova", "awaiting");
    rsvp(elena, null, "invited");

    const pollId = newId("pol");
    run(
      `INSERT INTO polls (id, household_id, trip_id, question, kind, status, closes_at, created_by, created_at)
       VALUES (?, ?, ?, 'Where should we go for the long weekend?', 'destination', 'open', ?, ?, ?)`,
      [pollId, householdId, tripId, combineDateTime(addDaysToDateString(today, 7), "20:00", tz).toISOString(), ivan, now],
    );
    for (const label of ["Vitosha mountain hut", "Rila lakes", "A spa hotel near Sofia"]) {
      run("INSERT INTO poll_options (id, poll_id, label, starts_at, ends_at) VALUES (?, ?, ?, NULL, NULL)", [
        newId("pop"),
        pollId,
        label,
      ]);
    }
    const options = all<{ id: string }>("SELECT id FROM poll_options WHERE poll_id = ? ORDER BY rowid", [pollId]);
    run("INSERT INTO poll_votes (poll_id, option_id, member_id, created_at) VALUES (?, ?, ?, ?)", [
      pollId,
      options[1].id,
      ivan,
      now,
    ]);
    run("INSERT INTO poll_votes (poll_id, option_id, member_id, created_at) VALUES (?, ?, ?, ?)", [
      pollId,
      options[1].id,
      maria,
      now,
    ]);
    run("INSERT INTO poll_votes (poll_id, option_id, member_id, created_at) VALUES (?, ?, ?, ?)", [
      pollId,
      options[0].id,
      alex,
      now,
    ]);

    for (const [kind, display] of [
      ["google_calendar", "Google Calendar"],
      ["outlook_calendar", "Microsoft Outlook"],
      ["icloud_calendar", "Apple / iCloud Calendar"],
      ["email_import", "Authorised email import"],
      ["push", "Web push notifications"],
      ["telegram", "Telegram"],
      ["whatsapp", "WhatsApp Business"],
      ["carrier_tracking", "Carrier tracking"],
    ]) {
      run(
        "INSERT OR IGNORE INTO integrations (id, household_id, kind, status, display_name, config_json, created_at) VALUES (?, ?, ?, 'disabled', ?, '{}', ?)",
        [newId("int"), householdId, kind, display, now],
      );
    }

    const aiProfiles = [
      {
        id: ivan,
        persona: "Warm, practical family organiser. Prefer concise answers, Bulgarian or English, and concrete next steps.",
        interests: ["Cycling", "Bulgarian history", "Home automation", "Cooking"],
        preferences: { tone: "warm", detail: "balanced", humor: "dry", language: "auto" },
        share: 1,
        movies: { genres: [35, 18], avoidGenres: [27], languages: ["bg", "en"], favoriteServices: [] },
      },
      {
        id: maria,
        persona: "Thoughtful planner who likes gentle, detailed suggestions for family activities and reading.",
        interests: ["Gardening", "Film photography", "Contemporary fiction", "Weekend walks"],
        preferences: { tone: "warm", detail: "thorough", humor: "light", language: "auto" },
        share: 1,
        movies: { genres: [18, 10749], avoidGenres: [28], languages: ["bg", "en"], favoriteServices: [] },
      },
      {
        id: alex,
        persona: "Helpful study and hobby assistant. Keep answers focused and explain technical things clearly.",
        interests: ["Basketball", "Gaming", "Mathematics", "Science fiction"],
        preferences: { tone: "concise", detail: "balanced", humor: "light", language: "auto" },
        share: 0,
        movies: { genres: [878, 28], avoidGenres: [], languages: ["en", "bg"], favoriteServices: [] },
      },
    ];
    for (const profile of aiProfiles) {
      run(
        `UPDATE members SET persona = ?, interests_json = ?, ai_preferences_json = ?, share_family_knowledge = ?,
         movie_preferences_json = ?, updated_at = ? WHERE id = ?`,
        [
          profile.persona,
          JSON.stringify(profile.interests),
          JSON.stringify(profile.preferences),
          profile.share,
          JSON.stringify(profile.movies),
          now,
          profile.id,
        ],
      );
    }

    const memories = [
      { member: ivan, scope: "private", category: "preferences", content: "I prefer practical suggestions I can act on today, and I dislike overly long answers.", tags: ["style"] },
      { member: ivan, scope: "private", category: "hobbies", content: "I enjoy weekend cycling routes around Vitosha and often plan them on Saturday mornings.", tags: ["cycling", "weekend"] },
      { member: ivan, scope: "family", category: "household", content: "The family usually has dinner together at 19:00 on weekdays; Thursday is the busiest evening.", tags: ["routine"] },
      { member: maria, scope: "private", category: "preferences", content: "I like detailed film recommendations with a short reason and where the film is available.", tags: ["movies"] },
      { member: maria, scope: "private", category: "hobbies", content: "I am learning film photography and prefer local shops for developing negatives.", tags: ["photography"] },
      { member: maria, scope: "family", category: "family", content: "Family movie night is usually Friday, and we prefer films that the children can watch too.", tags: ["movies", "routine"] },
      { member: alex, scope: "private", category: "study", content: "I am preparing for a maths exam and prefer short explanations followed by practice questions.", tags: ["school"] },
    ];
    for (const memory of memories) {
      run(
        `INSERT INTO member_memories (id, household_id, member_id, scope, category, content, tags_json, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'explicit', ?, ?)`,
        [
          newId("mem"),
          householdId,
          memory.member,
          memory.scope,
          memory.category,
          memory.content,
          JSON.stringify(memory.tags),
          now,
          now,
        ],
      );
    }

    for (const sample of SAMPLE_WORKFLOWS) {
      run(
        `INSERT INTO image_workflows (id, household_id, name, provider, operation, workflow_json, model_label, description,
          enabled, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'comfyui', ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          newId("wfl"),
          householdId,
          sample.name,
          sample.operation,
          JSON.stringify(sample.workflow),
          sample.modelLabel,
          `${sample.description} Disabled until the model files are installed and COMFYUI_CHECKPOINT is configured.`,
          ivan,
          now,
          now,
        ],
      );
    }

    recordSeedAudit(householdId, ivan);
  })();

  return {
    seeded: true,
    householdId,
    summary:
      "Seeded Orbit Family with 8 members (6 household + 2 invited relatives), calendars, events (including a deliberate clash), school runs, tasks, shopping, packages, notes, meals, a holiday plan with unanswered invitations, AI profiles, private/shared memories and disabled ComfyUI sample workflows.",
  };
}

function recordSeedAudit(householdId: string, actorId: string): void {
  run(
    "INSERT INTO audit_log (id, household_id, actor_member_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (?, ?, ?, 'seed.demo', 'household', ?, '{}', ?)",
    [newId("aud"), householdId, actorId, householdId, nowIso()],
  );
}
