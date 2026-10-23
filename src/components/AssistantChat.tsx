"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt?: string };
type ToolRun = { name: string; status: "success" | "error" | "pending_approval" | "denied"; summary: string; approvalId?: string };

const TOOL_STATUS: Record<ToolRun["status"], { label: string; className: string }> = {
  success: { label: "done", className: "bg-emerald-100 text-emerald-800" },
  error: { label: "failed", className: "bg-red-100 text-red-800" },
  pending_approval: { label: "needs approval", className: "bg-amber-100 text-amber-900" },
  denied: { label: "denied", className: "bg-red-100 text-red-800" },
};

function MessageBody({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="h-1" />;
        const isBullet = trimmed.startsWith("•") || trimmed.startsWith("-") || /^\d+\.\s/.test(trimmed);
        return (
          <p key={index} className={isBullet ? "pl-2" : ""}>
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}

export function AssistantChat({
  conversationId: initialConversationId,
  initialMessages,
  suggestions,
  providerConfigured,
}: {
  conversationId: string | null;
  initialMessages: ChatMessage[];
  suggestions: string[];
  providerConfigured: boolean;
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolRuns, setToolRuns] = useState<ToolRun[]>([]);
  const [mode, setMode] = useState<"llm" | "local" | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setError(null);
    setPending(true);
    setToolRuns([]);
    setInput("");
    const userMessage: ChatMessage = { id: `local-${Date.now()}`, role: "user", content: message };
    setMessages((current) => [...current, userMessage]);
    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, conversationId }),
      });
      const payload = (await response.json()) as {
        error?: string;
        conversationId?: string;
        reply?: string;
        mode?: "llm" | "local";
        toolRuns?: ToolRun[];
      };
      if (!response.ok || payload.error) {
        setError(payload.error ?? "The assistant could not answer.");
        return;
      }
      if (payload.conversationId) {
        setConversationId(payload.conversationId);
        window.history.replaceState(null, "", `/assistant?c=${payload.conversationId}`);
      }
      setMessages((current) => [
        ...current,
        { id: `reply-${Date.now()}`, role: "assistant", content: payload.reply ?? "" },
      ]);
      setToolRuns(payload.toolRuns ?? []);
      setMode(payload.mode ?? null);
      router.refresh();
    } catch {
      setError("The assistant is unreachable. Check the server logs and try again.");
    } finally {
      setPending(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 60);
    }
  }

  return (
    <div className="flex min-h-[520px] flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`rounded-full px-2.5 py-1 font-semibold ${providerConfigured ? "bg-teal-mist text-teal-deep" : "bg-amber-100 text-amber-900"}`}>
            {providerConfigured ? "AI model connected" : "Local assistant mode"}
          </span>
          {mode === "local" && providerConfigured ? <span className="text-ink-soft">fallback used for last reply</span> : null}
        </div>
        <a href="/assistant?new=1" className="btn-ghost text-xs">
          + New conversation
        </a>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-black/5 bg-white/60 p-4">
        {messages.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-2xl" aria-hidden>✨</p>
            <p className="mt-2 font-medium text-ink">Ask about anything the family has recorded.</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">
              The assistant reads real calendars, tasks, school runs, deliveries and notes — within your permissions — and
              asks before consequential actions.
            </p>
            <div className="mx-auto mt-5 flex max-w-xl flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs text-ink-soft transition hover:border-teal/40 hover:text-teal"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "bg-teal text-white"
                    : "border border-black/5 bg-white text-ink shadow-sm"
                }`}
              >
                {message.role === "assistant" ? (
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">HomeOrbit</p>
                ) : null}
                <MessageBody content={message.content} />
              </div>
            </div>
          ))
        )}
        {pending ? (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-black/5 bg-white px-4 py-3 text-sm text-ink-soft shadow-sm">
              Checking the family data…
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {error ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      {toolRuns.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {toolRuns.map((run, index) => (
            <span
              key={`${run.name}-${index}`}
              title={run.summary}
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${TOOL_STATUS[run.status].className}`}
            >
              {run.status === "pending_approval" ? "🛡️ " : run.status === "success" ? "✓ " : "⚠ "}
              {run.name.replace(/_/g, " ")} · {TOOL_STATUS[run.status].label}
            </span>
          ))}
          {toolRuns.some((run) => run.status === "pending_approval") ? (
            <a href="/approvals" className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-900">
              Review approvals →
            </a>
          ) : null}
        </div>
      ) : null}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="Ask about the week, add a task, plan a meal…"
          className="field mt-0 flex-1 resize-none"
          aria-label="Message HomeOrbit"
        />
        <button type="submit" disabled={pending || !input.trim()} className="btn h-11 px-5">
          Send
        </button>
      </form>
      <p className="mt-2 text-[10px] text-ink-soft">
        Enter sends · Shift+Enter adds a line · HomeOrbit never purchases, books or messages outsiders without an approved
        integration.
      </p>
    </div>
  );
}
