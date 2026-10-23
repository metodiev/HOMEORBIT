import { all, get, getDb, run } from "@/lib/db";
import type { ImageJobRow, ImageWorkflowRow, MediaAssetRow } from "@/lib/db/rows";
import type { Actor } from "@/lib/auth/actor";
import { actorForMember } from "@/lib/auth/session-store";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso, parseJson, toJson } from "@/lib/util/ids";
import { recordAudit } from "@/lib/domain/audit";
import { canViewAsset, createDerivedAsset, storageUsage } from "@/lib/domain/media";
import { readStoredFile } from "@/lib/media/storage";
import {
  applyWorkflowTemplate,
  comfyuiConfigured,
  comfyuiTimeoutMs,
  downloadComfyImage,
  historyImages,
  queuePosition,
  submitWorkflow,
  uploadImageToComfyui,
  type WorkflowValues,
} from "@/lib/images/comfyui";
import { operationNeedsImage, pickWorkflow, type WorkflowOperation } from "@/lib/domain/image-workflows";

export type ImageJobParams = {
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  denoise?: number;
  seed?: number;
  checkpoint?: string;
  scale?: number;
  albumId?: string | null;
  library?: "studio" | "photos";
  maskAssetId?: string | null;
  model?: string | null;
};

export type ImageJobView = ImageJobRow & {
  workflowName: string | null;
  resultUrl: string | null;
  sourceUrl: string | null;
  computedQueuePosition: number | null;
};

const ACTIVE_STATUSES = ["queued", "running"];

export function imageQueueInfo(actor: Actor): { queued: number; running: number; comfyuiConfigured: boolean } {
  const row = get<{ queued: number; running: number }>(
    `SELECT
       SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
       SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
     FROM image_jobs WHERE household_id = ?`,
    [actor.householdId],
  );
  return {
    queued: row?.queued ?? 0,
    running: row?.running ?? 0,
    comfyuiConfigured: comfyuiConfigured(),
  };
}

export function listImageJobs(actor: Actor, limit = 100): ImageJobView[] {
  const rows = all<ImageJobRow>(
    "SELECT * FROM image_jobs WHERE household_id = ? AND member_id = ? ORDER BY created_at DESC LIMIT ?",
    [actor.householdId, actor.id, limit],
  );
  const queuedOrder = all<{ id: string }>(
    "SELECT id FROM image_jobs WHERE status = 'queued' ORDER BY created_at",
  ).map((entry) => entry.id);
  return rows.map((job) => {
    const workflow = job.workflow_id
      ? get<ImageWorkflowRow>("SELECT * FROM image_workflows WHERE id = ?", [job.workflow_id])
      : undefined;
    const result = job.result_asset_id
      ? get<MediaAssetRow>("SELECT * FROM media_assets WHERE id = ? AND deleted_at IS NULL", [job.result_asset_id])
      : undefined;
    const source = job.source_asset_id
      ? get<MediaAssetRow>("SELECT * FROM media_assets WHERE id = ? AND deleted_at IS NULL", [job.source_asset_id])
      : undefined;
    return {
      ...job,
      workflowName: workflow?.name ?? null,
      resultUrl: result ? `/api/media/${result.id}` : null,
      sourceUrl: source ? `/api/media/${source.id}` : null,
      computedQueuePosition:
        job.status === "running" ? 0 : job.status === "queued" ? queuedOrder.indexOf(job.id) + 1 : null,
    };
  });
}

export function getImageJob(actor: Actor, jobId: string): ImageJobView {
  const job = get<ImageJobRow>("SELECT * FROM image_jobs WHERE id = ? AND household_id = ? AND member_id = ?", [
    jobId,
    actor.householdId,
    actor.id,
  ]);
  if (!job) throw new NotFoundError("Image job not found.");
  return listImageJobs(actor, 500).find((entry) => entry.id === job.id) ?? {
    ...job,
    workflowName: null,
    resultUrl: job.result_asset_id ? `/api/media/${job.result_asset_id}` : null,
    sourceUrl: job.source_asset_id ? `/api/media/${job.source_asset_id}` : null,
    computedQueuePosition: null,
  };
}

export function enqueueImageJob(
  actor: Actor,
  input: {
    operation: WorkflowOperation;
    prompt: string;
    negativePrompt?: string;
    workflowId?: string | null;
    sourceAssetId?: string | null;
    params?: ImageJobParams;
  },
): ImageJobRow {
  if (actor.role === "relative") throw new ForbiddenError("Guest accounts cannot create images.");
  if (!comfyuiConfigured()) {
    throw new ValidationError(
      "ComfyUI is not configured yet. Set COMFYUI_URL on the server and add an image workflow in Settings.",
    );
  }
  const prompt = input.prompt.trim();
  if (!prompt) throw new ValidationError("Describe what you want to generate or change.");
  if (prompt.length > 3000) throw new ValidationError("Prompts are limited to 3000 characters.");
  if ((input.negativePrompt?.length ?? 0) > 1000) {
    throw new ValidationError("Negative prompts are limited to 1000 characters.");
  }
  const clampInt = (value: number | undefined, min: number, max: number, fallback: number): number => {
    if (value === undefined || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  };
  const clampNumber = (value: number | undefined, min: number, max: number, fallback: number): number => {
    if (value === undefined || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  };
  const workflow = pickWorkflow(actor, input.operation, input.workflowId);
  if (workflow.operation !== input.operation) {
    throw new ValidationError("The selected workflow does not support this operation.");
  }
  if (operationNeedsImage(input.operation) && !input.sourceAssetId) {
    throw new ValidationError("Choose a source image for this edit.");
  }
  let source: MediaAssetRow | null = null;
  if (input.sourceAssetId) {
    source =
      get<MediaAssetRow>("SELECT * FROM media_assets WHERE id = ? AND household_id = ?", [
        input.sourceAssetId,
        actor.householdId,
      ]) ?? null;
    if (!source || !canViewAsset(actor, source)) throw new NotFoundError("Source image not found.");
  }
  const params: ImageJobParams = {
    width: clampInt(input.params?.width, 256, 2048, 1024),
    height: clampInt(input.params?.height, 256, 2048, 1024),
    steps: clampInt(input.params?.steps, 1, 100, 25),
    cfg: clampNumber(input.params?.cfg, 1, 30, 7),
    denoise: clampNumber(input.params?.denoise, 0.1, 1, input.operation === "image_to_image" ? 0.65 : 1),
    scale: clampNumber(input.params?.scale, 1, 8, 2),
    seed: clampInt(input.params?.seed, 0, 2_147_483_647, Math.floor(Math.random() * 2_147_483_647)),
    checkpoint: input.params?.checkpoint?.trim().slice(0, 300) || undefined,
    albumId: input.params?.albumId ?? null,
    library: input.params?.library === "photos" ? "photos" : "studio",
    maskAssetId: input.params?.maskAssetId ?? null,
    model: input.params?.model?.trim().slice(0, 300) || null,
  };
  if (params.maskAssetId) {
    const mask = get<MediaAssetRow>("SELECT * FROM media_assets WHERE id = ? AND household_id = ?", [
      params.maskAssetId,
      actor.householdId,
    ]);
    if (!mask || !canViewAsset(actor, mask)) throw new NotFoundError("Mask image not found.");
  }
  const usage = storageUsage(actor);
  if (usage.usedBytes >= usage.quotaBytes) throw new ValidationError("Storage quota exceeded.");
  const id = newId("job");
  run(
    `INSERT INTO image_jobs (id, household_id, member_id, provider, workflow_id, operation, prompt, negative_prompt,
      status, progress, source_asset_id, params_json, created_at, queue_position)
     VALUES (?, ?, ?, 'comfyui', ?, ?, ?, ?, 'queued', 0, ?, ?, ?, NULL)`,
    [
      id,
      actor.householdId,
      actor.id,
      workflow.id,
      input.operation,
      prompt,
      input.negativePrompt?.trim() || null,
      source?.id ?? null,
      toJson(params),
      nowIso(),
    ],
  );
  recordAudit(actor, "image.job_queued", "image_job", id, {
    operation: input.operation,
    workflowId: workflow.id,
    sourceAssetId: source?.id ?? null,
  });
  void processImageQueue().catch(() => undefined);
  return get<ImageJobRow>("SELECT * FROM image_jobs WHERE id = ?", [id]) as ImageJobRow;
}

export function cancelImageJob(actor: Actor, jobId: string): void {
  const job = get<ImageJobRow>("SELECT * FROM image_jobs WHERE id = ? AND household_id = ? AND member_id = ?", [
    jobId,
    actor.householdId,
    actor.id,
  ]);
  if (!job) throw new NotFoundError("Image job not found.");
  if (!ACTIVE_STATUSES.includes(job.status)) throw new ValidationError("This job has already finished.");
  if (job.status === "running") {
    throw new ValidationError("A running ComfyUI job cannot be cancelled safely from HomeOrbit.");
  }
  run("UPDATE image_jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'", [
    nowIso(),
    job.id,
  ]);
  recordAudit(actor, "image.job_cancelled", "image_job", job.id);
}

let queueProcessing = false;

function claimNextJob(): ImageJobRow | null {
  const db = getDb();
  return db.transaction(() => {
    const candidate = db
      .prepare("SELECT * FROM image_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1")
      .get() as ImageJobRow | undefined;
    if (!candidate) return null;
    const result = db
      .prepare("UPDATE image_jobs SET status = 'running', started_at = ?, progress = 5 WHERE id = ? AND status = 'queued'")
      .run(nowIso(), candidate.id);
    if (result.changes !== 1) return null;
    return db.prepare("SELECT * FROM image_jobs WHERE id = ?").get(candidate.id) as ImageJobRow;
  })();
}

/** Serial queue: only one ComfyUI job runs at a time, regardless of household. */
export async function processImageQueue(runner: (job: ImageJobRow) => Promise<void> = runImageJob): Promise<void> {
  if (queueProcessing) return;
  queueProcessing = true;
  try {
    for (;;) {
      const job = claimNextJob();
      if (!job) break;
      try {
        await runner(job);
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 800) : "Image job failed.";
        run(
          "UPDATE image_jobs SET status = 'failed', error = ?, finished_at = ?, progress = 100 WHERE id = ? AND status = 'running'",
          [message, nowIso(), job.id],
        );
      }
    }
  } finally {
    queueProcessing = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runImageJob(job: ImageJobRow): Promise<void> {
  const actor = actorForMember(job.member_id);
  if (!actor) throw new Error("The image owner is no longer an active member.");
  const workflow = job.workflow_id
    ? get<ImageWorkflowRow>("SELECT * FROM image_workflows WHERE id = ? AND household_id = ?", [
        job.workflow_id,
        job.household_id,
      ])
    : undefined;
  if (!workflow) throw new Error("The image workflow was deleted.");
  const template = parseJson<Record<string, unknown>>(workflow.workflow_json, {});
  const params = parseJson<ImageJobParams>(job.params_json, {});

  let imageName: string | undefined;
  if (job.source_asset_id) {
    const source = get<MediaAssetRow>("SELECT * FROM media_assets WHERE id = ? AND household_id = ?", [
      job.source_asset_id,
      job.household_id,
    ]);
    if (!source || !canViewAsset(actor, source) || source.deleted_at) {
      throw new Error("The source image is no longer available.");
    }
    const buffer = await readStoredFile(source.storage_path);
    const extension =
      source.mime_type === "image/jpeg" ? "jpg" : source.mime_type.split("/")[1]?.replace("+xml", "") || "png";
    imageName = await uploadImageToComfyui(buffer, `homeorbit-source.${extension}`);
    run("UPDATE image_jobs SET progress = 15 WHERE id = ?", [job.id]);
  }
  let maskName: string | undefined;
  if (params.maskAssetId) {
    const mask = get<MediaAssetRow>("SELECT * FROM media_assets WHERE id = ? AND household_id = ?", [
      params.maskAssetId,
      job.household_id,
    ]);
    if (!mask || !canViewAsset(actor, mask) || mask.deleted_at) throw new Error("The mask image is no longer available.");
    const maskExtension = mask.mime_type === "image/jpeg" ? "jpg" : mask.mime_type.split("/")[1]?.replace("+xml", "") || "png";
    maskName = await uploadImageToComfyui(await readStoredFile(mask.storage_path), `homeorbit-mask.${maskExtension}`);
  }

  const seed = params.seed ?? Math.floor(Math.random() * 2_147_483_647);
  const values: WorkflowValues = {
    PROMPT: job.prompt,
    NEGATIVE_PROMPT: job.negative_prompt ?? "",
    SEED: seed,
    WIDTH: params.width ?? 1024,
    HEIGHT: params.height ?? 1024,
    STEPS: params.steps ?? 25,
    CFG: params.cfg ?? 7,
    DENOISE: params.denoise ?? 1,
    SCALE: params.scale ?? 2,
    CHECKPOINT: params.checkpoint ?? process.env.COMFYUI_CHECKPOINT?.trim() ?? undefined,
    IMAGE: imageName,
    MASK: maskName,
    MODEL: params.model ?? process.env.COMFYUI_MODEL?.trim() ?? undefined,
  };
  const workflowJson = applyWorkflowTemplate(template, values) as Record<string, unknown>;
  const { promptId } = await submitWorkflow(workflowJson);
  run("UPDATE image_jobs SET external_job_id = ?, progress = 25 WHERE id = ?", [promptId, job.id]);
  recordAudit(actor, "image.job_submitted", "image_job", job.id, { promptId, workflow: workflow.name });

  const deadline = Date.now() + comfyuiTimeoutMs();
  let images: { filename: string; subfolder: string; type: string }[] = [];
  let polls = 0;
  while (Date.now() < deadline) {
    await sleep(polls === 0 ? 1000 : 2000);
    polls += 1;
    const history = await historyImages(promptId);
    if (history.error) throw new Error(history.error);
    if (history.done && history.images.length > 0) {
      images = history.images;
      break;
    }
    const position = await queuePosition(promptId);
    const progress = Math.min(90, 25 + Math.min(60, polls * 4));
    run("UPDATE image_jobs SET progress = ?, queue_position = ? WHERE id = ?", [progress, position, job.id]);
  }
  if (images.length === 0) throw new Error("ComfyUI did not finish the job before the timeout.");

  const buffer = await downloadComfyImage(images[0]);
  const result = await createDerivedAsset({
    actor,
    buffer,
    kind: job.operation === "text_to_image" ? "generated" : "edited",
    library: params.library ?? "studio",
    sourceAssetId: job.source_asset_id,
    prompt: job.prompt,
    workflowName: workflow.name,
    workflowId: workflow.id,
    provider: "comfyui",
    modelLabel: workflow.model_label,
    operation: job.operation,
    albumId: params.albumId ?? null,
    externalJobId: promptId,
  });
  run(
    "UPDATE image_jobs SET status = 'succeeded', progress = 100, result_asset_id = ?, finished_at = ?, queue_position = NULL WHERE id = ?",
    [result.id, nowIso(), job.id],
  );
  recordAudit(actor, "image.job_succeeded", "image_job", job.id, { resultAssetId: result.id });
}
