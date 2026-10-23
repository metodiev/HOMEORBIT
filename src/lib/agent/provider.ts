import type { ToolSpec } from "./tools";

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

export type ProviderStatus = {
  configured: boolean;
  provider: string;
  model: string | null;
  baseUrl: string | null;
  note: string;
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = "openai-compatible";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: { baseUrl: string; apiKey: string; model: string; extraHeaders?: Record<string, string> }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
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
          args = {};
        }
        toolCalls.push({ id: call.id, name: call.function.name, arguments: args });
      }
      return { content: message?.content ?? null, toolCalls };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function getProvider(): AIProvider | null {
  const apiKey = env("AI_API_KEY");
  if (!apiKey) return null;
  const baseUrl = env("AI_BASE_URL") ?? "https://api.openai.com/v1";
  const model = env("AI_MODEL") ?? "gpt-4o-mini";
  const extraHeaders: Record<string, string> = {};
  if (env("AI_API_KEY_HEADER")) {
    extraHeaders[env("AI_API_KEY_HEADER")!] = apiKey;
  }
  return new OpenAICompatibleProvider({ baseUrl, apiKey, model, extraHeaders });
}

export function providerStatus(): ProviderStatus {
  const apiKey = env("AI_API_KEY");
  const baseUrl = env("AI_BASE_URL") ?? "https://api.openai.com/v1";
  const model = env("AI_MODEL") ?? "gpt-4o-mini";
  if (!apiKey) {
    return {
      configured: false,
      provider: "local",
      model: null,
      baseUrl: null,
      note:
        "No AI provider key is configured. HomeOrbit uses its built-in deterministic assistant, which reads and writes real family data. Set AI_API_KEY (and optionally AI_BASE_URL / AI_MODEL) to connect an OpenAI-compatible model.",
    };
  }
  return {
    configured: true,
    provider: "openai-compatible",
    model,
    baseUrl,
    note: "Connected through the provider abstraction. Tool calls are executed server-side with the signed-in member's permissions.",
  };
}
