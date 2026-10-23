import { all, get, run } from "@/lib/db";
import type { MemberRow, PackageRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso } from "@/lib/util/ids";
import { notifyHousehold, notifyMember } from "./notifications";
import { recordAudit } from "./audit";

export type PackageView = PackageRow & {
  recipientName: string | null;
  collectorName: string | null;
  recipientColor: string | null;
  collectorColor: string | null;
};

export type PackageStatus = PackageRow["status"];

const PACKAGE_STATUSES: PackageStatus[] = [
  "expected",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "collected",
  "missed",
  "returned",
];

export function listPackages(actor: Actor, options: { includeDone?: boolean } = {}): PackageView[] {
  if (actor.role === "relative") return [];
  const clause = options.includeDone ? "" : " AND p.status NOT IN ('delivered','collected','returned')";
  return all<PackageView>(
    `SELECT p.*, rc.name AS recipientName, rc.color AS recipientColor,
            cl.name AS collectorName, cl.color AS collectorColor
     FROM packages p
     LEFT JOIN members rc ON rc.id = p.recipient_member_id
     LEFT JOIN members cl ON cl.id = p.collector_member_id
     WHERE p.household_id = ?${clause}
     ORDER BY CASE WHEN p.deadline IS NULL THEN 1 ELSE 0 END, p.deadline, p.expected_to`,
    [actor.householdId],
  );
}

export function getPackage(actor: Actor, packageId: string): PackageView {
  if (actor.role === "relative") throw new ForbiddenError("Deliveries are not available to guest accounts.");
  const row = get<PackageView>(
    `SELECT p.*, rc.name AS recipientName, rc.color AS recipientColor,
            cl.name AS collectorName, cl.color AS collectorColor
     FROM packages p
     LEFT JOIN members rc ON rc.id = p.recipient_member_id
     LEFT JOIN members cl ON cl.id = p.collector_member_id
     WHERE p.id = ? AND p.household_id = ?`,
    [packageId, actor.householdId],
  );
  if (!row) throw new NotFoundError("Package not found.");
  return row;
}

export type PackageInput = {
  description: string;
  merchant?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  trackingUrl?: string | null;
  expectedFrom?: string | null;
  expectedTo?: string | null;
  recipientMemberId?: string | null;
  collectorMemberId?: string | null;
  instructions?: string | null;
  pickupPoint?: string | null;
  collectionCode?: string | null;
  deadline?: string | null;
};

function assertMember(actor: Actor, memberId: string | null | undefined): void {
  if (!memberId) return;
  const member = get<MemberRow>(
    "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
    [memberId, actor.householdId],
  );
  if (!member) throw new ValidationError("That family member does not exist.");
}

export function createPackage(actor: Actor, input: PackageInput): PackageRow {
  if (!can(actor, "package.manage")) throw new ForbiddenError("Your role cannot add packages.");
  const description = input.description.trim();
  if (!description) throw new ValidationError("A package needs a description.");
  assertMember(actor, input.recipientMemberId);
  assertMember(actor, input.collectorMemberId);
  const id = newId("pkg");
  run(
    `INSERT INTO packages
      (id, household_id, description, merchant, tracking_number, carrier, tracking_url, expected_from, expected_to,
       status, recipient_member_id, collector_member_id, instructions, pickup_point, collection_code, deadline,
       created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'expected', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      actor.householdId,
      description,
      input.merchant ?? null,
      input.trackingNumber ?? null,
      input.carrier ?? null,
      input.trackingUrl ?? null,
      input.expectedFrom ?? null,
      input.expectedTo ?? null,
      input.recipientMemberId ?? actor.id,
      input.collectorMemberId ?? null,
      input.instructions ?? null,
      input.pickupPoint ?? null,
      input.collectionCode ?? null,
      input.deadline ?? null,
      actor.id,
      nowIso(),
      nowIso(),
    ],
  );
  recordAudit(actor, "package.created", "package", id, { description });
  if (input.collectorMemberId && input.collectorMemberId !== actor.id) {
    const collector = get<MemberRow>("SELECT * FROM members WHERE id = ?", [input.collectorMemberId]);
    if (collector) {
      notifyMember(collector, {
        title: `Collection needed: ${description}`,
        body: input.instructions ?? `${actor.name} asked you to receive or collect this package.`,
        category: "packages",
        dedupeKey: `package-collect:${id}:${collector.id}`,
        link: "/deliveries",
      });
    }
  }
  return get<PackageRow>("SELECT * FROM packages WHERE id = ?", [id]) as PackageRow;
}

export function updatePackage(actor: Actor, packageId: string, input: Partial<PackageInput>): PackageRow {
  if (!can(actor, "package.manage")) throw new ForbiddenError("Your role cannot change packages.");
  const pkg = getPackage(actor, packageId);
  assertMember(actor, input.recipientMemberId);
  assertMember(actor, input.collectorMemberId);
  const collectorChanged =
    input.collectorMemberId !== undefined && input.collectorMemberId !== pkg.collector_member_id;
  run(
    `UPDATE packages SET description = ?, merchant = ?, tracking_number = ?, carrier = ?, tracking_url = ?,
      expected_from = ?, expected_to = ?, recipient_member_id = ?, collector_member_id = ?, instructions = ?,
      pickup_point = ?, collection_code = ?, deadline = ?, updated_at = ? WHERE id = ?`,
    [
      input.description?.trim() || pkg.description,
      input.merchant !== undefined ? input.merchant : pkg.merchant,
      input.trackingNumber !== undefined ? input.trackingNumber : pkg.tracking_number,
      input.carrier !== undefined ? input.carrier : pkg.carrier,
      input.trackingUrl !== undefined ? input.trackingUrl : pkg.tracking_url,
      input.expectedFrom !== undefined ? input.expectedFrom : pkg.expected_from,
      input.expectedTo !== undefined ? input.expectedTo : pkg.expected_to,
      input.recipientMemberId !== undefined ? input.recipientMemberId : pkg.recipient_member_id,
      input.collectorMemberId !== undefined ? input.collectorMemberId : pkg.collector_member_id,
      input.instructions !== undefined ? input.instructions : pkg.instructions,
      input.pickupPoint !== undefined ? input.pickupPoint : pkg.pickup_point,
      input.collectionCode !== undefined ? input.collectionCode : pkg.collection_code,
      input.deadline !== undefined ? input.deadline : pkg.deadline,
      nowIso(),
      pkg.id,
    ],
  );
  recordAudit(actor, "package.updated", "package", pkg.id);
  if (collectorChanged && input.collectorMemberId) {
    const collector = get<MemberRow>("SELECT * FROM members WHERE id = ?", [input.collectorMemberId]);
    if (collector && collector.id !== actor.id) {
      notifyMember(collector, {
        title: `Collection needed: ${pkg.description}`,
        body: `${actor.name} asked you to receive or collect this package.`,
        category: "packages",
        urgency: "high",
        dedupeKey: `package-collect:${pkg.id}:${collector.id}:${nowIso()}`,
        link: "/deliveries",
      });
    }
  }
  return get<PackageRow>("SELECT * FROM packages WHERE id = ?", [pkg.id]) as PackageRow;
}

export function setPackageStatus(
  actor: Actor,
  packageId: string,
  status: PackageStatus,
  note?: string,
): PackageRow {
  if (!can(actor, "package.manage")) throw new ForbiddenError("Your role cannot change packages.");
  if (!PACKAGE_STATUSES.includes(status)) throw new ValidationError("Unknown package status.");
  const pkg = getPackage(actor, packageId);
  run("UPDATE packages SET status = ?, updated_at = ? WHERE id = ?", [status, nowIso(), pkg.id]);
  run(
    "INSERT INTO package_updates (id, package_id, status, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [newId("pup"), pkg.id, status, note ?? null, actor.id, nowIso()],
  );
  recordAudit(actor, "package.status", "package", pkg.id, { status, note: note ?? null, reportedNotVerified: true });
  notifyHousehold(
    actor.householdId,
    {
      title: `Package ${status.replace(/_/g, " ")}: ${pkg.description}`,
      body: `${actor.name} updated the status${note ? `: ${note}` : "."}`,
      category: "packages",
      dedupeKey: `package-status:${pkg.id}:${status}:${nowIso().slice(0, 13)}`,
      link: "/deliveries",
    },
    { excludeMemberId: actor.id },
  );
  return get<PackageRow>("SELECT * FROM packages WHERE id = ?", [pkg.id]) as PackageRow;
}

export function packageHistory(actor: Actor, packageId: string) {
  const pkg = getPackage(actor, packageId);
  return all<{ id: string; status: string; note: string | null; created_at: string; member_name: string }>(
    `SELECT pu.id, pu.status, pu.note, pu.created_at, m.name AS member_name
     FROM package_updates pu JOIN members m ON m.id = pu.created_by
     WHERE pu.package_id = ? ORDER BY pu.created_at DESC`,
    [pkg.id],
  );
}

export function packagesNeedingAttention(actor: Actor): PackageView[] {
  const now = nowIso();
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  return listPackages(actor).filter(
    (pkg) =>
      (pkg.deadline && pkg.deadline <= soon && pkg.deadline >= now) ||
      (pkg.expected_to && pkg.expected_to.slice(0, 10) <= soon.slice(0, 10)),
  );
}
