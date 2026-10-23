function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function ollamaBaseUrl(): string {
  return trimSlash(process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434");
}

export function ollamaDefaultModel(): string | null {
  return process.env.OLLAMA_MODEL?.trim() || null;
}

export function ollamaVisionModel(): string | null {
  return process.env.OLLAMA_VISION_MODEL?.trim() || null;
}

export function ollamaEmbeddingModel(): string | null {
  return process.env.OLLAMA_EMBED_MODEL?.trim() || null;
}

export function ollamaExplicitlyConfigured(): boolean {
  return Boolean(process.env.OLLAMA_BASE_URL?.trim() || process.env.OLLAMA_MODEL?.trim());
}

function headers(): Record<string, string> {
  const value: Record<string, string> = { "content-type": "application/json" };
  if (process.env.OLLAMA_API_KEY?.trim()) {
    value.authorization = `Bearer ${process.env.OLLAMA_API_KEY.trim()}`;
  }
  return value;
}

export type OllamaModelList = {
  available: boolean;
  baseUrl: string;
  models: string[];
  error?: string;
};

export async function listOllamaModels(timeoutMs = 4000): Promise<OllamaModelList> {
  const baseUrl = ollamaBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      headers: headers(),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return { available: false, baseUrl, models: [], error: `Ollama responded ${response.status}.` };
    }
    const payload = (await response.json()) as { models?: { name?: string; model?: string }[] };
    const models = (payload.models ?? [])
      .map((model) => model.name ?? model.model ?? "")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return { available: true, baseUrl, models };
  } catch (error) {
    return {
      available: false,
      baseUrl,
      models: [],
      error: error instanceof Error && error.name === "AbortError" ? "Ollama timed out." : "Ollama is unreachable.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export type OllamaGenerateResult = { response: string; model: string };

export async function ollamaGenerate(input: {
  model: string;
  prompt: string;
  system?: string;
  images?: string[];
  format?: "json";
  timeoutMs?: number;
}): Promise<OllamaGenerateResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000);
  try {
    const response = await fetch(`${ollamaBaseUrl()}/api/generate`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        ...(input.system ? { system: input.system } : {}),
        ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
        ...(input.format ? { format: input.format } : {}),
        stream: false,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`Ollama responded ${response.status}${detail ? `: ${detail}` : ""}.`);
    }
    const payload = (await response.json()) as { response?: string; model?: string };
    if (!payload.response) throw new Error("Ollama returned an empty response.");
    return { response: payload.response, model: payload.model ?? input.model };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The local model timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function ollamaEmbedding(input: { model: string; prompt: string; timeoutMs?: number }): Promise<number[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000);
  try {
    const response = await fetch(`${ollamaBaseUrl()}/api/embeddings`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ model: input.model, prompt: input.prompt }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Ollama embeddings responded ${response.status}.`);
    const payload = (await response.json()) as { embedding?: number[] };
    if (!Array.isArray(payload.embedding) || payload.embedding.length === 0) {
      throw new Error("Ollama embeddings returned no vector.");
    }
    return payload.embedding;
  } finally {
    clearTimeout(timer);
  }
}
