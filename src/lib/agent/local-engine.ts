import { all } from "@/lib/db";
import type { MemberRow, TripRsvpRow } from "@/lib/db/rows";
import type { Actor } from "@/lib/auth/actor";
import { executeTool, type ToolOutcome } from "./tools";
import {
  addDaysToDateString,
  combineDateTime,
  dateStringInZone,
  formatDate,
  formatDateTime,
  formatTime,
  startOfDayUtc,
} from "@/lib/util/dates";
import { listTrips } from "@/lib/domain/trips";

export type LocalToolRun = { name: string; outcome: ToolOutcome };
export type LocalAgentResult = { reply: string; tools: LocalToolRun[] };

const WEEKDAYS: { names: string[]; index: number }[] = [
  { names: ["sunday", "sun", "неделя"], index: 0 },
  { names: ["monday", "mon", "понеделник"], index: 1 },
  { names: ["tuesday", "tue", "tues", "вторник"], index: 2 },
  { names: ["wednesday", "wed", "сряда"], index: 3 },
  { names: ["thursday", "thu", "thur", "thurs", "четвъртък"], index: 4 },
  { names: ["friday", "fri", "петък"], index: 5 },
  { names: ["saturday", "sat", "събота"], index: 6 },
];

function today(actor: Actor): string {
  return dateStringInZone(new Date(), actor.timezone);
}

function parseDay(text: string, actor: Actor): string | null {
  const lower = text.toLowerCase();
  const base = today(actor);
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(lower);
  if (iso) return iso[1];
  if (/\b(day after tomorrow)\b/.test(lower)) return addDaysToDateString(base, 2);
  if (/\b(tomorrow|утре)\b/.test(lower)) return addDaysToDateString(base, 1);
  if (/\b(today|днес|tonight|тази вечер)\b/.test(lower)) return base;
  const inDays = /\bin (\d{1,2}) days?\b/.exec(lower);
  if (inDays) return addDaysToDateString(base, Number(inDays[1]));
  if (/\bnext week\b/.test(lower)) return addDaysToDateString(base, 7);
  if (/\b(this|next)? ?weekend\b/.test(lower)) {
    const weekday = new Date(`${base}T12:00:00Z`).getUTCDay();
    const delta = (6 - weekday + 7) % 7 || 7;
    return addDaysToDateString(base, delta);
  }
  for (const weekday of WEEKDAYS) {
    if (weekday.names.some((name) => new RegExp(`\\b${name}\\b`).test(lower))) {
      const current = new Date(`${base}T12:00:00Z`).getUTCDay();
      let delta = (weekday.index - current + 7) % 7;
      if (delta === 0) delta = 7;
      return addDaysToDateString(base, delta);
    }
  }
  return null;
}

function parseTime(text: string): string | null {
  const explicit = /\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (explicit) {
    let hour = Number(explicit[1]);
    const minute = Number(explicit[2] ?? "0");
    const suffix = explicit[3]?.toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) {
      return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
    }
  }
  const bare = /\b(\d{1,2}):(\d{2})\b/.exec(text);
  if (bare) {
    const hour = Number(bare[1]);
    const minute = Number(bare[2]);
    if (hour <= 23 && minute <= 59) {
      return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
    }
  }
  return null;
}

function isoAt(day: string, time: string, actor: Actor): string {
  return combineDateTime(day, time, actor.timezone).toISOString();
}

function activeMembers(actor: Actor): MemberRow[] {
  return all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
    [actor.householdId],
  );
}

function mentionedMembers(actor: Actor, text: string): MemberRow[] {
  const lower = text.toLowerCase();
  return activeMembers(actor).filter((member) => {
    const name = member.name.toLowerCase();
    const first = name.split(" ")[0];
    return lower.includes(name) || (first.length > 2 && lower.includes(first));
  });
}

function bullet(lines: string[]): string {
  return lines.map((line) => `• ${line}`).join("\n");
}

function slotsText(data: unknown, actor: Actor): string {
  const slots = (data as { slots?: { startsAt: string; endsAt?: string }[] } | undefined)?.slots ?? [];
  if (slots.length === 0) return "";
  return bullet(
    slots.map((slot) => {
      const endsAt = slot.endsAt ?? new Date(new Date(slot.startsAt).getTime() + 3_600_000).toISOString();
      return `${formatDate(slot.startsAt, actor.locale, actor.timezone)} ${formatTime(slot.startsAt, actor.locale, actor.timezone)}–${formatTime(endsAt, actor.locale, actor.timezone)}`;
    }),
  );
}

function agendaText(data: unknown, actor: Actor): string {
  const items = (data as { items?: Record<string, unknown>[] } | undefined)?.items ?? [];
  if (items.length === 0) return "Nothing is on the visible calendar for that period.";
  return bullet(
    items.map((item) => {
      const startsAt = String(item.startsAt);
      const title = String(item.title);
      const location = item.location ? ` — ${item.location}` : "";
      const status = item.status === "tentative" ? " [tentative]" : "";
      const participants = Array.isArray(item.participants) && item.participants.length > 0
        ? ` (${(item.participants as { name: string; response: string }[])
            .map((p) => (p.response === "accepted" ? p.name : `${p.name} — ${p.response}`))
            .join(", ")})`
        : "";
      return `${formatDate(startsAt, actor.locale, actor.timezone)} ${formatTime(startsAt, actor.locale, actor.timezone)}: ${title}${status}${location}${participants}`;
    }),
  );
}

function outcomeText(outcome: ToolOutcome): string {
  if (outcome.requiresApproval) {
    return `I prepared this but did not carry it out: ${outcome.summary} You can review it in Approvals.`;
  }
  if (!outcome.ok) return outcome.summary || outcome.error || "That action failed.";
  return outcome.summary;
}

function helpText(actor: Actor): string {
  return [
    "I can work with your family's real data. Try:",
    bullet([
      "“What is planned tomorrow?”",
      "“Who is free on Saturday for two hours?”",
      "“Add milk and bread to the shopping list.”",
      "“Remind me to call the school tomorrow at 9.”",
      "“Are the nephews coming on the holiday?”",
      "“Summarize our week.”",
      "“Draw a cosy reading nook with autumn light.”",
      "“Edit the beach photo to remove the bin.”",
      "“What do you remember about my hobbies?”",
      "“Recommend a movie for me.” / “Family movie night”",
      "“Find photos from last Saturday tagged birthday.”",
      "“Search the web for the museum opening times.”",
    ]),
    actor.role === "child"
      ? "Your account can see shared family information and add shopping items or tasks for yourself."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runLocalAgent(
  actor: Actor,
  message: string,
  options: { conversationId?: string | null; providerError?: string } = {},
): Promise<LocalAgentResult> {
  const tools: LocalToolRun[] = [];
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> => {
    const outcome = await executeTool(actor, name, args, { conversationId: options.conversationId });
    tools.push({ name, outcome });
    return outcome;
  };
  const lower = message.toLowerCase().trim();
  const prefix = options.providerError
    ? `The AI provider could not complete that reply, so I used the built-in assistant. (${options.providerError})\n\n`
    : "";

  if (!lower) return { reply: prefix + helpText(actor), tools };

  // Image generation and editing (local ComfyUI queue)
  if (/\b(image|picture|illustration|photo)\b/.test(lower) && /\b(job|jobs|status|progress|queue)\b/.test(lower)) {
    const outcome = await call("list_image_jobs", { limit: 5 });
    const jobs = (outcome.data as { jobs?: { jobId: string; status: string; progress: number; operation: string; error: string | null }[] } | undefined)?.jobs ?? [];
    if (jobs.length === 0) return { reply: prefix + outcomeText(outcome), tools };
    return {
      reply:
        prefix +
        bullet(
          jobs.map(
            (job) =>
              `${job.operation.replace(/_/g, " ")} — ${job.status} ${job.progress}%${job.error ? ` (${job.error})` : ""} [${job.jobId}]`,
          ),
        ),
      tools,
    };
  }

  if (/\b(draw|paint)\b/.test(lower) || (/\b(generate|create|make)\b/.test(lower) && /\b(image|picture|illustration|artwork)\b/.test(lower))) {
    const prompt = message
      .replace(/^(please\s+)?(generate|create|draw|make)\s+(me\s+)?(an?|some)\s+(image|picture|illustration|artwork|art)(\s+of)?\s*/i, "")
      .replace(/^(please\s+)?(draw|paint|generate|create|make)\s+/i, "")
      .trim();
    const outcome = await call("generate_image", { prompt: prompt || message });
    return { reply: prefix + outcomeText(outcome), tools };
  }

  if (/\b(edit|change|remove|replace|restore|upscale|enhance)\b/.test(lower) && /\b(photo|image|picture)\b/.test(lower)) {
    const descriptor = /\b(?:the|my|this)?\s*([\p{L}\d' -]{2,40}?)\s+(?:photo|image|picture)\b/iu.exec(message)?.[1]?.trim();
    let imageId: string | undefined;
    if (!descriptor) {
      const listed = await call("list_images", { limit: 2 });
      const images = (listed.data as { images?: { assetId: string; caption: string | null }[] } | undefined)?.images ?? [];
      if (images.length !== 1) {
        return {
          reply:
            prefix +
            "Tell me which image to edit by describing it (for example “edit the beach photo”) or open Image Studio to pick one.",
          tools,
        };
      }
      imageId = images[0].assetId;
    }
    const operation = /\bremove\b/.test(lower)
      ? "remove_object"
      : /\bbackground\b/.test(lower)
        ? "background_replace"
        : /\bupscal|enhance|enlarge\b/.test(lower)
          ? "upscale"
          : /\brestor|old|damaged\b/.test(lower)
            ? "restore"
            : "image_to_image";
    const outcome = await call("edit_image", {
      prompt: message,
      operation,
      ...(imageId ? { imageId } : { imageQuery: descriptor }),
    });
    return { reply: prefix + outcomeText(outcome), tools };
  }

  // Personal long-term memories
  if (/^(what do you remember|what have you remembered|list (my )?memories|show (my )?memories)\b/.test(lower)) {
    const outcome = await call("list_memories", { scope: "all" });
    const memories = (outcome.data as { memories?: { content: string; scope: string }[] } | undefined)?.memories ?? [];
    if (memories.length === 0) return { reply: prefix + "I do not have any saved memories for you yet.", tools };
    return {
      reply: prefix + bullet(memories.slice(0, 20).map((memory) => `${memory.scope === "family" ? "[family] " : ""}${memory.content}`)),
      tools,
    };
  }

  if (/\bforget\b/.test(lower) && /\b(memory|that|this)\b/.test(lower)) {
    const query = message.replace(/^.*?\bforget\b/i, "").replace(/\b(memory|that|this)\b/gi, "").trim();
    const listed = await call("list_memories", { scope: "private", query: query || undefined });
    const memories = (listed.data as { memories?: { memoryId: string; content: string }[] } | undefined)?.memories ?? [];
    if (memories.length === 0) return { reply: prefix + "I could not find a private memory matching that.", tools };
    if (memories.length > 1) {
      return {
        reply:
          prefix +
          `I found ${memories.length} memories. Open Settings → AI profile to delete the exact one, or be more specific:\n${bullet(memories.slice(0, 5).map((memory) => memory.content))}`,
        tools,
      };
    }
    const outcome = await call("delete_memory", { memoryId: memories[0].memoryId });
    return { reply: prefix + outcomeText(outcome), tools };
  }

  if (/\bremember (that|this|my|i|i'm|i am|we|our)\b/.test(lower) || /\bsave (this|that) to (my )?memory\b/.test(lower)) {
    const body = message
      .replace(/^.*?\bremember (that|this|my|i'm|i am|i|we|our)\b/i, "")
      .replace(/^.*?\bsave (this|that) to (my )?memory\b/i, "")
      .trim();
    if (!body) return { reply: prefix + "What should I remember?", tools };
    const outcome = await call("save_memory", { content: body, scope: "private" });
    return { reply: prefix + outcomeText(outcome), tools };
  }

  // Movies (real TMDB data only)
  if (/\bfamily movie night\b/.test(lower)) {
    const outcome = await call("recommend_movies", { mode: "family", limit: 8 });
    const data = outcome.data as { recommendations?: { title: string; year: number | null; overview: string }[] } | undefined;
    const titles = data?.recommendations ?? [];
    if (titles.length === 0) return { reply: prefix + outcomeText(outcome), tools };
    return {
      reply:
        prefix +
        bullet(titles.map((movie) => `${movie.title}${movie.year ? ` (${movie.year})` : ""} — ${movie.overview.slice(0, 140)}`)) +
        `\n\n${outcome.summary}`,
      tools,
    };
  }

  if (/\b(recommend|suggest)\b/.test(lower) && /\b(movie|film|watch)\b/.test(lower)) {
    const outcome = await call("recommend_movies", { mode: "personal", limit: 8 });
    const data = outcome.data as { recommendations?: { title: string; year: number | null; overview: string }[] } | undefined;
    const titles = data?.recommendations ?? [];
    if (titles.length === 0) return { reply: prefix + outcomeText(outcome), tools };
    return {
      reply:
        prefix +
        bullet(titles.map((movie) => `${movie.title}${movie.year ? ` (${movie.year})` : ""} — ${movie.overview.slice(0, 140)}`)) +
        `\n\n${outcome.summary}`,
      tools,
    };
  }

  if (/\b(watchlist|watched movies|my movies)\b/.test(lower)) {
    const outcome = await call("list_movies", {});
    const entries = (outcome.data as { entries?: { title: string; year: number | null; status: string; rating: number | null }[] } | undefined)?.entries ?? [];
    if (entries.length === 0) return { reply: prefix + "Your movie list is empty.", tools };
    return {
      reply: prefix + bullet(entries.map((entry) => `${entry.title}${entry.year ? ` (${entry.year})` : ""} — ${entry.status}${entry.rating ? `, ${entry.rating}/10` : ""}`)),
      tools,
    };
  }

  if (/\b(movie|film)\b/.test(lower) && /\b(search|find|look up|called|about)\b/.test(lower)) {
    const query = message.replace(/^.*?\b(search|find|look up)\b/i, "").replace(/\b(movie|film)\b/gi, "").replace(/\b(called|about)\b/gi, "").trim();
    if (!query) return { reply: prefix + "Which movie should I look up?", tools };
    const outcome = await call("search_movies", { query });
    const results = (outcome.data as { results?: { id: number; title: string; year: number | null; overview: string }[] } | undefined)?.results ?? [];
    if (results.length === 0) return { reply: prefix + outcomeText(outcome), tools };
    return {
      reply:
        prefix +
        bullet(results.map((movie) => `${movie.title}${movie.year ? ` (${movie.year})` : ""} [TMDB ${movie.id}] — ${movie.overview.slice(0, 140)}`)) +
        `\n\n${outcome.summary}`,
      tools,
    };
  }

  // Photo library (visibility-filtered, no people identification)
  if (/\bdescribe\b/.test(lower) && /\b(photo|picture|image)\b/.test(lower)) {
    const descriptor = /\b(?:the|my|this)?\s*([\p{L}\d' -]{2,40}?)\s+(?:photo|picture|image)\b/iu.exec(message)?.[1]?.trim();
    const listed = await call("list_images", { library: "photos", query: descriptor || undefined, limit: 2 });
    const images = (listed.data as { images?: { assetId: string }[] } | undefined)?.images ?? [];
    if (images.length !== 1) {
      return { reply: prefix + "I need one specific photo. Describe it more precisely or open the photo library.", tools };
    }
    const outcome = await call("describe_photo", { imageId: images[0].assetId });
    return { reply: prefix + outcomeText(outcome), tools };
  }

  if (/\b(photos?|pictures?)\b/.test(lower) && /\b(find|search|show|from|tagged)\b/.test(lower)) {
    const query = message
      .replace(/^.*?\b(find|search( for)?|show( me)?)\b/i, "")
      .replace(/\b(photos?|pictures?)\b/gi, "")
      .replace(/\b(from|tagged|with)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const outcome = await call("search_photos", {
      query: query || undefined,
      dateFrom: parseDay(lower, actor) ?? undefined,
    });
    const photos = (outcome.data as { photos?: { assetId: string; caption: string | null; description: string | null; createdAt: string }[] } | undefined)?.photos ?? [];
    if (photos.length === 0) return { reply: prefix + outcomeText(outcome), tools };
    return {
      reply:
        prefix +
        bullet(photos.slice(0, 12).map((photo) => `${photo.caption ?? photo.description ?? "Photo"} — ${formatDate(photo.createdAt, actor.locale, actor.timezone)} [${photo.assetId}]`)),
      tools,
    };
  }

  // Authorized web research (explicitly external)
  if (/\b(search (the )?(web|internet)|google|look up online)\b/.test(lower)) {
    const query = message.replace(/^.*?\b(search (the )?(web|internet)( for)?|google|look up online)\b/i, "").trim();
    if (!query) return { reply: prefix + "What should I search the web for?", tools };
    const outcome = await call("web_search", { query });
    const results = (outcome.data as { results?: { title: string; url: string; snippet: string }[] } | undefined)?.results ?? [];
    if (results.length === 0) return { reply: prefix + outcomeText(outcome), tools };
    return {
      reply:
        prefix +
        `External web results (untrusted):\n${bullet(results.map((result) => `${result.title} — ${result.url}\n${result.snippet}`))}`,
      tools,
    };
  }

  const explicitUrl = /\bhttps?:\/\/\S+\b/.exec(message)?.[0];
  if (explicitUrl && /\b(open|read|fetch|summarize|summarise)\b/.test(lower)) {
    const outcome = await call("fetch_web_page", { url: explicitUrl.replace(/[),.]+$/, "") });
    const page = outcome.data as { title?: string; text?: string; url?: string } | undefined;
    if (!outcome.ok || !page?.text) return { reply: prefix + outcomeText(outcome), tools };
    return {
      reply: `${prefix}External page (untrusted): ${page.title} — ${page.url}\n\n${page.text.slice(0, 4000)}`,
      tools,
    };
  }

  // Weekly briefing / summary
  if (/\b(summar\w*|brief\w*|overview of (the )?week|what('s| is) happening this week)\b/.test(lower)) {
    const outcome = await call("summarize_family_week", { dateFrom: parseDay(lower, actor) ?? today(actor) });
    const data = outcome.data as
      | {
          agenda?: unknown[];
          conflicts?: unknown[];
          tasks?: { title: string; dueAt: string | null; assignee: string | null }[];
          packages?: { description: string; deadline: string | null }[];
          missingPickupArrangements?: { childName: string; date: string; time: string }[];
          holidays?: { date: string; name: string }[];
        }
      | undefined;
    const lines: string[] = [];
    if (data) {
      lines.push(`Here is the week starting ${formatDate(startOfDayUtc(parseDay(lower, actor) ?? today(actor), actor.timezone), actor.locale, actor.timezone)}:`);
      lines.push(`Events: ${data.agenda?.length ?? 0}, conflicts: ${data.conflicts?.length ?? 0}, open tasks due: ${data.tasks?.length ?? 0}.`);
      if ((data.conflicts?.length ?? 0) > 0) lines.push("There are scheduling clashes — ask me to list them.");
      if ((data.tasks?.length ?? 0) > 0) {
        lines.push(
          bullet(
            data.tasks!.slice(0, 5).map((task) => `${task.title}${task.assignee ? ` (${task.assignee})` : ""}`),
          ),
        );
      }
      if ((data.missingPickupArrangements?.length ?? 0) > 0) {
        lines.push(
          bullet(
            data.missingPickupArrangements!.map(
              (item) => `Pickup missing: ${item.childName}, ${item.date} at ${item.time}`,
            ),
          ),
        );
      }
      if ((data.holidays?.length ?? 0) > 0) {
        lines.push(bullet(data.holidays!.map((holiday) => `${holiday.date}: ${holiday.name}`)));
      }
    }
    return { reply: prefix + lines.join("\n") + "\n\n" + outcomeText(outcome), tools };
  }

  // Conflicts
  if (/\b(conflict|clash|overlap|double[- ]?book)/.test(lower)) {
    const day = parseDay(lower, actor) ?? today(actor);
    const outcome = await call("detect_schedule_conflicts", {
      dateFrom: day,
      dateTo: addDaysToDateString(day, 14),
      memberNames: mentionedMembers(actor, message).map((member) => member.name),
    });
    const conflicts = (outcome.data as { member: string; first: string; second: string; localDate: string }[] | undefined) ?? [];
    const reply =
      conflicts.length === 0
        ? "I found no overlapping events in the visible calendars."
        : `I found ${conflicts.length} conflict(s):\n` +
          bullet(
            conflicts.map(
              (conflict) => `${conflict.member} — ${conflict.first} overlaps ${conflict.second} on ${conflict.localDate}`,
            ),
          );
    return { reply: prefix + reply + "\n\n" + outcomeText(outcome), tools };
  }

  // Availability
  if (/\b(free|available|find a time|when can|slot|all six|everyone)\b/.test(lower)) {
    const mentioned = mentionedMembers(actor, message);
    const relatives = mentioned.filter((member) => member.role === "relative");
    if (relatives.length > 0 || /\b(nephew|niece|grandma|grandparent|relative|cousin)/.test(lower)) {
      const trip = listTrips(actor)[0];
      const rsvpText = trip
        ? `Current invitation responses for “${trip.title}”: ${Object.entries(trip.rsvpSummary)
            .map(([key, value]) => `${key} ${value}`)
            .join(", ")}.`
        : "There is no holiday plan with invitations yet.";
      const who = relatives.length > 0 ? relatives.map((member) => member.name).join(", ") : "your relatives";
      return {
        reply:
          prefix +
          `I can't assume ${who} are free — an empty calendar is not a confirmation. ${rsvpText}\n\n` +
          "I can create a holiday plan and send invitations, then track who actually replies.",
        tools,
      };
    }
    const members = mentioned;
    const all_ = members.length === 0;
    const day = parseDay(lower, actor) ?? today(actor);
    const durationMatch = /\b(\d{1,2})\s*(hour|hours|h)\b/.exec(lower);
    const durationMinutes = durationMatch
      ? Number(durationMatch[1]) * 60
      : /\b(dinner|lunch|meal|outing|movie|visit)\b/.test(lower)
        ? 90
        : 60;
    const outcome = await call("check_member_availability", {
      memberNames: all_ ? undefined : members.map((member) => member.name),
      dateFrom: day,
      dateTo: addDaysToDateString(day, /\bholiday|weekend|trip\b/.test(lower) ? 30 : 14),
      durationMinutes,
    });
    const data = outcome.data as { consideredMembers?: string[]; slots?: unknown[] } | undefined;
    if (!outcome.ok) return { reply: prefix + outcomeText(outcome), tools };
    const who = data?.consideredMembers?.join(", ") ?? "the household";
    if ((data?.slots?.length ?? 0) === 0) {
      return {
        reply: `${prefix}I could not find a common ${durationMinutes}-minute slot for ${who} in that window (only visible calendars are considered).`,
        tools,
      };
    }
    return {
      reply: `${prefix}Possible times for ${who} (${durationMinutes} min):\n${slotsText(outcome.data, actor)}`,
      tools,
    };
  }

  // Agenda
  if (/\b(agenda|planned|schedule|what('s| is) on|happening|tomorrow|today|week)\b/.test(lower) && !/\b(add|create|buy|remind)\b/.test(lower)) {
    const day = parseDay(lower, actor);
    const from = day ?? today(actor);
    const to = /\bweek\b/.test(lower) ? addDaysToDateString(from, 6) : from;
    const outcome = await call("get_family_agenda", {
      dateFrom: from,
      dateTo: to,
      memberNames: mentionedMembers(actor, message).map((member) => member.name),
    });
    if (!outcome.ok) return { reply: prefix + outcomeText(outcome), tools };
    return {
      reply: `${prefix}Here is what I can see for ${formatDate(startOfDayUtc(from, actor.timezone), actor.locale, actor.timezone)}${to !== from ? ` – ${formatDate(startOfDayUtc(to, actor.timezone), actor.locale, actor.timezone)}` : ""}:\n${agendaText(outcome.data, actor)}`,
      tools,
    };
  }

  // Add event
  if (/\b(add|create|schedule|put|book)\b/.test(lower) && /\b(calendar|event|appointment|meeting|party|dinner|visit)\b/.test(lower)) {
    const day = parseDay(lower, actor);
    if (!day) {
      return { reply: prefix + "When should I put that on the calendar? Tell me a day and time.", tools };
    }
    const time = parseTime(lower) ?? "10:00";
    const start = isoAt(day, time, actor);
    const end = new Date(new Date(start).getTime() + 60 * 60_000).toISOString();
    const title = message
      .replace(/\b(add|create|schedule|put|book)\b/gi, "")
      .replace(/\b(to|on|in) (my|the|our) (calendar|schedule)\b/gi, "")
      .replace(/\b(today|tomorrow|next week|on \w+day)\b/gi, "")
      .replace(/\bat \d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) return { reply: prefix + "What should I call the event?", tools };
    const members = mentionedMembers(actor, message);
    const outcome = await call("create_event", {
      title: title.charAt(0).toUpperCase() + title.slice(1),
      startsAt: start,
      endsAt: end,
      participantNames: members.length > 0 ? members.map((member) => member.name) : undefined,
    });
    return { reply: prefix + outcomeText(outcome), tools };
  }

  // Cancel an event (requires approval)
  if (/\b(cancel|call off)\b/.test(lower) && !/\bcancel (my|the|our)? (subscription|order)\b/.test(lower)) {
    const eventMatch = /\b(?:cancel|call off)\s+(?:my|the|our)?\s*(.+?)(?:\s+(?:on|for|because)\b|$)/i.exec(message);
    if (!eventMatch) return { reply: prefix + "Which event should I cancel?", tools };
    const search = await call("search_calendars", { query: eventMatch[1].trim(), dateFrom: addDaysToDateString(today(actor), -30), dateTo: addDaysToDateString(today(actor), 180) });
    const found = (search.data as { eventId: string; title: string }[] | undefined) ?? [];
    if (found.length === 0) {
      return { reply: prefix + `I could not find an event matching “${eventMatch[1].trim()}”.`, tools };
    }
    const outcome = await call("cancel_event", { eventId: found[0].eventId, reason: message });
    return { reply: prefix + outcomeText(outcome), tools };
  }

  // Move an event
  if (/\b(move|reschedule|postpone)\b/.test(lower)) {
    const eventMatch = /(?:move|reschedule|postpone)\s+(?:my|the|our)?\s*(.+?)\s+(?:to|until|for)\b/i.exec(message);
    const day = parseDay(lower, actor);
    if (!eventMatch || !day) {
      return { reply: prefix + "Tell me which event to move and the new day and time.", tools };
    }
    const search = await call("search_calendars", { query: eventMatch[1].trim() });
    const found = (search.data as { eventId: string; title: string }[] | undefined) ?? [];
    if (found.length === 0) {
      return { reply: prefix + `I could not find an event matching “${eventMatch[1].trim()}”.`, tools };
    }
    const time = parseTime(lower) ?? "10:00";
    const startsAt = isoAt(day, time, actor);
    const endsAt = new Date(new Date(startsAt).getTime() + 3_600_000).toISOString();
    const outcome = await call("update_event", { eventId: found[0].eventId, startsAt, endsAt });
    return { reply: prefix + outcomeText(outcome), tools };
  }

  // Shopping add
  if (/\b(add|buy|need|put)\b/.test(lower) && /\b(shopping|grocer|list|store|supermarket)\b/.test(lower) && !/\bwhat\b/.test(lower)) {
    const cleaned = message
      .replace(/^.*?\b(?:add|buy|put)\b/i, "")
      .replace(/\bto (?:the|our|my) (?:shopping|grocery) list\b/gi, "")
      .replace(/\b(please|thanks)\b/gi, "")
      .trim();
    const items = cleaned
      .split(/,| and |\n/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length < 80);
    if (items.length === 0) return { reply: prefix + "What should I add to the list?", tools };
    const results: string[] = [];
    for (const item of items) {
      const outcome = await call("create_shopping_item", { name: item });
      results.push(outcomeText(outcome));
    }
    return { reply: prefix + results.join("\n"), tools };
  }

  // Shopping query
  if (/\b(what do we need to buy|shopping list|groceries|missing for)\b/.test(lower)) {
    const outcome = await call("list_shopping_items", {});
    const items = (outcome.data as { items?: { name: string; quantity: string | null; status: string }[] } | undefined)?.items ?? [];
    if (items.length === 0) return { reply: prefix + "There is nothing open on the shopping lists right now.", tools };
    return {
      reply: prefix + "Your open shopping items:\n" + bullet(items.map((item) => `${item.name}${item.quantity ? ` (${item.quantity})` : ""}`)),
      tools,
    };
  }

  // Note search
  if (/\b(where is|what is the|what's the|find the|do we have)\b/.test(lower) && /\b(note|key|code|wifi|instruction|manual|password)\b/.test(lower)) {
    const query = message.replace(/^.*?\b(where is|what is the|what's the|find the|do we have)\b/i, "").replace(/\?/g, "").trim();
    const outcome = await call("search_family_notes", { query: query || message });
    const notes = (outcome.data as { title: string; excerpt: string; sensitive: boolean }[] | undefined) ?? [];
    if (notes.length === 0) {
      return { reply: prefix + "I could not find a note you are allowed to see for that.", tools };
    }
    return {
      reply: prefix + bullet(notes.map((note) => `${note.title}: ${note.excerpt}`)),
      tools,
    };
  }

  // Remember / note
  if (/\b(remember|note that|save a note|write down)\b/.test(lower)) {
    const body = message.replace(/^.*?\b(remember( that)?|note that|save a note( that)?|write down( that)?)\b/i, "").trim();
    if (!body) return { reply: prefix + "What should I remember?", tools };
    const title = body.split(/\s+/).slice(0, 6).join(" ");
    const outcome = await call("create_family_note", { title, body, visibility: "private" });
    if (outcome.ok) {
      return {
        reply: `${prefix}${outcomeText(outcome)} It is private to you for now — change its visibility from Notes when you want to share it.`,
        tools,
      };
    }
    return { reply: prefix + outcomeText(outcome), tools };
  }

  // Reminder or task
  if (/\b(remind me|reminder|add a task|task to|to-?do)\b/.test(lower)) {
    const day = parseDay(lower, actor);
    const time = parseTime(lower) ?? "09:00";
    const isTask = /\b(task|to-?do)\b/.test(lower);
    const title = message
      .replace(/^.*?\b(remind me( to)?|add a task( to)?|task to|reminder to|to-?do)\b/i, "")
      .replace(/\b(today|tomorrow|next week|on \w+day|at \d{1,2}(:\d{2})?\s*(am|pm)?)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) return { reply: prefix + (isTask ? "What should the task be?" : "What should I remind you about?"), tools };
    if (!day) return { reply: prefix + `When should I ${isTask ? "schedule" : "remind you about"} “${title}”?`, tools };
    const assigned = mentionedMembers(actor, message).find((member) => member.id !== actor.id);
    if (isTask) {
      const outcome = await call("create_task", {
        title,
        dueAt: isoAt(day, time, actor),
        assignedTo: assigned?.name,
      });
      return { reply: prefix + outcomeText(outcome), tools };
    }
    const outcome = await call("create_reminder", {
      title,
      remindAt: isoAt(day, time, actor),
      memberName: assigned?.name,
    });
    return { reply: prefix + outcomeText(outcome), tools };
  }

  // Calls
  if (/\b(call|called|calling|missed call|callback)\b/.test(lower) && /\b(back|missed|record|log|grandma|school|doctor)\b/.test(lower)) {
    const contact = /\b(?:called|calling|call back|callback|missed call from|from)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?)/.exec(message)?.[1];
    const day = parseDay(lower, actor);
    const time = parseTime(lower) ?? "10:00";
    const outcome = await call("record_phone_call", {
      contactName: contact ?? "Unknown contact",
      direction: /missed/.test(lower) ? "missed" : /called me|from/.test(lower) ? "incoming" : "outgoing",
      reason: message,
      callbackAt: day ? isoAt(day, time, actor) : undefined,
      assignedTo: actor.name,
    });
    return { reply: prefix + outcomeText(outcome), tools };
  }

  // Packages
  if (/\b(package|parcel|delivery|deliveries|courier|collection|pickup point)\b/.test(lower) && !/\bschool\b/.test(lower)) {
    const outcome = await call("search_packages", { query: undefined });
    const packages = (outcome.data as { description: string; status: string; expected: string | null; collector: string | null }[] | undefined) ?? [];
    if (packages.length === 0) return { reply: prefix + "There are no active packages recorded.", tools };
    return {
      reply:
        prefix +
        bullet(
          packages.map(
            (pkg) =>
              `${pkg.description} — ${pkg.status.replace(/_/g, " ")}${pkg.expected ? `, expected ${formatDateTime(pkg.expected, actor.locale, actor.timezone)}` : ""}${pkg.collector ? `, ${pkg.collector} can collect` : ""}`,
          ),
        ),
      tools,
    };
  }

  // School
  if (/\b(school|pickup|pick up|pick-up|drop-?off|kindergarten)\b/.test(lower)) {
    const day = parseDay(lower, actor) ?? today(actor);
    const outcome = await call("list_school_pickups", { dateFrom: day, dateTo: addDaysToDateString(day, 7) });
    if (!outcome.ok) return { reply: prefix + outcomeText(outcome), tools };
    const data = outcome.data as
      | { pickups?: { child: string; date: string; time: string; responsible: string | null; status: string }[]; missing?: { childName: string; date: string; time: string }[] }
      | undefined;
    const lines: string[] = [];
    for (const pickup of data?.pickups ?? []) {
      lines.push(`${pickup.child}: ${pickup.date} ${pickup.time} — ${pickup.responsible ?? "nobody assigned"} (${pickup.status})`);
    }
    for (const missing of data?.missing ?? []) {
      lines.push(`Needs attention: ${missing.childName} on ${missing.date} at ${missing.time}`);
    }
    return {
      reply: prefix + (lines.length > 0 ? bullet(lines) : "No school runs are recorded for that period."),
      tools,
    };
  }

  // Holidays, trips and relatives
  if (/\b(holiday|vacation|trip|nephew|niece|relative|long weekend|school break)/.test(lower)) {
    const outcome = await call("list_holiday_options", { days: 180 });
    const data = outcome.data as
      | { holidays?: { date: string; name: string }[]; trips?: { tripId: string; title: string; rsvpSummary: Record<string, number> }[] }
      | undefined;
    const lines: string[] = [];
    if ((data?.holidays?.length ?? 0) > 0) {
      lines.push("Upcoming public holidays:");
      lines.push(bullet(data!.holidays!.slice(0, 6).map((holiday) => `${holiday.date}: ${holiday.name}`)));
    }
    for (const trip of data?.trips ?? []) {
      const rsvps = all<TripRsvpRow & { member_name: string | null }>(
        `SELECT r.*, m.name AS member_name FROM trip_rsvps r LEFT JOIN members m ON m.id = r.member_id WHERE r.trip_id = ?`,
        [trip.tripId],
      );
      const awaiting = rsvps.filter((rsvp) => rsvp.response === "awaiting" || rsvp.response === "invited");
      lines.push(
        `Trip “${trip.title}”: ${trip.rsvpSummary.accepted} accepted, ${awaiting.length} not confirmed${
          awaiting.length > 0
            ? ` (${awaiting.map((rsvp) => rsvp.member_name ?? rsvp.guest_name ?? "guest").join(", ")})`
            : ""
        }.`,
      );
    }
    const relatives = activeMembers(actor).filter((member) => member.role === "relative");
    if (relatives.length > 0) {
      lines.push(
        `Invited relatives: ${relatives.map((member) => member.name).join(", ")}. I will only treat them as attending after an accepted RSVP — an empty calendar is not a confirmation.`,
      );
    }
    return {
      reply: prefix + (lines.length > 0 ? lines.join("\n") : "There are no holidays or trips recorded yet."),
      tools,
    };
  }

  // Meal planning
  if (/\b(save (the )?meal plan)\b/.test(lower)) {
    const outcome = await call("generate_meal_plan", { days: 7, save: true });
    return { reply: prefix + outcomeText(outcome), tools };
  }

  if (/\b(meal|dinner plan|menu|what should we cook|recipe)\b/.test(lower)) {
    const day = parseDay(lower, actor) ?? today(actor);
    const outcome = await call("generate_meal_plan", { fromDate: day, days: 7 });
    const draft = (outcome.data as { draft?: { date: string; title: string }[] } | undefined)?.draft ?? [];
    if (draft.length === 0) return { reply: prefix + outcomeText(outcome), tools };
    return {
      reply:
        prefix +
        `Draft dinner plan:\n${bullet(draft.map((entry) => `${entry.date}: ${entry.title}`))}\n\nSay “save the meal plan” to store it and add the ingredients to the shopping list.`,
      tools,
    };
  }

  // RSVP
  if (/\b(rsvp|who confirmed|confirmed for|who is coming|who's coming)\b/.test(lower)) {
    const searchText = message.replace(/^.*?\b(rsvp|who confirmed|who is coming|who's coming)\b/i, "").trim();
    const search = await call("search_calendars", { query: searchText || "", dateFrom: addDaysToDateString(today(actor), -30), dateTo: addDaysToDateString(today(actor), 180) });
    const found = (search.data as { eventId: string; title: string }[] | undefined) ?? [];
    if (found.length === 0) return { reply: prefix + "I could not find that event in the calendars you can see.", tools };
    const outcome = await call("collect_event_rsvps", { eventId: found[0].eventId });
    const data = outcome.data as { accepted: string[]; awaiting: string[]; declined: string[]; tentative: string[] } | undefined;
    return {
      reply:
        prefix +
        [
          `Event: ${found[0].title}`,
          `Accepted: ${data?.accepted.join(", ") || "nobody yet"}`,
          `Awaiting reply: ${data?.awaiting.join(", ") || "nobody"}`,
          `Declined: ${data?.declined.join(", ") || "nobody"}`,
          data?.awaiting.length ? "Unanswered invitations are not counted as confirmed." : "",
        ]
          .filter(Boolean)
          .join("\n"),
      tools,
    };
  }

  return {
    reply: prefix + "I didn't find an action I can take for that yet.\n\n" + helpText(actor),
    tools,
  };
}
