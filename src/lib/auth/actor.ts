import { ForbiddenError } from "@/lib/errors";
import type { Capability, MemberRole } from "./permissions";

export type Actor = {
  id: string;
  householdId: string;
  householdName: string;
  householdTimezone: string;
  name: string;
  email: string | null;
  role: MemberRole;
  isAdmin: boolean;
  timezone: string;
  locale: string;
  color: string;
  avatar: string;
  relationship: string | null;
  capabilities: Capability[];
};

export function can(actor: Actor, capability: Capability): boolean {
  return actor.capabilities.includes(capability);
}

export function requireCapability(actor: Actor, capability: Capability): void {
  if (!can(actor, capability)) {
    throw new ForbiddenError(`Your role does not allow: ${capability}.`);
  }
}
