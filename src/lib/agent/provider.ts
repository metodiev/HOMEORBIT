import type { ToolSpec } from "./tools";
import { get } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import type { Actor } from "@/lib/auth/actor";
import { ollamaBaseUrl, ollamaDefaultModel, ollamaExplicitlyConfigured, ollamaVisionModel, ollamaEmbeddingModel } from "@/lib/ai/ollama";

export type ProviderToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ProviderMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ProviderToolCall[] }
  | { role: "tool"; content: string; toolCallId: string; name: string };

export type ProviderResult = { content: string | null; toolCalls: ProviderToolCall[] };

export interface AIProvider {
  id: string;
  model: string;
  complete(messages: ProviderMessage[], tools: ToolSpec[]): Promise<ProviderResult>;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string = "openai-compatible";
  readonly model: string;
  readonly endpoint: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: { baseUrl: string; apiKey: string; model: string; extraHeaders?: Record<string, string> }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.endpoint = this.baseUrl;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.extraHeaders = options.extraHeaders ?? {};
  }

  async complete(messages: ProviderMessage[], tools: ToolSpec[]): Promise<ProviderResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: messages.map((message) => {
          if (message.role === "assistant") {
            return {
              role: "assistant",
              content: message.content,
              ...(message.toolCalls && message.toolCalls.length > 0
                ? {
                    tool_calls: message.toolCalls.map((call) => ({
                      id: call.id,
                      type: "function",
                      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                    })),
                  }
                : {}),
            };
          }
          if (message.role === "tool") {
            return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
          }
          return { role: message.role, content: message.content };
        }),
        temperature: 0.2,
        tools: tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
        tool_choice: "auto",
      };
      if (process.env.AI_JSON_MODE === "true") body.response_format = { type: "json_object" };
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`AI provider responded ${response.status}: ${text.slice(0, 300)}`);
      }
      const json = (await response.json()) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: { id: string; function: { name: string; arguments: string } }[];
          };
        }[];
      };
      const message = json.choices?.[0]?.message;
      const toolCalls: ProviderToolCall[] = [];
      for (const call of message?.tool_calls ?? []) {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          throw new Error(`The model returned invalid JSON arguments for ${call.function.name}.`);
        }
        toolCalls.push({ id: call.id, name: call.function.name, arguments: args });
      }
      const content = message?.content?.trim() ?? "";
      if (toolCalls.length === 0) {
        if (!content) throw new Error("The model returned an empty response.");
        if (/"type"\s*:\s*"function"/.test(content) || (/"name"\s*:/.test(content) && /"parameters"\s*:/.test(content))) {
          throw new Error("The model returned tool schema text instead of calling a tool. Try a different local model.");
        }
      }
      return { content: content || null, toolCalls };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type ProviderStatus = {
  configured: boolean;
  provider: string;
  model: string | null;
  baseUrl: string | null;
  location: "local" | "external" | null;
  note: string;
  visionModelAvailable: boolean;
  embeddingModelAvailable: boolean;
};

export type ProviderSelection = {
  provider: AIProvider;
  kind: "ollama" | "openai";
  label: string;
  model: string;
  location: "local" | "external";
  endpoint: string;
  note: string;
};

export type ProviderResolution = { selection: ProviderSelection | null; reason?: string };

export class OllamaProvider extends OpenAICompatibleProvider {
  readonly id: string = "ollama";

  constructor(model: string) {
    super({
      baseUrl: `${ollamaBaseUrl()}/v1`,
      apiKey: env("OLLAMA_API_KEY") ?? "ollama",
      model,
    });
  }
}

function openAiSelection(model: string): ProviderSelection {
  const apiKey = env("AI_API_KEY")!;
  const baseUrl = env("AI_BASE_URL") ?? "https://api.openai.com/v1";
  const extraHeaders: Record<string, string> = {};
  if (env("AI_API_KEY_HEADER")) {
    extraHeaders[env("AI_API_KEY_HEADER")!] = apiKey;
  }
  const provider = new OpenAICompatibleProvider({ baseUrl, apiKey, model, extraHeaders });
  return {
    provider,
    kind: "openai",
    label: "External model",
    model,
    location: "external",
    endpoint: baseUrl,
    note: "Requests leave the Mac Studio and are sent to the configured external AI endpoint.",
  };
}

function ollamaSelection(model: string): ProviderSelection {
  const provider = new OllamaProvider(model);
  return {
    provider,
    kind: "ollama",
    label: "Ollama (local)",
    model,
    location: "local",
    endpoint: provider.endpoint,
    note: "Inference stays on the local Ollama server.",
  };
}

/** Resolves the AI provider for a member, honouring their model selector. */
export function resolveProviderForActor(actor: Actor): ProviderResolution {
  const member = get<MemberRow>("SELECT * FROM members WHERE id = ? AND household_id = ?", [
    actor.id,
    actor.householdId,
  ]);
  const preference = (member?.ai_provider ?? "auto") as "auto" | "ollama" | "openai" | "local";
  const selectedModel = member?.ai_model?.trim() || null;
  const ollamaModel = selectedModel || ollamaDefaultModel();
  const externalModel = env("AI_MODEL") ?? "gpt-4o-mini";

  if (preference === "local") {
    return { selection: null, reason: "Your profile is set to the built-in assistant." };
  }
  if (preference === "ollama") {
    if (!ollamaModel) {
      return {
        selection: null,
        reason: "Choose an Ollama model in My AI, or set OLLAMA_MODEL on the server.",
      };
    }
    return { selection: ollamaSelection(ollamaModel) };
  }
  if (preference === "openai") {
    if (!env("AI_API_KEY")) {
      return { selection: null, reason: "No external AI key is configured on the server." };
    }
    return { selection: openAiSelection(selectedModel || externalModel) };
  }

  // auto: prefer local Ollama, then the external provider.
  if (ollamaModel && ollamaExplicitlyConfigured()) return { selection: ollamaSelection(ollamaModel) };
  if (env("AI_API_KEY")) return { selection: openAiSelection(selectedModel || externalModel) };
  return {
    selection: null,
    reason:
      "No local Ollama model or external AI key is configured. HomeOrbit is using its built-in deterministic assistant.",
  };
}

export function providerStatusFor(actor: Actor): ProviderStatus {
  const resolution = resolveProviderForActor(actor);
  if (!resolution.selection) {
    return {
      configured: false,
      provider: "local",
      model: null,
      baseUrl: null,
      location: null,
      note: resolution.reason ?? "The built-in assistant is active.",
      visionModelAvailable: Boolean(ollamaVisionModel()),
      embeddingModelAvailable: Boolean(ollamaEmbeddingModel()),
    };
  }
  return {
    configured: true,
    provider: resolution.selection.kind,
    model: resolution.selection.model,
    baseUrl: resolution.selection.endpoint,
    location: resolution.selection.location,
    note: resolution.selection.note,
    visionModelAvailable: Boolean(ollamaVisionModel()),
    embeddingModelAvailable: Boolean(ollamaEmbeddingModel()),
  };
}
