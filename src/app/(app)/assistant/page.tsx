import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/auth/actor";
import { providerStatus } from "@/lib/agent/provider";
import { listConversations, getConversationMessages } from "@/lib/agent/runner";
import { toolSpecs } from "@/lib/agent/tools";
import { AssistantChat } from "@/components/AssistantChat";
import { Card, FeedbackBanner, PageHeader } from "@/components/ui";
import { GuestRestricted } from "@/components/ui";
import { formatDate } from "@/lib/util/dates";
import { intlLocale } from "@/lib/i18n";

export const metadata = { title: "AI assistant" };

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; new?: string; ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  if (!can(actor, "agent.use")) {
    return (
      <>
        <PageHeader eyebrow="Tool-using agent" title="Ask HomeOrbit" subtitle="The assistant is available to household members." />
        <GuestRestricted title="The AI assistant" />
      </>
    );
  }
  const conversations = listConversations(actor);
  const conversationId = params.new === "1" ? null : params.c ?? conversations[0]?.id ?? null;
  const messages = conversationId
    ? getConversationMessages(actor, conversationId).map((message) => ({
        id: message.id,
        role: message.role === "user" ? ("user" as const) : ("assistant" as const),
        content: message.content,
        createdAt: message.created_at,
      }))
    : [];
  const status = providerStatus();
  const tools = toolSpecs();
  const locale = intlLocale(actor.locale);

  return (
    <>
      <PageHeader
        eyebrow="Tool-using agent"
        title="Ask HomeOrbit"
        subtitle="Natural conversation on top of real server-side tools. Every action is authorised for your role and logged."
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Card title="Conversations" subtitle="Private to you">
            <div className="space-y-1">
              <Link
                href="/assistant?new=1"
                className={`block rounded-xl px-3 py-2 text-sm ${
                  params.new === "1" ? "bg-teal-mist font-semibold text-teal-deep" : "text-ink-soft hover:bg-sand/60"
                }`}
              >
                + New conversation
              </Link>
              {conversations.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/assistant?c=${conversation.id}`}
                  className={`block rounded-xl px-3 py-2 text-sm ${
                    conversationId === conversation.id
                      ? "bg-teal-mist font-semibold text-teal-deep"
                      : "text-ink-soft hover:bg-sand/60"
                  }`}
                >
                  <span className="block truncate">{conversation.title}</span>
                  <span className="block text-[10px] text-ink-soft/70">
                    {formatDate(conversation.updatedAt, locale, actor.timezone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {conversation.messageCount} messages
                  </span>
                </Link>
              ))}
              {conversations.length === 0 ? <p className="px-3 py-2 text-xs text-ink-soft">No conversations yet.</p> : null}
            </div>
          </Card>

          <Card title="Mode" subtitle={status.configured ? "External model connected" : "Built-in deterministic engine"}>
            <p className="text-xs leading-relaxed text-ink-soft">{status.note}</p>
            {status.configured ? (
              <p className="mt-2 text-[11px] text-ink-soft">
                Model: <strong className="text-ink">{status.model}</strong>
                <br />
                Endpoint: <span className="break-all">{status.baseUrl}</span>
              </p>
            ) : (
              <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                Local mode still reads and writes real data, proposes approvals and refuses unsupported integrations. It
                is intentionally simpler than an LLM.
              </p>
            )}
          </Card>
        </div>

        <Card>
          <AssistantChat
            conversationId={conversationId}
            initialMessages={messages}
            providerConfigured={status.configured}
            suggestions={[
              "What is planned for tomorrow?",
              "Who is free on Saturday for two hours?",
              "Add milk, bread and eggs to the shopping list.",
              "Remind me to call the school tomorrow at 9.",
              "Are the nephews coming on the long weekend?",
              "Summarise our week.",
            ]}
          />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title={`Connected tools · ${tools.length}`} subtitle="Real, validated server functions — not scripted replies.">
          <div className="flex flex-wrap gap-1.5">
            {tools.map((tool) => (
              <span key={tool.name} className="chip font-mono text-[10px]">
                {tool.name}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-ink-soft">
            Tools run with the signed-in member&apos;s permissions. Consequential ones create approval requests instead of
            executing immediately.
          </p>
        </Card>
        <Card title="What it will not do" subtitle="Deliberate boundaries">
          <ul className="space-y-2 text-xs text-ink-soft">
            <li>🚫 Invent a delivery status, availability, or a child&apos;s location.</li>
            <li>🚫 Treat “no reply” as confirmation from invited relatives.</li>
            <li>🚫 Buy, book or pay without a configured integration and explicit approval.</li>
            <li>🚫 Follow instructions hidden in notes or imported calendar text.</li>
            <li>🚫 Bypass permissions, even if asked to.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
