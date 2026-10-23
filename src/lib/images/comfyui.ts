import crypto from "node:crypto";

export type WorkflowValues = Record<string, string | number | undefined>;

export function comfyuiBaseUrl(): string | null {
  const value = process.env.COMFYUI_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

export function comfyuiConfigured(): boolean {
  return Boolean(comfyuiBaseUrl());
}

export function comfyuiTimeoutMs(): number {
  const value = Number(process.env.COMFYUI_TIMEOUT_SECONDS);
  return (Number.isFinite(value) && value > 0 ? value : 300) * 1000;
}

async function comfyFetch(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
  const baseUrl = comfyuiBaseUrl();
  if (!baseUrl) throw new Error("ComfyUI is not configured. Set COMFYUI_URL on the server.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("ComfyUI timed out.");
    }
    throw new Error("ComfyUI is unreachable. Is the workflow engine running?");
  } finally {
    clearTimeout(timer);
  }
}

export async function comfyuiHealth(timeoutMs = 3000): Promise<{ available: boolean; error?: string; baseUrl: string | null }> {
  const baseUrl = comfyuiBaseUrl();
  if (!baseUrl) return { available: false, baseUrl, error: "COMFYUI_URL is not set." };
  try {
    const response = await comfyFetch("/system_stats", {}, timeoutMs);
    if (!response.ok) return { available: false, baseUrl, error: `ComfyUI responded ${response.status}.` };
    return { available: true, baseUrl };
  } catch (error) {
    return { available: false, baseUrl, error: error instanceof Error ? error.message : "Unreachable." };
  }
}

export async function uploadImageToComfyui(buffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  const type = filename.toLowerCase().endsWith(".jpg") || filename.toLowerCase().endsWith(".jpeg") ? "image/jpeg" : "image/png";
  form.append("image", new Blob([new Uint8Array(buffer)], { type }), filename);
  form.append("overwrite", "true");
  const response = await comfyFetch("/upload/image", { method: "POST", body: form }, 60_000);
  if (!response.ok) {
    throw new Error(`ComfyUI image upload failed (${response.status}).`);
  }
  const payload = (await response.json()) as { name?: string; subfolder?: string };
  if (!payload.name) throw new Error("ComfyUI did not return an uploaded image name.");
  return payload.subfolder ? `${payload.subfolder}/${payload.name}` : payload.name;
}

export type SubmitResult = { promptId: string };

export async function submitWorkflow(workflow: Record<string, unknown>): Promise<SubmitResult> {
  const response = await comfyFetch(
    "/prompt",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
    },
    60_000,
  );
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`ComfyUI rejected the workflow (${response.status})${detail ? `: ${detail}` : ""}.`);
  }
  const payload = (await response.json()) as { prompt_id?: string };
  if (!payload.prompt_id) throw new Error("ComfyUI did not return a prompt id.");
  return { promptId: payload.prompt_id };
}

export async function queuePosition(promptId: string): Promise<number | null> {
  try {
    const response = await comfyFetch("/queue", {}, 5000);
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      queue_running?: unknown[][];
      queue_pending?: unknown[][];
    };
    const running = payload.queue_running ?? [];
    const pending = payload.queue_pending ?? [];
    if (running.some((entry) => entry[1] === promptId)) return 0;
    const index = pending.findIndex((entry) => entry[1] === promptId);
    return index >= 0 ? index + 1 : null;
  } catch {
    return null;
  }
}

export type ComfyImageRef = { filename: string; subfolder: string; type: string };

export async function historyImages(promptId: string): Promise<{ done: boolean; images: ComfyImageRef[]; error?: string }> {
  const response = await comfyFetch(`/history/${encodeURIComponent(promptId)}`, {}, 10_000);
  if (!response.ok) return { done: false, images: [] };
  const payload = (await response.json()) as Record<
    string,
    {
      outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }>;
      status?: { status_str?: string; messages?: unknown[] };
    }
  >;
  const entry = payload[promptId];
  if (!entry) return { done: false, images: [] };
  if (entry.status?.status_str === "error") {
    return { done: true, images: [], error: "ComfyUI reported an execution error." };
  }
  const images: ComfyImageRef[] = [];
  for (const output of Object.values(entry.outputs ?? {})) {
    for (const image of output.images ?? []) {
      images.push({ filename: image.filename, subfolder: image.subfolder ?? "", type: image.type ?? "output" });
    }
  }
  return { done: images.length > 0, images };
}

export async function downloadComfyImage(image: ComfyImageRef): Promise<Buffer> {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  const response = await comfyFetch(`/view?${query.toString()}`, {}, 60_000);
  if (!response.ok) throw new Error(`Could not download the generated image (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error("ComfyUI returned an empty image.");
  if (buffer.length > 40 * 1024 * 1024) throw new Error("The generated image is unexpectedly large.");
  return buffer;
}

/**
 * Replaces {{PLACEHOLDER}} tokens in a ComfyUI API-format workflow.
 * Strings are substituted verbatim; a value that is exactly one token keeps
 * its numeric type (important for seeds, dimensions and sampler settings).
 */
export function applyWorkflowTemplate(template: unknown, values: WorkflowValues): unknown {
  if (Array.isArray(template)) return template.map((entry) => applyWorkflowTemplate(entry, values));
  if (template && typeof template === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) {
      result[key] = applyWorkflowTemplate(value, values);
    }
    return result;
  }
  if (typeof template === "string") {
    const whole = /^\{\{([A-Z0-9_]+)\}\}$/.exec(template);
    if (whole) {
      const value = values[whole[1]];
      if (value === undefined) throw new Error(`The workflow requires ${whole[1]}, which was not provided.`);
      return value;
    }
    return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
      const value = values[key];
      return value === undefined ? match : String(value);
    });
  }
  return template;
}

export function parseWorkflowJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Workflow JSON is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Workflow must be a JSON object in ComfyUI API format.");
  }
  if ("nodes" in (parsed as Record<string, unknown>) || "links" in (parsed as Record<string, unknown>)) {
    throw new Error(
      "This looks like a UI workflow. Export it from ComfyUI with “Save (API Format)” and paste that JSON instead.",
    );
  }
  return parsed as Record<string, unknown>;
}
