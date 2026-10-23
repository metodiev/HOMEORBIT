import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/auth/actor";
import { intlLocale } from "@/lib/i18n";
import { formatDateTime } from "@/lib/util/dates";
import { listApprovalHistory, listPendingApprovals, readApprovalPayload } from "@/lib/domain/approvals";
import { decideApprovalAction } from "@/lib/actions";
import { Badge, Card, EmptyState, FeedbackBanner, PageHeader } from "@/components/ui";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const locale = intlLocale(actor.locale);
  const pending = listPendingApprovals(actor);
  const history = listApprovalHistory(actor);
  const canApprove = can(actor, "agent.approve");

  return (
    <>
      <PageHeader
        eyebrow="Guardian control"
        title="Approvals"
        subtitle="Consequential actions requested by the assistant wait here until a guardian confirms them. Nothing is executed in the meantime."
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {pending.length === 0 ? (
            <EmptyState icon="🛡️" title="No requests waiting" description="When the assistant proposes a sensitive change, it will appear here first." />
          ) : (
            pending.map((approval) => {
              const payload = readApprovalPayload(approval);
              return (
                <Card key={approval.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-ink">{approval.action.replace(/_/g, " ")}</h2>
                        <Badge tone={approval.risk === "critical" ? "red" : "amber"}>{approval.risk}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-ink-soft">{approval.summary}</p>
                      <p className="mt-1 text-[11px] text-ink-soft/80">
                        Tool: <span className="font-mono">{payload.toolName}</span> · requested{" "}
                        {formatDateTime(approval.created_at, locale, actor.timezone)}
                      </p>
                    </div>
                  </div>
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-ink-soft">Requested arguments</summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-ink/90 p-3 text-[10px] leading-relaxed text-cream">
{JSON.stringify(payload.arguments, null, 2)}
                    </pre>
                  </details>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {canApprove ? (
                      <>
                        <form action={decideApprovalAction}>
                          <input type="hidden" name="approvalId" value={approval.id} />
                          <input type="hidden" name="decision" value="approved" />
                          <input type="hidden" name="redirectTo" value="/approvals" />
                          <button type="submit" className="btn">Approve and run</button>
                        </form>
                        <form action={decideApprovalAction}>
                          <input type="hidden" name="approvalId" value={approval.id} />
                          <input type="hidden" name="decision" value="rejected" />
                          <input type="hidden" name="redirectTo" value="/approvals" />
                          <button type="submit" className="btn-secondary">Decline</button>
                        </form>
                      </>
                    ) : (
                      <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        Waiting for a guardian to confirm. Your request can only be approved by someone with the
                        agent.approve permission.
                      </p>
                    )}
                  </div>
                </Card>
              );
            })
          )}

          <Card title="Recent decisions" subtitle="Audit trail for consequential actions">
            {history.length === 0 ? (
              <p className="text-sm text-ink-soft">No decisions yet.</p>
            ) : (
              <ul className="space-y-2">
                {history.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/5 bg-white p-3 text-xs">
                    <div>
                      <p className="font-medium text-ink">{entry.action.replace(/_/g, " ")}</p>
                      <p className="text-ink-soft">
                        {entry.requesterName} → {entry.deciderName ?? "not decided"}
                        {entry.decided_at ? ` · ${formatDateTime(entry.decided_at, locale, actor.timezone)}` : ""}
                      </p>
                    </div>
                    <Badge tone={entry.status === "approved" ? "teal" : entry.status === "rejected" ? "red" : "neutral"}>{entry.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="What needs approval" subtitle="The hard boundaries">
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>🚫 Cancelling an event</li>
              <li>✏️ Changing another member&apos;s event</li>
              <li>🎒 Reassigning a pickup that belongs to someone else</li>
              <li>🔒 Sharing a sensitive note</li>
              <li>💳 Purchases, payments and travel bookings (not implemented)</li>
              <li>📤 External messages (no messaging integration configured)</li>
            </ul>
          </Card>
          <Card title="Who can approve" subtitle="Server-side, not UI-only">
            <p className="text-xs text-ink-soft">
              Only accounts with the <span className="font-mono text-[10px]">agent.approve</span> capability — parents in
              this version — can approve requests from other members. Children can confirm their own low-risk actions but
              cannot approve guardian-level changes.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
