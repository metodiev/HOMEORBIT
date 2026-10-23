import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentActor } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { AppError, toErrorMessage } from "@/lib/errors";
import { enqueueImageJob, listImageJobs, imageQueueInfo, processImageQueue } from "@/lib/images/queue";
import { comfyuiConfigured } from "@/lib/images/comfyui";
import type { WorkflowOperation } from "@/lib/domain/image-workflows";

const bodySchema = z.object({
  operation: z.enum([
    "text_to_image",
    "image_to_image",
    "inpaint",
    "background_replace",
    "remove_object",
    "restore",
    "upscale",
  ]),
  prompt: z.string().min(1).max(3000),
  negativePrompt: z.string().max(1000).optional(),
  workflowId: z.string().optional(),
  sourceAssetId: z.string().optional(),
  params: z
    .object({
      width: z.number().int().min(256).max(2048).optional(),
      height: z.number().int().min(256).max(2048).optional(),
      steps: z.number().int().min(1).max(100).optional(),
      cfg: z.number().min(1).max(30).optional(),
      denoise: z.number().min(0.1).max(1).optional(),
      scale: z.number().min(1).max(8).optional(),
      seed: z.number().int().min(0).optional(),
      checkpoint: z.string().max(300).optional(),
      maskAssetId: z.string().optional(),
      albumId: z.string().optional(),
    })
    .optional(),
});

export async function GET(request: Request): Promise<Response> {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
  const jobs = listImageJobs(actor, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50);
  const queue = imageQueueInfo(actor);
  if (queue.queued > 0 && comfyuiConfigured()) void processImageQueue().catch(() => undefined);
  return NextResponse.json({ queue, jobs });
}

export async function POST(request: Request): Promise<Response> {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    checkRateLimit(`image-jobs:${actor.id}`, 20, 3600);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    }
    const body = parsed.data;
    const job = enqueueImageJob(actor, {
      operation: body.operation as WorkflowOperation,
      prompt: body.prompt,
      negativePrompt: body.negativePrompt,
      workflowId: body.workflowId,
      sourceAssetId: body.sourceAssetId,
      params: body.params,
    });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: toErrorMessage(error) }, { status });
  }
}
