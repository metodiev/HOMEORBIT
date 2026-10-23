import { all, get, run } from "@/lib/db";
import type { HouseholdRow, MemberRow } from "@/lib/db/rows";
import { newId, nowIso, parseJson, randomToken, sha256 } from "@/lib/util/ids";
import type { Actor } from "./actor";
import { effectivePermissions, type PermissionOverrides } from "./permissions";

export const SESSION_COOKIE = "homeorbit_session";
export const SESSION_TTL_DAYS = 30;

type MemberWithHousehold = MemberRow & { household_name: string; household_timezone: string };

export function buildActor(member: MemberWithHousehold): Actor {
  const capabilities = effectivePermissions(
    member.role,
    member.is_admin === 1,
    parseJson<PermissionOverrides>(member.permission_overrides_json, {}),
  );
  return {
    id: member.id,
    householdId: member.household_id,
    householdName: member.household_name,
    householdTimezone: member.household_timezone,
    name: member.name,
    email: member.email,
    role: member.role,
    isAdmin: member.is_admin === 1,
    timezone: member.timezone,
    locale: member.locale,
    color: member.color,
    avatar: member.avatar,
    relationship: member.relationship,
    capabilities: [...capabilities],
  };
}

export function actorForMember(memberId: string): Actor | null {
  const member = get<MemberWithHousehold>(
    `SELECT m.*, h.name AS household_name, h.timezone AS household_timezone
     FROM members m JOIN households h ON h.id = m.household_id
     WHERE m.id = ? AND m.deactivated_at IS NULL`,
    [memberId],
  );
  return member ? buildActor(member) : null;
}

export function createSession(memberId: string, userAgent?: string | null): { token: string; expiresAt: string } {
  const token = randomToken(32);
  const issuedAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  run(
    `INSERT INTO sessions (id, member_id, token_hash, expires_at, created_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId("ses"), memberId, sha256(token), expiresAt, issuedAt, issuedAt, userAgent ?? null],
  );
  return { token, expiresAt };
}

export function actorForSessionToken(token: string | null | undefined): Actor | null {
  if (!token) return null;
  const row = get<MemberWithHousehold & { session_id: string; session_last_seen: string; session_expires_at: string }>(
    `SELECT m.*, h.name AS household_name, h.timezone AS household_timezone,
            s.id AS session_id, s.last_seen_at AS session_last_seen, s.expires_at AS session_expires_at
     FROM sessions s
     JOIN members m ON m.id = s.member_id
     JOIN households h ON h.id = m.household_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND m.deactivated_at IS NULL`,
    [sha256(token), nowIso()],
  );
  if (!row) return null;
  if (Date.now() - new Date(row.session_last_seen).getTime() > 3_600_000) {
    run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", [nowIso(), row.session_id]);
  }
  return buildActor(row);
}

export function revokeSession(token: string): void {
  run("DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
}

export function revokeAllSessionsForMember(memberId: string): void {
  run("DELETE FROM sessions WHERE member_id = ?", [memberId]);
}

export function activeMembers(householdId: string): MemberRow[] {
  return all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
    [householdId],
  );
}

export function getHousehold(householdId: string): HouseholdRow | undefined {
  return get<HouseholdRow>("SELECT * FROM households WHERE id = ?", [householdId]);
}
