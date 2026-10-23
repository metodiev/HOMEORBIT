import { all, get, run } from "@/lib/db";
import type { HouseholdRow, IntegrationRow, InvitationRow, MemberRow } from "@/lib/db/rows";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso, parseJson, randomToken, sha256, toJson } from "@/lib/util/ids";
import type { PermissionOverrides } from "@/lib/auth/permissions";
import type { NotificationPreferences } from "./notifications";
import { recordAudit } from "./audit";
import { hashPassword, passwordProblems, verifyPassword } from "@/lib/auth/password";
import { createSession, revokeAllSessionsForMember } from "@/lib/auth/session-store";
import { checkRateLimit } from "@/lib/auth/rate-limit";

export type HouseholdSettings = HouseholdRow & {
  memberCount: number;
  timezone: string;
  holidayCountry: string;
};

export function getHouseholdSettings(actor: Actor): HouseholdSettings {
  const household = get<HouseholdRow & { holiday_country: string }>(
    "SELECT * FROM households WHERE id = ?",
    [actor.householdId],
  );
  if (!household) throw new NotFoundError("Household not found.");
  const count = get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM members WHERE household_id = ? AND deactivated_at IS NULL",
    [actor.householdId],
  );
  return {
    ...household,
    memberCount: count?.count ?? 0,
    timezone: household.timezone,
    holidayCountry: household.holiday_country ?? "BG",
  } as HouseholdSettings;
}

export function updateHousehold(
  actor: Actor,
  input: { name?: string; timezone?: string; locale?: string; holidayCountry?: string },
): void {
  if (!can(actor, "household.manage")) throw new ForbiddenError("Only household administrators can do that.");
  const household = get<HouseholdRow>("SELECT * FROM households WHERE id = ?", [actor.householdId]);
  if (!household) throw new NotFoundError("Household not found.");
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
    } catch {
      throw new ValidationError("Unknown time zone.");
    }
  }
  run("UPDATE households SET name = ?, timezone = ?, locale = ?, holiday_country = ? WHERE id = ?", [
    input.name?.trim() || household.name,
    input.timezone ?? household.timezone,
    input.locale ?? household.locale,
    input.holidayCountry ?? (household as HouseholdRow & { holiday_country?: string }).holiday_country ?? "BG",
    household.id,
  ]);
  recordAudit(actor, "household.updated", "household", household.id);
}

export function listMembers(actor: Actor): MemberRow[] {
  if (actor.role === "relative") {
    const self = get<MemberRow>("SELECT * FROM members WHERE id = ?", [actor.id]);
    return self ? [self] : [];
  }
  return all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
    [actor.householdId],
  );
}

export function updateMemberProfile(
  actor: Actor,
  memberId: string,
  input: {
    name?: string;
    color?: string;
    avatar?: string;
    relationship?: string | null;
    birthday?: string | null;
    timezone?: string;
    locale?: string;
    notificationPrefs?: NotificationPreferences;
    permissionOverrides?: PermissionOverrides;
    role?: MemberRow["role"];
    isAdmin?: boolean;
  },
): MemberRow {
  const member = get<MemberRow>("SELECT * FROM members WHERE id = ? AND household_id = ?", [
    memberId,
    actor.householdId,
  ]);
  if (!member) throw new NotFoundError("Member not found.");
  const isSelf = member.id === actor.id;
  if (!isSelf && !can(actor, "members.manage")) {
    throw new ForbiddenError("Only household administrators can edit other profiles.");
  }
  if ((input.role || input.isAdmin !== undefined || input.permissionOverrides) && !can(actor, "members.manage")) {
    throw new ForbiddenError("Only household administrators can change roles and permissions.");
  }
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
    } catch {
      throw new ValidationError("Unknown time zone.");
    }
  }
  run(
    `UPDATE members SET name = ?, color = ?, avatar = ?, relationship = ?, birthday = ?, timezone = ?, locale = ?,
      notification_prefs_json = ?, permission_overrides_json = ?, role = ?, is_admin = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.name?.trim() || member.name,
      input.color ?? member.color,
      input.avatar ?? member.avatar,
      input.relationship !== undefined ? input.relationship : member.relationship,
      input.birthday !== undefined ? input.birthday : member.birthday,
      input.timezone ?? member.timezone,
      input.locale ?? member.locale,
      input.notificationPrefs !== undefined
        ? toJson(input.notificationPrefs)
        : member.notification_prefs_json,
      input.permissionOverrides !== undefined
        ? toJson(input.permissionOverrides)
        : member.permission_overrides_json,
      input.role ?? member.role,
      input.isAdmin !== undefined ? (input.isAdmin ? 1 : 0) : member.is_admin,
      nowIso(),
      member.id,
    ],
  );
  recordAudit(actor, "member.updated", "member", member.id);
  return get<MemberRow>("SELECT * FROM members WHERE id = ?", [member.id]) as MemberRow;
}

export function invitationPreview(token: string): {
  memberName: string;
  email: string | null;
  role: string;
  householdName: string;
  expiresAt: string;
} {
  const invitation = get<InvitationRow & { member_name: string | null; household_name: string }>(
    `SELECT i.*, m.name AS member_name, h.name AS household_name
     FROM invitations i
     JOIN households h ON h.id = i.household_id
     LEFT JOIN members m ON m.id = i.member_id
     WHERE i.token_hash = ? AND i.accepted_at IS NULL`,
    [sha256(token)],
  );
  if (!invitation) throw new ValidationError("This invitation is invalid or has already been used.");
  if (new Date(invitation.expires_at) < new Date()) throw new ValidationError("This invitation has expired.");
  return {
    memberName: invitation.member_name ?? "New member",
    email: invitation.email,
    role: invitation.role,
    householdName: invitation.household_name,
    expiresAt: invitation.expires_at,
  };
}

export type InvitationView = InvitationRow & { memberName: string | null; invitedByName: string };

export function listInvitations(actor: Actor): InvitationView[] {
  if (!can(actor, "members.manage")) throw new ForbiddenError("Only household administrators can invite people.");
  return all<InvitationView>(
    `SELECT i.*, m.name AS memberName, inviter.name AS invitedByName
     FROM invitations i
     LEFT JOIN members m ON m.id = i.member_id
     JOIN members inviter ON inviter.id = i.invited_by
     WHERE i.household_id = ? AND i.accepted_at IS NULL
     ORDER BY i.created_at DESC`,
    [actor.householdId],
  );
}

export function inviteMember(
  actor: Actor,
  input: { name: string; email: string; role: MemberRow["role"]; isAdmin?: boolean },
): { invitationId: string; token: string; memberId: string } {
  if (!can(actor, "members.manage")) throw new ForbiddenError("Only household administrators can invite people.");
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  if (input.role === "relative" && input.isAdmin) throw new ValidationError("Guests cannot be administrators.");
  const now = nowIso();
  const existing = get<MemberRow>("SELECT * FROM members WHERE lower(email) = ? AND deactivated_at IS NULL", [
    email,
  ]);
  if (existing?.password_hash) throw new ValidationError("That email already belongs to an active member.");

  let memberId: string;
  const name = input.name.trim() || email.split("@")[0];
  if (existing) {
    memberId = existing.id;
    run("UPDATE members SET name = ?, role = ?, is_admin = ?, updated_at = ? WHERE id = ?", [
      name,
      input.role,
      input.isAdmin ? 1 : 0,
      nowIso(),
      existing.id,
    ]);
    run("UPDATE invitations SET expires_at = ? WHERE member_id = ? AND accepted_at IS NULL", [
      nowIso(),
      existing.id,
    ]);
  } else {
    memberId = newId("mem");
    run(
      `INSERT INTO members (id, household_id, email, password_hash, name, color, avatar, role, relationship,
        timezone, locale, is_admin, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, '#64748b', '🙂', ?, NULL, ?, ?, ?, ?, ?)`,
      [
        memberId,
        actor.householdId,
        email,
        name,
        input.role,
        actor.timezone,
        actor.locale,
        input.isAdmin ? 1 : 0,
        now,
        now,
      ],
    );
    ensurePersonalCalendar(actor.householdId, memberId, name);
  }
  const token = randomToken(32);
  const invitationId = newId("inv");
  run(
    `INSERT INTO invitations (id, household_id, email, member_id, role, invited_by, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invitationId,
      actor.householdId,
      email,
      memberId,
      input.role,
      actor.id,
      sha256(token),
      new Date(Date.now() + 14 * 86_400_000).toISOString(),
      now,
    ],
  );
  recordAudit(actor, "member.invited", "member", memberId, { email, role: input.role });
  return { invitationId, token, memberId };
}

export function addFamilyMember(
  actor: Actor,
  input: { name: string; role: MemberRow["role"]; relationship?: string | null; birthday?: string | null; color?: string },
): MemberRow {
  if (!can(actor, "members.manage")) throw new ForbiddenError("Only household administrators can add members.");
  const name = input.name.trim();
  if (!name) throw new ValidationError("A member needs a name.");
  if (input.role === "parent" && !actor.isAdmin) throw new ForbiddenError("Only an administrator can add a parent.");
  const id = newId("mem");
  const now = nowIso();
  run(
    `INSERT INTO members (id, household_id, email, password_hash, name, color, avatar, role, relationship,
      timezone, locale, is_admin, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, ?, ?, '🙂', ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      actor.householdId,
      name,
      input.color ?? "#64748b",
      input.role,
      input.relationship ?? null,
      actor.timezone,
      actor.locale,
      now,
      now,
    ],
  );
  ensurePersonalCalendar(actor.householdId, id, name);
  recordAudit(actor, "member.added", "member", id, { name, role: input.role });
  return get<MemberRow>("SELECT * FROM members WHERE id = ?", [id]) as MemberRow;
}

export function acceptInvitation(token: string, password: string): { memberId: string; email: string | null } {
  checkRateLimit(`invite:${sha256(token).slice(0, 16)}`, 10, 3600);
  const invitation = get<InvitationRow>(
    "SELECT * FROM invitations WHERE token_hash = ? AND accepted_at IS NULL",
    [sha256(token)],
  );
  if (!invitation) throw new ValidationError("This invitation is invalid or has already been used.");
  if (new Date(invitation.expires_at) < new Date()) throw new ValidationError("This invitation has expired.");
  const member = invitation.member_id
    ? get<MemberRow>("SELECT * FROM members WHERE id = ?", [invitation.member_id])
    : undefined;
  if (!member) throw new ValidationError("This invitation is no longer valid.");
  const problems = passwordProblems(password);
  if (problems.length > 0) throw new ValidationError(`Password requirements: ${problems.join(", ")}.`);
  run("UPDATE members SET password_hash = ?, deactivated_at = NULL, updated_at = ? WHERE id = ?", [
    hashPassword(password),
    nowIso(),
    member.id,
  ]);
  run("UPDATE invitations SET accepted_at = ? WHERE id = ?", [nowIso(), invitation.id]);
  return { memberId: member.id, email: member.email };
}

export function deactivateMember(actor: Actor, memberId: string): void {
  if (!can(actor, "members.manage")) throw new ForbiddenError("Only household administrators can do that.");
  if (memberId === actor.id) throw new ValidationError("You cannot deactivate your own account.");
  const member = get<MemberRow>("SELECT * FROM members WHERE id = ? AND household_id = ?", [
    memberId,
    actor.householdId,
  ]);
  if (!member) throw new NotFoundError("Member not found.");
  run("UPDATE members SET deactivated_at = ?, updated_at = ? WHERE id = ?", [nowIso(), nowIso(), member.id]);
  revokeAllSessionsForMember(member.id);
  recordAudit(actor, "member.deactivated", "member", member.id, { name: member.name });
}

export function reactivateMember(actor: Actor, memberId: string): void {
  if (!can(actor, "members.manage")) throw new ForbiddenError("Only household administrators can do that.");
  run("UPDATE members SET deactivated_at = NULL, updated_at = ? WHERE id = ? AND household_id = ?", [
    nowIso(),
    memberId,
    actor.householdId,
  ]);
  recordAudit(actor, "member.reactivated", "member", memberId);
}

export function ensurePersonalCalendar(householdId: string, memberId: string, name: string): void {
  const existing = get<{ id: string }>(
    "SELECT id FROM calendars WHERE owner_member_id = ? AND scope = 'personal'",
    [memberId],
  );
  if (existing) return;
  run(
    `INSERT INTO calendars (id, household_id, name, color, scope, owner_member_id, kind, created_at)
     VALUES (?, ?, ?, '#0f766e', 'personal', ?, 'personal', ?)`,
    [newId("cal"), householdId, `${name}'s calendar`, memberId, nowIso()],
  );
}

export function listAuditLog(actor: Actor, limit = 100) {
  if (!can(actor, "audit.read")) throw new ForbiddenError("Only household administrators can read the audit log.");
  return all<{
    id: string;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    metadata_json: string;
    created_at: string;
    actor_name: string | null;
  }>(
    `SELECT a.*, m.name AS actor_name FROM audit_log a LEFT JOIN members m ON m.id = a.actor_member_id
     WHERE a.household_id = ? ORDER BY a.created_at DESC LIMIT ?`,
    [actor.householdId, limit],
  );
}

export function exportAccountData(actor: Actor): Record<string, unknown> {
  const member = get<MemberRow>("SELECT * FROM members WHERE id = ?", [actor.id]);
  const sessions = all("SELECT id, created_at, last_seen_at FROM sessions WHERE member_id = ?", [actor.id]);
  const events = all(
    "SELECT * FROM events WHERE created_by = ? OR id IN (SELECT event_id FROM event_participants WHERE member_id = ?)",
    [actor.id, actor.id],
  );
  const tasks = all("SELECT * FROM tasks WHERE assigned_member_id = ? OR created_by = ?", [actor.id, actor.id]);
  const notes = all("SELECT * FROM notes WHERE owner_member_id = ?", [actor.id]);
  const notifications = all("SELECT * FROM notifications WHERE member_id = ?", [actor.id]);
  const conversations = all("SELECT * FROM agent_conversations WHERE member_id = ?", [actor.id]);
  const messages = all(
    "SELECT m.* FROM agent_messages m JOIN agent_conversations c ON c.id = m.conversation_id WHERE c.member_id = ?",
    [actor.id],
  );
  recordAudit(actor, "account.exported", "member", actor.id);
  return {
    exportedAt: nowIso(),
    profile: member ? { ...member, password_hash: undefined, permission_overrides_json: undefined } : null,
    sessions,
    events,
    tasks,
    notes,
    notifications,
    conversations,
    messages,
  };
}

export function deleteOwnAccount(actor: Actor, password: string): void {
  const member = get<MemberRow>("SELECT * FROM members WHERE id = ?", [actor.id]);
  if (!member) throw new NotFoundError("Member not found.");
  if (!verifyPassword(password, member.password_hash)) throw new ValidationError("Password is incorrect.");
  if (member.is_admin === 1) {
    const otherAdmins = get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM members WHERE household_id = ? AND is_admin = 1 AND deactivated_at IS NULL AND id != ?",
      [actor.householdId, actor.id],
    );
    if ((otherAdmins?.count ?? 0) === 0) {
      throw new ValidationError("Add another administrator before deleting this account.");
    }
  }
  recordAudit(actor, "account.deleted", "member", actor.id);
  // Anonymise instead of hard-deleting so household history keeps referential
  // integrity while the person loses all access and personal data.
  run(
    `UPDATE members SET email = NULL, password_hash = NULL, name = 'Deleted member', avatar = '👤',
      relationship = NULL, birthday = NULL, notification_prefs_json = '{}', permission_overrides_json = '{}',
      dashboard_prefs_json = '{}', deactivated_at = ?, updated_at = ? WHERE id = ?`,
    [nowIso(), nowIso(), actor.id],
  );
  revokeAllSessionsForMember(actor.id);
}

export function createHouseholdWithAdmin(input: {
  householdName: string;
  name: string;
  email: string;
  password: string;
  timezone?: string;
  locale?: string;
}): { memberId: string; householdId: string } {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  const problems = passwordProblems(input.password);
  if (problems.length > 0) throw new ValidationError(`Password requirements: ${problems.join(", ")}.`);
  const existing = get<MemberRow>("SELECT * FROM members WHERE lower(email) = ? AND deactivated_at IS NULL", [
    email,
  ]);
  if (existing) throw new ValidationError("An account with that email already exists.");
  const householdId = newId("hsh");
  const memberId = newId("mem");
  const now = nowIso();
  const timezone = input.timezone || "Europe/Sofia";
  const locale = input.locale === "bg" ? "bg" : "en";
  run("INSERT INTO households (id, name, timezone, locale, created_at) VALUES (?, ?, ?, ?, ?)", [
    householdId,
    input.householdName.trim() || `${input.name}'s family`,
    timezone,
    locale,
    now,
  ]);
  run(
    `INSERT INTO members (id, household_id, email, password_hash, name, color, avatar, role, relationship,
      timezone, locale, is_admin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '#0f766e', '🏠', 'parent', 'Parent', ?, ?, 1, ?, ?)`,
    [memberId, householdId, email, hashPassword(input.password), input.name.trim(), timezone, locale, now, now],
  );
  run(
    `INSERT INTO calendars (id, household_id, name, color, scope, owner_member_id, kind, created_at)
     VALUES (?, ?, 'Family', '#0f766e', 'shared', NULL, 'family', ?)`,
    [newId("cal"), householdId, now],
  );
  ensurePersonalCalendar(householdId, memberId, input.name.trim());
  run(
    "INSERT INTO shopping_lists (id, household_id, name, store, created_by, created_at) VALUES (?, ?, 'Groceries', NULL, ?, ?)",
    [newId("lst"), householdId, memberId, now],
  );
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
      "INSERT INTO integrations (id, household_id, kind, status, display_name, config_json, created_at) VALUES (?, ?, ?, 'disabled', ?, '{}', ?)",
      [newId("int"), householdId, kind, display, now],
    );
  }
  return { memberId, householdId };
}

export function loginWithPassword(
  email: string,
  password: string,
  userAgent?: string | null,
): { token: string; memberId: string; expiresAt: string } {
  const normalized = email.trim().toLowerCase();
  checkRateLimit(`login:${normalized}`, 10, 900);
  const member = get<MemberRow & { household_id: string }>(
    "SELECT * FROM members WHERE lower(email) = ? AND deactivated_at IS NULL",
    [normalized],
  );
  if (!member || !member.password_hash || !verifyPassword(password, member.password_hash)) {
    throw new ValidationError("Wrong email or password.");
  }
  const session = createSession(member.id, userAgent);
  recordAudit({ id: member.id, householdId: member.household_id }, "auth.login", "member", member.id);
  return { token: session.token, memberId: member.id, expiresAt: session.expiresAt };
}

export function requestPasswordReset(email: string): { token: string | null; memberId: string | null } {  const normalized = email.trim().toLowerCase();
  checkRateLimit(`reset:${normalized}`, 5, 3600);
  const member = get<MemberRow>("SELECT * FROM members WHERE lower(email) = ? AND deactivated_at IS NULL", [
    normalized,
  ]);
  if (!member) {
    // Do not reveal whether the account exists.
    return { token: null, memberId: null };
  }
  const token = randomToken(32);
  run(
    "INSERT INTO password_reset_tokens (id, member_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    [newId("prt"), member.id, sha256(token), new Date(Date.now() + 3_600_000).toISOString(), nowIso()],
  );
  return { token, memberId: member.id };
}

export function resetPassword(token: string, password: string): void {
  checkRateLimit(`reset-token:${sha256(token).slice(0, 16)}`, 10, 3600);
  const record = get<{ id: string; member_id: string; expires_at: string; used_at: string | null }>(
    "SELECT * FROM password_reset_tokens WHERE token_hash = ?",
    [sha256(token)],
  );
  if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
    throw new ValidationError("This reset link is invalid or has expired.");
  }
  const problems = passwordProblems(password);
  if (problems.length > 0) throw new ValidationError(`Password requirements: ${problems.join(", ")}.`);
  run("UPDATE members SET password_hash = ?, updated_at = ? WHERE id = ?", [
    hashPassword(password),
    nowIso(),
    record.member_id,
  ]);
  run("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?", [nowIso(), record.id]);
  revokeAllSessionsForMember(record.member_id);
}

export function permissionOverridesOf(member: MemberRow): PermissionOverrides {
  return parseJson<PermissionOverrides>(member.permission_overrides_json, {});
}

export function updateIntegration(  actor: Actor,
  kind: string,
  input: { status: "disabled" | "configured" | "connected" | "error"; config?: Record<string, unknown> },
): void {
  if (!can(actor, "integrations.manage")) {
    throw new ForbiddenError("Only household administrators can change integrations.");
  }
  const integration = get<IntegrationRow>(
    "SELECT * FROM integrations WHERE household_id = ? AND kind = ?",
    [actor.householdId, kind],
  );
  if (!integration) throw new NotFoundError("Integration not found.");
  run("UPDATE integrations SET status = ?, config_json = ?, last_error = NULL WHERE id = ?", [
    input.status,
    toJson(input.config ?? {}),
    integration.id,
  ]);
  recordAudit(actor, "integration.updated", "integration", integration.id, { kind, status: input.status });
}

export function listIntegrations(actor: Actor): IntegrationRow[] {
  if (!can(actor, "integrations.manage")) {
    return [];
  }
  return all<IntegrationRow>(
    "SELECT * FROM integrations WHERE household_id = ? ORDER BY display_name",
    [actor.householdId],
  );
}

export function updateDashboardPrefs(actor: Actor, widgets: Record<string, boolean>): void {
  run("UPDATE members SET dashboard_prefs_json = ?, updated_at = ? WHERE id = ? AND household_id = ?", [
    toJson(widgets),
    nowIso(),
    actor.id,
    actor.householdId,
  ]);
  recordAudit(actor, "member.dashboard_prefs", "member", actor.id, { widgets });
}

export function createPasswordResetLink(actor: Actor, memberId: string): string {
  if (!can(actor, "members.manage")) {
    throw new ForbiddenError("Only household administrators can create reset links.");
  }
  const member = get<MemberRow>("SELECT * FROM members WHERE id = ? AND household_id = ?", [
    memberId,
    actor.householdId,
  ]);
  if (!member) throw new NotFoundError("Member not found.");
  if (!member.email || !member.password_hash) {
    throw new ValidationError("This member has no email sign-in account to reset.");
  }
  const token = randomToken(32);
  run(
    "INSERT INTO password_reset_tokens (id, member_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    [newId("prt"), member.id, sha256(token), new Date(Date.now() + 3_600_000).toISOString(), nowIso()],
  );
  recordAudit(actor, "member.reset_link_created", "member", member.id);
  return token;
}
