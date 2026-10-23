import { all, get, run } from "@/lib/db";
import type { ImageWorkflowRow } from "@/lib/db/rows";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso } from "@/lib/util/ids";
import { parseWorkflowJson } from "@/lib/images/comfyui";
import { SAMPLE_WORKFLOWS, WORKFLOW_OPERATIONS, type WorkflowOperation } from "@/lib/images/samples";
import { recordAudit } from "@/lib/domain/audit";

export { WORKFLOW_OPERATIONS, type WorkflowOperation };

export function operationNeedsImage(operation: string): boolean {
  return operation !== "text_to_image";
}

export function listWorkflows(
  actor: Actor,
  options: { operation?: string; includeDisabled?: boolean } = {},
): ImageWorkflowRow[] {
  if (actor.role === "relative") return [];
  const canManage = can(actor, "household.manage");
  const params: unknown[] = [actor.householdId];
  let clause = "";
  if (options.operation) {
    clause += " AND operation = ?";
    params.push(options.operation);
  }
  if (!options.includeDisabled || !canManage) clause += " AND enabled = 1";
  return all<ImageWorkflowRow>(
    `SELECT * FROM image_workflows WHERE household_id = ?${clause} ORDER BY operation, name`,
    params,
  );
}

export function getWorkflow(actor: Actor, workflowId: string): ImageWorkflowRow {
  if (actor.role === "relative") throw new ForbiddenError("Guest accounts cannot use image workflows.");
  const workflow = get<ImageWorkflowRow>(
    "SELECT * FROM image_workflows WHERE id = ? AND household_id = ?",
    [workflowId, actor.householdId],
  );
  if (!workflow) throw new NotFoundError("Image workflow not found.");
  if (workflow.enabled !== 1 && !can(actor, "household.manage")) {
    throw new ForbiddenError("This workflow is disabled.");
  }
  return workflow;
}

export function pickWorkflow(actor: Actor, operation: string, workflowId?: string | null): ImageWorkflowRow {
  const workflow = workflowId
    ? getWorkflow(actor, workflowId)
    : get<ImageWorkflowRow>(
        "SELECT * FROM image_workflows WHERE household_id = ? AND operation = ? AND enabled = 1 ORDER BY created_at LIMIT 1",
        [actor.householdId, operation],
      );
  if (!workflow || workflow.enabled !== 1) {
    throw new ValidationError(
      "No enabled image workflow supports this operation. Ask a guardian to add one in Settings → Image workflows.",
    );
  }
  if (workflow.operation !== operation) {
    throw new ValidationError("The selected workflow does not support this operation.");
  }
  return workflow;
}

function assertCanManage(actor: Actor): void {
  if (!can(actor, "household.manage")) {
    throw new ForbiddenError("Only household administrators can manage image workflows.");
  }
}

export function createWorkflow(
  actor: Actor,
  input: {
    name: string;
    operation: WorkflowOperation;
    workflowJson: string;
    modelLabel?: string | null;
    description?: string | null;
    enabled?: boolean;
  },
): ImageWorkflowRow {
  assertCanManage(actor);
  const name = input.name.trim();
  if (!name) throw new ValidationError("A workflow needs a name.");
  if (!WORKFLOW_OPERATIONS.some((entry) => entry.value === input.operation)) {
    throw new ValidationError("Unknown workflow operation.");
  }
  const workflow = parseWorkflowJson(input.workflowJson);
  const id = newId("wfl");
  run(
    `INSERT INTO image_workflows (id, household_id, name, provider, operation, workflow_json, model_label, description,
      enabled, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'comfyui', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      actor.householdId,
      name,
      input.operation,
      JSON.stringify(workflow),
      input.modelLabel ?? null,
      input.description ?? null,
      input.enabled === false ? 0 : 1,
      actor.id,
      nowIso(),
      nowIso(),
    ],
  );
  recordAudit(actor, "image_workflow.created", "image_workflow", id, {
    operation: input.operation,
    name,
  });
  return get<ImageWorkflowRow>("SELECT * FROM image_workflows WHERE id = ?", [id]) as ImageWorkflowRow;
}

export function updateWorkflow(
  actor: Actor,
  workflowId: string,
  input: {
    name?: string;
    workflowJson?: string;
    modelLabel?: string | null;
    description?: string | null;
    enabled?: boolean;
    operation?: WorkflowOperation;
  },
): ImageWorkflowRow {
  assertCanManage(actor);
  const workflow = getWorkflow(actor, workflowId);
  if (input.operation && !WORKFLOW_OPERATIONS.some((entry) => entry.value === input.operation)) {
    throw new ValidationError("Unknown workflow operation.");
  }
  const parsed = input.workflowJson !== undefined ? parseWorkflowJson(input.workflowJson) : null;
  run(
    `UPDATE image_workflows SET name = ?, operation = ?, workflow_json = ?, model_label = ?, description = ?,
      enabled = ?, updated_at = ? WHERE id = ?`,
    [
      input.name?.trim() || workflow.name,
      input.operation ?? workflow.operation,
      parsed ? JSON.stringify(parsed) : workflow.workflow_json,
      input.modelLabel !== undefined ? input.modelLabel : workflow.model_label,
      input.description !== undefined ? input.description : workflow.description,
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : workflow.enabled,
      nowIso(),
      workflow.id,
    ],
  );
  recordAudit(actor, "image_workflow.updated", "image_workflow", workflow.id, { enabled: input.enabled });
  return get<ImageWorkflowRow>("SELECT * FROM image_workflows WHERE id = ?", [workflow.id]) as ImageWorkflowRow;
}

export function deleteWorkflow(actor: Actor, workflowId: string): void {
  assertCanManage(actor);
  const workflow = getWorkflow(actor, workflowId);
  run("DELETE FROM image_workflows WHERE id = ?", [workflow.id]);
  recordAudit(actor, "image_workflow.deleted", "image_workflow", workflow.id);
}

export function installSampleWorkflow(actor: Actor, sampleId: string): ImageWorkflowRow {
  assertCanManage(actor);
  const sample = SAMPLE_WORKFLOWS.find((entry) => entry.id === sampleId);
  if (!sample) throw new ValidationError("Unknown sample workflow.");
  const existing = get<ImageWorkflowRow>(
    "SELECT * FROM image_workflows WHERE household_id = ? AND name = ?",
    [actor.householdId, sample.name],
  );
  if (existing) return existing;
  return createWorkflow(actor, {
    name: sample.name,
    operation: sample.operation,
    workflowJson: JSON.stringify(sample.workflow),
    modelLabel: sample.modelLabel,
    description: sample.description,
    enabled: false,
  });
}

export function sampleWorkflowList(): typeof SAMPLE_WORKFLOWS {
  return SAMPLE_WORKFLOWS;
}
