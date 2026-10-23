"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireActor, setSessionCookie, clearSessionCookie } from "@/lib/auth/session";
import { SESSION_COOKIE, revokeSession } from "@/lib/auth/session-store";
import { toErrorMessage } from "@/lib/errors";
import { can } from "@/lib/auth/actor";
import type { Capability } from "@/lib/auth/permissions";
import { combineDateTime } from "@/lib/util/dates";
import {
  acceptInvitation,
  addFamilyMember,
  createHouseholdWithAdmin,
  createPasswordResetLink,
  deactivateMember,
  deleteOwnAccount,
  inviteMember,
  loginWithPassword,
  requestPasswordReset,
  resetPassword,
  updateDashboardPrefs,
  updateHousehold,
  updateMemberProfile,
} from "@/lib/domain/settings";
import { addShoppingItem, clearBoughtItems, createShoppingList, setShoppingItemStatus, updateShoppingItem } from "@/lib/domain/shopping";
import { createTask, deleteTask, setTaskStatus, updateTask } from "@/lib/domain/tasks";
import { cancelEvent, createEvent, updateEvent, respondToEvent } from "@/lib/domain/events";
import { createCalendar, shareCalendar } from "@/lib/domain/calendars";
import { importIcs } from "@/lib/domain/ics";
import { createPackage, setPackageStatus, updatePackage } from "@/lib/domain/packages";
import { createCall, setCallStatus } from "@/lib/domain/calls";
import { createNote, deleteNote, shareNote, updateNote } from "@/lib/domain/notes";
import {
  addMealPlanIngredientsToShoppingList,
  createRecipe,
  setMealPlanEntry,
  upsertInventoryItem,
} from "@/lib/domain/household";
import {
  assignPickup,
  completePickup,
  confirmPickup,
  createPickup,
  ensurePickupsForRange,
  upsertSchoolDay,
} from "@/lib/domain/school";
import {
  closePoll,
  createPoll,
  createTrip,
  generateTripChecklist,
  inviteToTrip,
  recordGuestRsvp,
  respondToTrip,
  updateTrip,
  votePoll,
} from "@/lib/domain/trips";
import { decideApproval } from "@/lib/domain/approvals";
import { executeApprovedTool } from "@/lib/agent/tools";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/domain/notifications";
import { recordAudit } from "@/lib/domain/audit";
import { runProactiveChecks } from "@/lib/proactive/insights";
import { updateIntegration } from "@/lib/domain/settings";
import { createMemory, deleteMemory, updateAiProfile, updateMemory } from "@/lib/domain/ai-profile";
import {
  addAssetToAlbum,
  createAlbum,
  createUploadedAsset,
  deleteAsset,
  deleteAlbum,
  shareAlbum,
  shareAsset,
  updateAssetMetadata,
} from "@/lib/domain/media";
import { cancelImageJob, enqueueImageJob } from "@/lib/images/queue";
import {
  createWorkflow,
  deleteWorkflow,
  installSampleWorkflow,
  updateWorkflow,
  type WorkflowOperation,
} from "@/lib/domain/image-workflows";
import { describePhoto } from "@/lib/domain/photos";
import {
  addMovieEntry,
  deleteMovieEntry,
  updateMovieEntry,
  updateMoviePreferences,
} from "@/lib/domain/movies";
import { ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { MAX_UPLOAD_BYTES } from "@/lib/media/storage";

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string): string | null {
  const value = text(form, key);
  return value ? value : null;
}

function numberOrNull(form: FormData, key: string): number | null {
  const value = text(form, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function checked(form: FormData, key: string): boolean {
  const value = form.get(key);
  return value === "on" || value === "true" || value === "1";
}

async function uploadedFile(
  form: FormData,
  key: string,
  required = true,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const value = form.get(key);
  if (!value || typeof value === "string" || !("arrayBuffer" in value)) {
    if (required) throw new ValidationError("Choose an image to upload.");
    return null;
  }
  const file = value as File;
  if (file.size === 0) {
    if (required) throw new ValidationError("The uploaded file is empty.");
    return null;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ValidationError(`Files must be at most ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  return { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name || "upload" };
}

function localIso(form: FormData, key: string, timezone: string): string | null {
  const value = text(form, key);
  if (!value) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value).toISOString();
  if (value.includes("T")) {
    const [date, time] = value.split("T");
    return combineDateTime(date, time.slice(0, 5), timezone).toISOString();
  }
  return new Date(value).toISOString();
}

function targetPath(form: FormData, fallback: string): string {
  const value = text(form, "redirectTo");
  return value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

async function feedback(
  form: FormData,
  fallback: string,
  operation: () => Promise<string | void> | string | void,
): Promise<never> {
  const path = targetPath(form, fallback);
  let message = "";
  let ok = true;
  try {
    const result = await operation();
    message = typeof result === "string" ? result : "Saved.";
  } catch (error) {
    ok = false;
    message = toErrorMessage(error);
  }
  revalidatePath("/", "layout");
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${ok ? "ok" : "error"}=${encodeURIComponent(message)}`);
}

/* ------------------------------- auth ------------------------------- */

export async function loginAction(form: FormData): Promise<void> {
  const email = text(form, "email");
  const password = text(form, "password");
  const redirectTo = targetPath(form, "/dashboard");
  try {
    const result = loginWithPassword(email, password, null);
    await setSessionCookie(result.token, result.expiresAt);
  } catch (error) {
    redirect(`/login?error=${encodeURIComponent(toErrorMessage(error))}`);
  }
  redirect(redirectTo);
}

export async function registerAction(form: FormData): Promise<void> {
  const householdName = text(form, "householdName");
  const name = text(form, "name");
  const email = text(form, "email");
  const password = text(form, "password");
  const timezone = text(form, "timezone") || "Europe/Sofia";
  const locale = text(form, "locale") || "en";
  try {
    const created = createHouseholdWithAdmin({ householdName, name, email, password, timezone, locale });
    const result = loginWithPassword(email, password, null);
    await setSessionCookie(result.token, result.expiresAt);
    recordAudit({ id: created.memberId, householdId: created.householdId }, "household.created", "household", created.householdId);
  } catch (error) {
    redirect(`/register?error=${encodeURIComponent(toErrorMessage(error))}`);
  }
  redirect("/dashboard?ok=" + encodeURIComponent("Your household is ready. Add your family members in Settings."));
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) revokeSession(token);
  await clearSessionCookie();
  redirect("/login");
}

export async function acceptInviteAction(form: FormData): Promise<void> {
  const token = text(form, "token");
  const password = text(form, "password");
  try {
    const result = acceptInvitation(token, password);
    if (!result.email) throw new Error("This invitation is not linked to an email sign-in.");
    const login = loginWithPassword(result.email, password, null);
    await setSessionCookie(login.token, login.expiresAt);
  } catch (error) {
    redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(toErrorMessage(error))}`);
  }
  redirect("/dashboard?ok=" + encodeURIComponent("Welcome to the family!"));
}

export async function requestPasswordResetAction(form: FormData): Promise<void> {
  const email = text(form, "email");
  let token: string | null = null;
  let failure: string | null = null;
  try {
    const result = requestPasswordReset(email);
    token = result.token;
  } catch (error) {
    failure = toErrorMessage(error);
  }
  if (failure) {
    redirect(`/forgot-password?error=${encodeURIComponent(failure)}`);
  }
  if (token && process.env.NODE_ENV !== "production") {
    redirect(
      `/forgot-password?ok=${encodeURIComponent("Development reset link created below.")}&token=${encodeURIComponent(token)}`,
    );
  }
  redirect(
    `/forgot-password?ok=${encodeURIComponent("If that email belongs to an account, reset instructions have been prepared. Ask a household administrator to share the one-time link.")}`,
  );
}

export async function resetPasswordAction(form: FormData): Promise<void> {
  const token = text(form, "token");
  try {
    resetPassword(token, text(form, "password"));
  } catch (error) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(toErrorMessage(error))}`);
  }
  redirect("/login?ok=" + encodeURIComponent("Password updated. Please sign in."));
}

/* ------------------------------- shopping ------------------------------- */

export async function addShoppingItemAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, "/shopping", () => {
    addShoppingItem(actor, {
      listId: optional(form, "listId") ?? undefined,
      name: text(form, "name"),
      quantity: optional(form, "quantity"),
      priority: (text(form, "priority") || "normal") as "low" | "normal" | "high" | "urgent",
      assignedMemberId: optional(form, "assignedMemberId"),
    });
    return "Added to the shopping list.";
  });
}

export async function toggleShoppingItemAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, "/shopping", () => {
    const status = text(form, "status") === "open" ? "open" : "bought";
    setShoppingItemStatus(actor, text(form, "itemId"), status);
    return status === "bought" ? "Item checked off." : "Item moved back to the list.";
  });
}

export async function clearBoughtAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, "/shopping", () => {
    const removed = clearBoughtItems(actor, text(form, "listId"));
    return `${removed} bought item(s) cleared.`;
  });
}

export async function createShoppingListAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, "/shopping", () => {
    createShoppingList(actor, { name: text(form, "name"), store: optional(form, "store") });
    return "List created.";
  });
}

export async function updateShoppingItemAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, "/shopping", () => {
    updateShoppingItem(actor, text(form, "itemId"), {
      name: text(form, "name") || undefined,
      quantity: optional(form, "quantity"),
      priority: (text(form, "priority") || "normal") as "low" | "normal" | "high" | "urgent",
      assignedMemberId: optional(form, "assignedMemberId"),
    });
    return "Item updated.";
  });
}

/* ------------------------------- tasks ------------------------------- */

export async function createTaskAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/tasks"), () => {
    createTask(actor, {
      title: text(form, "title"),
      dueAt: localIso(form, "dueAt", actor.timezone),
      priority: (text(form, "priority") || "normal") as "low" | "normal" | "high" | "urgent",
      category: text(form, "category") || "general",
      assignedMemberId: optional(form, "assignedMemberId"),
      recurrenceRule: optional(form, "recurrenceRule"),
      notes: optional(form, "notes"),
    });
    return "Task created.";
  });
}

export async function setTaskStatusAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/tasks"), () => {
    setTaskStatus(actor, text(form, "taskId"), text(form, "status") as "open" | "done" | "cancelled");
    return "Task updated.";
  });
}

export async function assignTaskAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/tasks"), () => {
    updateTask(actor, text(form, "taskId"), { assignedMemberId: optional(form, "assignedMemberId") });
    return "Task assigned.";
  });
}

export async function deleteTaskAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/tasks"), () => {
    deleteTask(actor, text(form, "taskId"));
    return "Task deleted.";
  });
}

/* ------------------------------- calendar ------------------------------- */

export async function createEventAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/calendar"), () => {
    createEvent(actor, {
      calendarId: text(form, "calendarId"),
      title: text(form, "title"),
      startsAt: localIso(form, "startsAt", actor.timezone) ?? new Date().toISOString(),
      endsAt: localIso(form, "endsAt", actor.timezone) ?? new Date(Date.now() + 3_600_000).toISOString(),
      location: optional(form, "location"),
      description: optional(form, "description"),
      allDay: checked(form, "allDay"),
      visibility: text(form, "visibility") === "private" ? "private" : "household",
      recurrenceRule: optional(form, "recurrenceRule"),
      participantIds: form.getAll("participantIds").map(String).filter(Boolean),
      reminderMinutes: [15],
    });
    return "Event created.";
  });
}

export async function updateEventAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/calendar"), () => {
    updateEvent(actor, text(form, "eventId"), {
      title: text(form, "title") || undefined,
      startsAt: localIso(form, "startsAt", actor.timezone) ?? undefined,
      endsAt: localIso(form, "endsAt", actor.timezone) ?? undefined,
      location: optional(form, "location"),
      description: optional(form, "description"),
    });
    return "Event updated.";
  });
}

export async function cancelEventAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/calendar"), () => {
    cancelEvent(actor, text(form, "eventId"), optional(form, "reason") ?? undefined);
    return "Event cancelled.";
  });
}

export async function rsvpEventAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/calendar"), () => {
    respondToEvent(
      actor,
      text(form, "eventId"),
      text(form, "response") as "accepted" | "declined" | "tentative" | "invited" | "awaiting",
    );
    return "Reply saved.";
  });
}

export async function importIcsAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/calendar"), () => {
    const result = importIcs(actor, text(form, "calendarId"), text(form, "icsText"));
    return `Imported ${result.imported}, skipped ${result.skipped} duplicate(s)${result.failed ? `, ${result.failed} failed` : ""}.`;
  });
}

export async function createCalendarAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    createCalendar(actor, {
      name: text(form, "name"),
      color: text(form, "color") || "#0f766e",
      scope: text(form, "scope") === "personal" ? "personal" : "shared",
      kind: text(form, "kind") || "custom",
    });
    return "Calendar created.";
  });
}

export async function shareCalendarAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    shareCalendar(
      actor,
      text(form, "calendarId"),
      text(form, "memberId"),
      text(form, "access") === "edit" ? "edit" : "view",
    );
    return "Calendar sharing updated.";
  });
}

/* ------------------------------- deliveries & calls ------------------------------- */

export async function createPackageAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/deliveries"), () => {
    createPackage(actor, {
      description: text(form, "description"),
      merchant: optional(form, "merchant"),
      trackingNumber: optional(form, "trackingNumber"),
      expectedFrom: localIso(form, "expectedFrom", actor.timezone),
      expectedTo: localIso(form, "expectedTo", actor.timezone),
      collectorMemberId: optional(form, "collectorMemberId"),
      deadline: localIso(form, "deadline", actor.timezone),
      instructions: optional(form, "instructions"),
      pickupPoint: optional(form, "pickupPoint"),
      collectionCode: optional(form, "collectionCode"),
    });
    return "Package added.";
  });
}

export async function updatePackageAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/deliveries"), () => {
    updatePackage(actor, text(form, "packageId"), {
      collectorMemberId: optional(form, "collectorMemberId"),
      expectedFrom: localIso(form, "expectedFrom", actor.timezone),
      expectedTo: localIso(form, "expectedTo", actor.timezone),
      deadline: localIso(form, "deadline", actor.timezone),
      instructions: optional(form, "instructions"),
    });
    return "Package updated.";
  });
}

export async function setPackageStatusAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/deliveries"), () => {
    setPackageStatus(
      actor,
      text(form, "packageId"),
      text(form, "status") as "expected" | "in_transit" | "out_for_delivery" | "delivered" | "collected" | "missed" | "returned",
      optional(form, "note") ?? undefined,
    );
    return "Package status recorded as member-reported.";
  });
}

export async function createCallAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/household"), () => {
    createCall(actor, {
      contactName: text(form, "contactName"),
      direction: (text(form, "direction") || "missed") as "incoming" | "outgoing" | "missed",
      reason: optional(form, "reason"),
      notes: optional(form, "notes"),
      callbackAt: localIso(form, "callbackAt", actor.timezone),
      assignedMemberId: optional(form, "assignedMemberId"),
    });
    return "Call recorded.";
  });
}

export async function setCallStatusAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/household"), () => {
    setCallStatus(
      actor,
      text(form, "callId"),
      text(form, "status") as "pending" | "completed" | "postponed" | "cancelled",
      optional(form, "note") ?? undefined,
    );
    return "Call updated.";
  });
}

/* ------------------------------- school ------------------------------- */

export async function upsertSchoolDayAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/school"), () => {
    upsertSchoolDay(actor, {
      memberId: text(form, "memberId"),
      date: text(form, "date"),
      startTime: optional(form, "startTime"),
      endTime: optional(form, "endTime"),
      earlyDismissal: checked(form, "earlyDismissal"),
      notes: optional(form, "notes"),
    });
    return "School day saved.";
  });
}

export async function createPickupAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/school"), () => {
    createPickup(actor, {
      memberId: text(form, "memberId"),
      date: text(form, "date"),
      direction: text(form, "direction") === "dropoff" ? "dropoff" : "pickup",
      time: text(form, "time"),
      responsibleMemberId: optional(form, "responsibleMemberId"),
      notes: optional(form, "notes"),
    });
    return "School run added.";
  });
}

export async function assignPickupAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/school"), () => {
    assignPickup(actor, text(form, "pickupId"), optional(form, "responsibleMemberId"));
    return "Responsibility updated.";
  });
}

export async function confirmPickupAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/school"), () => {
    confirmPickup(actor, text(form, "pickupId"));
    return "Arrangement confirmed. This is coordination, not proof of arrival.";
  });
}

export async function completePickupAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/school"), () => {
    completePickup(actor, text(form, "pickupId"));
    return "Completion reported by a family member.";
  });
}

export async function ensurePickupsAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/school"), () => {
    const created = ensurePickupsForRange(actor, text(form, "from"), text(form, "to"));
    return `${created} school run(s) created from the timetable.`;
  });
}

/* ------------------------------- notes ------------------------------- */

export async function createNoteAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/notes"), () => {
    createNote(actor, {
      title: text(form, "title"),
      body: text(form, "body"),
      visibility: (text(form, "visibility") || "household") as "household" | "private" | "restricted",
      category: text(form, "category") || "general",
      sensitive: checked(form, "sensitive"),
      sharedWith: form.getAll("sharedWith").map(String).filter(Boolean),
    });
    return "Note saved.";
  });
}

export async function updateNoteAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/notes"), () => {
    updateNote(actor, text(form, "noteId"), {
      title: text(form, "title") || undefined,
      body: text(form, "body") || undefined,
      visibility: text(form, "visibility") as "household" | "private" | "restricted",
      category: text(form, "category") || undefined,
      sensitive: checked(form, "sensitive"),
    });
    return "Note updated.";
  });
}

export async function deleteNoteAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/notes"), () => {
    deleteNote(actor, text(form, "noteId"));
    return "Note deleted.";
  });
}

export async function shareNoteAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/notes"), () => {
    shareNote(actor, text(form, "noteId"), text(form, "memberId"));
    return "Note shared.";
  });
}

/* ------------------------------- household ------------------------------- */

export async function createRecipeAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/household"), () => {
    const ingredients = text(form, "ingredients")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, quantity, unit] = line.split("|").map((part) => part.trim());
        return { name, quantity: quantity || undefined, unit: unit || undefined };
      });
    createRecipe(actor, {
      title: text(form, "title"),
      ingredients,
      instructions: optional(form, "instructions") ?? undefined,
      tags: optional(form, "tags") ?? undefined,
      servings: numberOrNull(form, "servings") ?? 4,
    });
    return "Recipe saved.";
  });
}

export async function setMealAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/household"), () => {
    setMealPlanEntry(actor, {
      date: text(form, "date"),
      mealType: (text(form, "mealType") || "dinner") as "breakfast" | "lunch" | "dinner" | "snack",
      title: text(form, "title"),
      recipeId: optional(form, "recipeId"),
      notes: optional(form, "notes"),
    });
    return "Meal planned.";
  });
}

export async function addMealIngredientsAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/household"), () => {
    const result = addMealPlanIngredientsToShoppingList(actor, {
      fromDate: text(form, "fromDate"),
      toDate: text(form, "toDate"),
    });
    return `${result.added} ingredient(s) added to the shopping list.`;
  });
}

export async function upsertInventoryAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/household"), () => {
    upsertInventoryItem(actor, {
      id: optional(form, "id") ?? undefined,
      name: text(form, "name"),
      category: optional(form, "category"),
      quantity: numberOrNull(form, "quantity") ?? 0,
      unit: optional(form, "unit"),
      minStock: numberOrNull(form, "minStock"),
    });
    return "Inventory updated.";
  });
}

/* ------------------------------- holidays & trips ------------------------------- */

export async function createTripAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/holidays"), () => {
    createTrip(actor, {
      title: text(form, "title"),
      destination: optional(form, "destination"),
      startsAt: localIso(form, "startsAt", actor.timezone),
      endsAt: localIso(form, "endsAt", actor.timezone),
      notes: optional(form, "notes"),
      budget: numberOrNull(form, "budget"),
    });
    return "Trip created.";
  });
}

export async function updateTripAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/holidays"), () => {
    updateTrip(actor, text(form, "tripId"), {
      title: text(form, "title") || undefined,
      destination: optional(form, "destination"),
      startsAt: localIso(form, "startsAt", actor.timezone),
      endsAt: localIso(form, "endsAt", actor.timezone),
      notes: optional(form, "notes"),
      budget: numberOrNull(form, "budget"),
      status: (text(form, "status") || undefined) as "planning" | "confirmed" | "completed" | "cancelled" | undefined,
    });
    return "Trip updated.";
  });
}

export async function inviteTripAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/holidays"), () => {
    const result = inviteToTrip(actor, text(form, "tripId"), {
      memberIds: form.getAll("memberIds").map(String).filter(Boolean),
      guests: text(form, "guestNames")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name })),
    });
    return `${result.invitedMembers} family member(s) and ${result.invitedGuests} guest(s) invited. Unanswered invitations stay unconfirmed.`;
  });
}

export async function rsvpTripAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/holidays"), () => {
    respondToTrip(actor, text(form, "tripId"), text(form, "response") as "accepted" | "declined" | "tentative");
    return "Your reply is saved.";
  });
}

export async function guestRsvpAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/holidays"), () => {
    recordGuestRsvp(actor, text(form, "rsvpId"), text(form, "response") as "accepted" | "declined" | "tentative" | "awaiting");
    return "Guest reply recorded.";
  });
}

export async function createPollAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/holidays"), () => {
    createPoll(actor, {
      tripId: optional(form, "tripId"),
      question: text(form, "question"),
      kind: (text(form, "kind") || "activity") as "date" | "destination" | "activity",
      options: text(form, "options")
        .split("\n")
        .map((option) => option.trim())
        .filter(Boolean)
        .map((label) => ({ label })),
    });
    return "Poll created.";
  });
}

export async function votePollAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/holidays"), () => {
    votePoll(actor, text(form, "pollId"), text(form, "optionId"));
    return "Vote saved.";
  });
}

export async function closePollAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/holidays"), () => {
    closePoll(actor, text(form, "pollId"));
    return "Poll closed.";
  });
}

export async function generateChecklistAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/holidays"), () => {
    const result = generateTripChecklist(actor, text(form, "tripId"), {
      assignToMemberId: optional(form, "assignToMemberId"),
      days: numberOrNull(form, "days") ?? 3,
    });
    return `${result.tasks} preparation task(s) and ${result.shoppingItems} shopping item(s) created.`;
  });
}

/* ------------------------------- notifications & approvals ------------------------------- */

export async function markNotificationReadAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/notifications"), () => {
    markNotificationRead(actor.id, text(form, "notificationId"));
    return "Marked as read.";
  });
}

export async function markAllReadAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/notifications"), () => {
    markAllNotificationsRead(actor.id);
    return "All notifications marked read.";
  });
}

export async function decideApprovalAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  const decision = text(form, "decision") === "rejected" ? "rejected" : "approved";
  await feedback(form, targetPath(form, "/approvals"), async () => {
    const approval = decideApproval(actor, text(form, "approvalId"), decision);
    if (decision === "approved") {
      const outcome = await executeApprovedTool(actor, approval.id);
      return outcome.ok ? `Approved and completed: ${outcome.summary}` : `Approved, but failed: ${outcome.summary}`;
    }
    return "Request declined.";
  });
}

export async function runProactiveChecksAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/dashboard"), () => {
    if (!can(actor, "household.manage")) throw new Error("Only household administrators can run the family checks.");
    const results = runProactiveChecks(actor.householdId);
    const created = results.reduce((total, result) => total + result.notificationsCreated, 0);
    return `Checked the household: ${created} new notification(s).`;
  });
}

/* ------------------------------- settings ------------------------------- */

export async function updateHouseholdAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    updateHousehold(actor, {
      name: text(form, "name"),
      timezone: text(form, "timezone"),
      locale: text(form, "locale"),
      holidayCountry: text(form, "holidayCountry"),
    });
    return "Household settings saved.";
  });
}

export async function updateProfileAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    updateMemberProfile(actor, text(form, "memberId") || actor.id, {
      name: text(form, "name") || undefined,
      color: text(form, "color") || undefined,
      avatar: text(form, "avatar") || undefined,
      relationship: optional(form, "relationship"),
      birthday: optional(form, "birthday"),
      timezone: text(form, "timezone") || undefined,
      locale: text(form, "locale") || undefined,
      role: (text(form, "role") || undefined) as "parent" | "adult" | "teen" | "child" | "relative" | undefined,
      isAdmin: form.has("isAdmin") ? checked(form, "isAdmin") : undefined,
      permissionOverrides: form.has("permissionForm")
        ? {
            grant: form.getAll("grant").map(String).filter(Boolean) as Capability[],
            revoke: form.getAll("revoke").map(String).filter(Boolean) as Capability[],
          }
        : undefined,
      notificationPrefs: {
        categories: {
          calendar: !checked(form, "muteCalendar"),
          tasks: !checked(form, "muteTasks"),
          shopping: !checked(form, "muteShopping"),
          packages: !checked(form, "mutePackages"),
          school: !checked(form, "muteSchool"),
          holidays: !checked(form, "muteHolidays"),
          briefing: !checked(form, "muteBriefing"),
        },
        quietHours: {
          start: text(form, "quietStart") || "22:00",
          end: text(form, "quietEnd") || "07:00",
          enabled: checked(form, "quietEnabled"),
        },
      },
    });
    return "Profile updated.";
  });
}

export async function inviteMemberAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    const result = inviteMember(actor, {
      name: text(form, "name"),
      email: text(form, "email"),
      role: (text(form, "role") || "adult") as "parent" | "adult" | "teen" | "child" | "relative",
      isAdmin: checked(form, "isAdmin"),
    });
    return `Invitation created. Share this link once: /invite/${result.token}`;
  });
}

export async function addMemberAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    addFamilyMember(actor, {
      name: text(form, "name"),
      role: (text(form, "role") || "child") as "parent" | "adult" | "teen" | "child" | "relative",
      relationship: optional(form, "relationship"),
      birthday: optional(form, "birthday"),
      color: text(form, "color") || undefined,
    });
    return "Family member added.";
  });
}

export async function deactivateMemberAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    deactivateMember(actor, text(form, "memberId"));
    return "Member deactivated and sessions revoked.";
  });
}

export async function updateIntegrationAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    updateIntegration(actor, text(form, "kind"), {
      status: text(form, "status") as "disabled" | "configured" | "connected" | "error",
      config: {
        calendarId: text(form, "calendarId") || undefined,
        feedUrl: text(form, "feedUrl") || undefined,
        note: "Credentials are read from environment variables only.",
      },
    });
    return "Integration setting saved. Real syncing still requires credentials and a configured worker.";
  });
}

export async function deleteAccountAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  try {
    deleteOwnAccount(actor, text(form, "password"));
  } catch (error) {
    redirect(`/settings?error=${encodeURIComponent(toErrorMessage(error))}`);
  }
  await clearSessionCookie();
  redirect("/login?ok=" + encodeURIComponent("Your account has been deleted."));
}

export async function switchLocaleAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  const locale = text(form, "locale") === "bg" ? "bg" : "en";
  updateMemberProfile(actor, actor.id, { locale });
  revalidatePath("/", "layout");
  redirect(targetPath(form, "/dashboard"));
}

export async function updateDashboardPrefsAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/dashboard"), () => {
    const widgets = {
      briefing: checked(form, "briefing"),
      agenda: checked(form, "agenda"),
      insights: checked(form, "insights"),
      week: checked(form, "week"),
      feed: checked(form, "feed"),
      approvals: checked(form, "approvals"),
      quickAdd: checked(form, "quickAdd"),
      availability: checked(form, "availability"),
    };
    updateDashboardPrefs(actor, widgets);
    return "Dashboard preferences saved.";
  });
}

export async function createResetLinkAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    const token = createPasswordResetLink(actor, text(form, "memberId"));
    return `One-time reset link (valid 1 hour, share privately): /reset-password?token=${token}`;
  });
}

/* ------------------------- personal AI profile ------------------------- */

export async function updateAiProfileAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/profile"), () => {
    updateAiProfile(actor, {
      persona: text(form, "persona"),
      interests: text(form, "interests")
        .split(/[\n,]/)
        .map((interest) => interest.trim())
        .filter(Boolean),
      preferences: {
        tone: text(form, "tone"),
        detail: text(form, "detail"),
        humor: text(form, "humor"),
        language: text(form, "responseLanguage"),
      },
      provider: (text(form, "provider") || "auto") as "auto" | "ollama" | "openai" | "local",
      model: optional(form, "model"),
      shareFamilyKnowledge: checked(form, "shareFamilyKnowledge"),
    });
    return "AI profile updated.";
  });
}

export async function saveMemoryAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/profile"), () => {
    createMemory(actor, {
      content: text(form, "content"),
      scope: (text(form, "scope") || "private") as "private" | "family",
      category: text(form, "category") || "general",
      tags: text(form, "tags")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    return "Memory saved.";
  });
}

export async function updateMemoryAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/profile"), () => {
    updateMemory(actor, text(form, "memoryId"), {
      content: text(form, "content") || undefined,
      category: text(form, "category") || undefined,
      tags: text(form, "tags")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      scope: (text(form, "scope") || undefined) as "private" | "family" | undefined,
    });
    return "Memory updated.";
  });
}

export async function deleteMemoryAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/profile"), () => {
    deleteMemory(actor, text(form, "memoryId"));
    return "Memory deleted.";
  });
}

/* -------------------------------- media -------------------------------- */

export async function uploadAssetAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  const library = text(form, "library") === "photos" ? "photos" : "studio";
  await feedback(form, library === "photos" ? "/photos" : "/studio", async () => {
    checkRateLimit(`media-upload:${actor.id}`, 40, 3600);
    const file = await uploadedFile(form, "file");
    if (!file) throw new ValidationError("Choose an image to upload.");
    const asset = await createUploadedAsset(actor, {
      buffer: file.buffer,
      filename: file.filename,
      library,
      caption: optional(form, "caption"),
      tags: text(form, "tags")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      takenAt: optional(form, "takenAt"),
      albumId: optional(form, "albumId"),
    });
    return `Uploaded ${asset.original_filename ?? "image"} (${Math.round(asset.bytes / 1024)} KB).`;
  });
}

export async function updateAssetAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/studio"), () => {
    updateAssetMetadata(actor, text(form, "assetId"), {
      caption: optional(form, "caption"),
      tags: form.has("tags")
        ? text(form, "tags")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : undefined,
      favorite: form.has("favoriteForm") ? checked(form, "favorite") : undefined,
    });
    return "Image details updated.";
  });
}

export async function deleteAssetAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/studio"), () => {
    deleteAsset(actor, text(form, "assetId"));
    return "Image moved to deleted storage and will be purged after the retention window.";
  });
}

export async function shareAssetAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/studio"), () => {
    const memberIds = form.getAll("memberIds").map(String).filter(Boolean);
    if (memberIds.length === 0) throw new ValidationError("Choose at least one family member.");
    shareAsset(actor, text(form, "assetId"), memberIds);
    return "Image shared with the selected family members.";
  });
}

export async function createAlbumAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  const library = text(form, "library") === "photos" ? "photos" : "studio";
  await feedback(form, library === "photos" ? "/photos" : "/studio", () => {
    createAlbum(actor, {
      name: text(form, "name"),
      visibility: (text(form, "visibility") || "private") as "private" | "family" | "selected",
      memberIds: form.getAll("memberIds").map(String).filter(Boolean),
    });
    return "Album created.";
  });
}

export async function shareAlbumAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/photos"), () => {
    shareAlbum(
      actor,
      text(form, "albumId"),
      form.getAll("memberIds").map(String).filter(Boolean),
      (text(form, "visibility") || undefined) as "private" | "family" | "selected" | undefined,
    );
    return "Album sharing updated.";
  });
}

export async function addAssetToAlbumAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/studio"), () => {
    addAssetToAlbum(actor, text(form, "albumId"), text(form, "assetId"));
    return "Image added to the album.";
  });
}

export async function deleteAlbumAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/photos"), () => {
    deleteAlbum(actor, text(form, "albumId"));
    return "Album deleted.";
  });
}

/* ----------------------------- image jobs ----------------------------- */

export async function enqueueImageJobAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/studio"), async () => {
    checkRateLimit(`image-jobs:${actor.id}`, 20, 3600);
    const maskFile = await uploadedFile(form, "mask", false);
    let maskAssetId: string | null = null;
    if (maskFile) {
      const mask = await createUploadedAsset(actor, {
        buffer: maskFile.buffer,
        filename: maskFile.filename,
        library: "studio",
        caption: "Mask for image edit",
        tags: ["mask"],
      });
      maskAssetId = mask.id;
    }
    const job = enqueueImageJob(actor, {
      operation: (text(form, "operation") || "text_to_image") as WorkflowOperation,
      prompt: text(form, "prompt"),
      negativePrompt: optional(form, "negativePrompt") ?? undefined,
      workflowId: optional(form, "workflowId"),
      sourceAssetId: optional(form, "sourceAssetId"),
      params: {
        width: numberOrNull(form, "width") ?? undefined,
        height: numberOrNull(form, "height") ?? undefined,
        steps: numberOrNull(form, "steps") ?? undefined,
        cfg: numberOrNull(form, "cfg") ?? undefined,
        denoise: numberOrNull(form, "denoise") ?? undefined,
        scale: numberOrNull(form, "scale") ?? undefined,
        seed: numberOrNull(form, "seed") ?? undefined,
        checkpoint: optional(form, "checkpoint") ?? undefined,
        maskAssetId,
        albumId: optional(form, "albumId"),
        library: "studio",
      },
    });
    return `Image job ${job.id} queued. It runs one at a time to protect the Mac Studio.`;
  });
}

export async function cancelImageJobAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/studio"), () => {
    cancelImageJob(actor, text(form, "jobId"));
    return "Queued image job cancelled.";
  });
}

/* --------------------------- image workflows --------------------------- */

export async function saveWorkflowAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    const workflowId = optional(form, "workflowId");
    const input = {
      name: text(form, "name"),
      operation: text(form, "operation") as WorkflowOperation,
      workflowJson: text(form, "workflowJson"),
      modelLabel: optional(form, "modelLabel"),
      description: optional(form, "description"),
      enabled: checked(form, "enabled"),
    };
    if (workflowId) {
      updateWorkflow(actor, workflowId, input);
      return "Workflow updated.";
    }
    createWorkflow(actor, input);
    return "Workflow created. Keep it disabled until its ComfyUI model files are installed.";
  });
}

export async function toggleWorkflowAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    updateWorkflow(actor, text(form, "workflowId"), { enabled: checked(form, "enabled") });
    return "Workflow status updated.";
  });
}

export async function installSampleWorkflowAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    installSampleWorkflow(actor, text(form, "sampleId"));
    return "Sample workflow added (disabled). Review its model files and enable it when ready.";
  });
}

export async function deleteWorkflowAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/settings"), () => {
    deleteWorkflow(actor, text(form, "workflowId"));
    return "Workflow deleted. Existing jobs keep their history.";
  });
}

/* ------------------------------- photos ------------------------------- */

export async function describePhotoAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/photos"), async () => {
    checkRateLimit(`photo-describe:${actor.id}`, 30, 3600);
    const result = await describePhoto(actor, text(form, "assetId"));
    return result.embedded
      ? "Photo described by the local vision model and indexed for semantic search."
      : "Photo described by the local vision model. Set OLLAMA_EMBED_MODEL to enable semantic search.";
  });
}

/* ------------------------------- movies ------------------------------- */

export async function addMovieAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/movies"), async () => {
    const entry = await addMovieEntry(actor, {
      tmdbId: Number(text(form, "tmdbId")),
      status: (text(form, "status") || "watchlist") as "watchlist" | "watched",
      favorite: checked(form, "favorite"),
      rating: numberOrNull(form, "rating"),
      notes: optional(form, "notes"),
    });
    return `Saved “${entry.title}” to your ${entry.status === "watched" ? "watched list" : "watchlist"}.`;
  });
}

export async function updateMovieAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/movies"), () => {
    updateMovieEntry(actor, text(form, "entryId"), {
      status: (text(form, "status") || undefined) as "watchlist" | "watched" | undefined,
      favorite: form.has("favoriteForm") ? checked(form, "favorite") : undefined,
      rating: numberOrNull(form, "rating"),
      notes: optional(form, "notes"),
    });
    return "Movie list updated.";
  });
}

export async function deleteMovieAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/movies"), () => {
    deleteMovieEntry(actor, text(form, "entryId"));
    return "Movie removed from your list.";
  });
}

export async function updateMoviePreferencesAction(form: FormData): Promise<void> {
  const actor = await requireActor();
  await feedback(form, targetPath(form, "/movies"), () => {
    updateMoviePreferences(actor, {
      genres: form
        .getAll("genreIds")
        .map(String)
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
      avoidGenres: form
        .getAll("avoidGenreIds")
        .map(String)
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
      languages: text(form, "languages")
        .split(",")
        .map((code) => code.trim().toLowerCase())
        .filter(Boolean),
      favoriteServices: text(form, "favoriteServices")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    });
    return "Movie preferences updated.";
  });
}
