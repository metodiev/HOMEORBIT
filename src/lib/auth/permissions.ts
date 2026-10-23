export type MemberRole = "parent" | "adult" | "teen" | "child" | "relative";

export type Capability =
  | "household.manage"
  | "members.manage"
  | "calendar.create"
  | "calendar.manage"
  | "event.create"
  | "event.manage_shared"
  | "event.rsvp"
  | "task.create"
  | "task.assign_others"
  | "shopping.manage"
  | "package.manage"
  | "call.manage"
  | "note.create_shared"
  | "note.read_sensitive"
  | "school.manage"
  | "trip.manage"
  | "meal.manage"
  | "agent.use"
  | "agent.approve"
  | "audit.read"
  | "integrations.manage";

export const ALL_CAPABILITIES: Capability[] = [
  "household.manage",
  "members.manage",
  "calendar.create",
  "calendar.manage",
  "event.create",
  "event.manage_shared",
  "event.rsvp",
  "task.create",
  "task.assign_others",
  "shopping.manage",
  "package.manage",
  "call.manage",
  "note.create_shared",
  "note.read_sensitive",
  "school.manage",
  "trip.manage",
  "meal.manage",
  "agent.use",
  "agent.approve",
  "audit.read",
  "integrations.manage",
];

const ROLE_CAPABILITIES: Record<MemberRole, Capability[]> = {
  parent: [...ALL_CAPABILITIES],
  adult: [
    "calendar.create",
    "calendar.manage",
    "event.create",
    "event.manage_shared",
    "event.rsvp",
    "task.create",
    "task.assign_others",
    "shopping.manage",
    "package.manage",
    "call.manage",
    "note.create_shared",
    "note.read_sensitive",
    "school.manage",
    "trip.manage",
    "meal.manage",
    "agent.use",
  ],
  teen: [
    "calendar.create",
    "event.create",
    "event.rsvp",
    "task.create",
    "shopping.manage",
    "note.create_shared",
    "meal.manage",
    "agent.use",
  ],
  child: ["event.create", "event.rsvp", "task.create", "shopping.manage", "agent.use"],
  relative: ["event.rsvp"],
};

export type PermissionOverrides = {
  grant?: Capability[];
  revoke?: Capability[];
};

export function permissionsForRole(role: MemberRole): Set<Capability> {
  return new Set(ROLE_CAPABILITIES[role] ?? ROLE_CAPABILITIES.child);
}

export function effectivePermissions(
  role: MemberRole,
  isAdmin: boolean,
  overrides: PermissionOverrides,
): Set<Capability> {
  const permissions = permissionsForRole(role);
  if (isAdmin && role === "parent") {
    for (const capability of ALL_CAPABILITIES) permissions.add(capability);
  }
  for (const capability of overrides.grant ?? []) permissions.add(capability);
  for (const capability of overrides.revoke ?? []) permissions.delete(capability);
  return permissions;
}
