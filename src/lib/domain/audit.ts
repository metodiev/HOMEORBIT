import { run } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { newId, nowIso, toJson } from "@/lib/util/ids";

export function recordAudit(
  actor: Pick<Actor, "id" | "householdId">,
  action: string,
  entityType?: string,
  entityId?: string,
  metadata: Record<string, unknown> = {},
): void {
  run(
    `INSERT INTO audit_log (id, household_id, actor_member_id, action, entity_type, entity_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId("aud"), actor.householdId, actor.id, action, entityType ?? null, entityId ?? null, toJson(metadata), nowIso()],
  );
}
