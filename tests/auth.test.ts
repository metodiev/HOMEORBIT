import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupDb, freshDb } from "./helpers";
import {
  acceptInvitation,
  createHouseholdWithAdmin,
  createPasswordResetLink,
  deleteOwnAccount,
  inviteMember,
  loginWithPassword,
  requestPasswordReset,
  resetPassword,
} from "@/lib/domain/settings";
import { actorForSessionToken, actorForMember } from "@/lib/auth/session-store";
import { hashPassword, passwordProblems, verifyPassword } from "@/lib/auth/password";
import { AppError } from "@/lib/errors";
import { get } from "@/lib/db";
import type { InvitationRow, MemberRow } from "@/lib/db/rows";

describe("authentication and invitations", () => {
  let dbFile: string;
  let householdId: string;
  let memberId: string;
  let invitedMemberId: string;

  beforeAll(() => {
    dbFile = freshDb();
    const created = createHouseholdWithAdmin({
      householdName: "Auth Family",
      name: "Admin Person",
      email: "auth-admin@test.local",
      password: "OrbitTest123!",
      timezone: "Europe/Sofia",
      locale: "en",
    });
    householdId = created.householdId;
    memberId = created.memberId;
  });

  afterAll(() => cleanupDb(dbFile));

  it("hashes passwords with a salt and verifies them safely", () => {
    const hash = hashPassword("OrbitTest123!");
    expect(hash).toMatch(/^scrypt\$/);
    expect(verifyPassword("OrbitTest123!", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
    expect(passwordProblems("short")).not.toHaveLength(0);
  });

  it("rejects a wrong password and accepts the right one", () => {
    expect(() => loginWithPassword("auth-admin@test.local", "nope")).toThrow(AppError);
    const result = loginWithPassword("auth-admin@test.local", "OrbitTest123!");
    const actor = actorForSessionToken(result.token);
    expect(actor?.id).toBe(memberId);
  });

  it("runs the invitation and activation flow", () => {
    const adminActor = actorForMember(memberId)!;
    const invitation = inviteMember(adminActor, {
      name: "Invited Adult",
      email: "invited@test.local",
      role: "adult",
    });
    expect(invitation.token).toHaveLength(43);
    const accepted = acceptInvitation(invitation.token, "InvitedTest123!");
    invitedMemberId = accepted.memberId;
    expect(accepted.email).toBe("invited@test.local");
    const login = loginWithPassword("invited@test.local", "InvitedTest123!");
    expect(actorForSessionToken(login.token)?.householdId).toBe(householdId);
    const row = get<InvitationRow>("SELECT * FROM invitations WHERE id = ?", [invitation.invitationId]);
    expect(row?.accepted_at).toBeTruthy();
  });

  it("prevents duplicate active emails within the household", () => {
    const adminActor = actorForMember(memberId)!;
    expect(() =>
      inviteMember(adminActor, { name: "Duplicate", email: "invited@test.local", role: "adult" }),
    ).toThrow(AppError);
  });

  it("creates and consumes a password reset token", () => {
    const reset = requestPasswordReset("auth-admin@test.local");
    expect(reset.token).toBeTruthy();
    resetPassword(reset.token!, "NewOrbit123!");
    expect(() => loginWithPassword("auth-admin@test.local", "OrbitTest123!")).toThrow(AppError);
    expect(loginWithPassword("auth-admin@test.local", "NewOrbit123!").token).toBeTruthy();
    expect(() => resetPassword(reset.token!, "Another123!")).toThrow(AppError);
  });

  it("does not reveal whether an email exists", () => {
    const result = requestPasswordReset("missing@test.local");
    expect(result.token).toBeNull();
  });

  it("lets an administrator create a reset link for a member", () => {
    const adminActor = actorForMember(memberId)!;
    const token = createPasswordResetLink(adminActor, invitedMemberId);
    resetPassword(token, "MemberReset123!");
    expect(loginWithPassword("invited@test.local", "MemberReset123!").token).toBeTruthy();
    expect(() => createPasswordResetLink(actorForMember(invitedMemberId)!, memberId)).toThrow(AppError);
  });

  it("anonymises a deleted account and revokes access", () => {
    const invitedActor = actorForMember(invitedMemberId)!;
    deleteOwnAccount(invitedActor, "MemberReset123!");
    const row = get<MemberRow>("SELECT * FROM members WHERE id = ?", [invitedMemberId]);
    expect(row?.email).toBeNull();
    expect(row?.name).toBe("Deleted member");
    expect(row?.deactivated_at).toBeTruthy();
    expect(() => loginWithPassword("invited@test.local", "MemberReset123!")).toThrow(AppError);
  });
});
