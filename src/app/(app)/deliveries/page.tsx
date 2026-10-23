import Link from "next/link";
import { all } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { requireActor } from "@/lib/auth/session";
import { intlLocale } from "@/lib/i18n";
import { dateStringInZone, formatDateTime } from "@/lib/util/dates";
import { listPackages, packageHistory } from "@/lib/domain/packages";
import { listTasks } from "@/lib/domain/tasks";
import {
  createPackageAction,
  createTaskAction,
  setPackageStatusAction,
  setTaskStatusAction,
  updatePackageAction,
} from "@/lib/actions";
import { Badge, Card, EmptyState, FeedbackBanner, PageHeader, Stat } from "@/components/ui";
import { GuestRestricted } from "@/components/ui";

export const metadata = { title: "Deliveries & errands" };

const STATUS_LABELS: Record<string, string> = {
  expected: "Expected",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  collected: "Collected",
  missed: "Missed",
  returned: "Returned",
};

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; new?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  if (actor.role === "relative") {
    return (
      <>
        <PageHeader eyebrow="Errands" title="Deliveries & errands" />
        <GuestRestricted title="Deliveries and errands" />
      </>
    );
  }
  const locale = intlLocale(actor.locale);
  const packages = listPackages(actor);
  const members = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
    [actor.householdId],
  );
  const errands = listTasks(actor, { status: "open", category: "errand" });
  const today = dateStringInZone(new Date(), actor.timezone);
  const todayDeliveries = packages.filter((pkg) => pkg.expected_to?.slice(0, 10) === today);
  const deadlines = packages.filter((pkg) => pkg.deadline && pkg.deadline >= new Date().toISOString());

  return (
    <>
      <PageHeader
        eyebrow="Errands"
        title="Deliveries & errands"
        subtitle="Know what is arriving, who can receive it, and which collection deadlines are close. Statuses are member-reported — HomeOrbit never invents tracking events."
        actions={
          <>
            <Link href="/household#calls" className="btn-secondary">
              📞 Call tracker
            </Link>
            <Link href="/deliveries?new=1" className="btn">
              + Package
            </Link>
          </>
        }
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active" value={packages.length} hint="not yet delivered" />
        <Stat label="Expected today" value={todayDeliveries.length} hint="reported windows" />
        <Stat label="Deadlines" value={deadlines.length} hint="collection deadlines ahead" />
        <Stat label="Errands" value={errands.length} hint="open errands" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {packages.length === 0 ? (
            <EmptyState icon="📦" title="No active deliveries" description="Register a package so someone can be home for it." />
          ) : (
            packages.map((pkg) => {
              const history = packageHistory(actor, pkg.id).slice(0, 3);
              const needsCollector = !pkg.collector_member_id;
              return (
                <Card key={pkg.id} className={needsCollector ? "border-amber-200" : ""}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-ink">{pkg.description}</h2>
                        <Badge
                          tone={
                            pkg.status === "delivered" || pkg.status === "collected"
                              ? "teal"
                              : pkg.status === "missed"
                                ? "red"
                                : "blue"
                          }
                        >
                          {STATUS_LABELS[pkg.status] ?? pkg.status}
                        </Badge>
                        {needsCollector ? <Badge tone="amber">nobody assigned</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-ink-soft">
                        {pkg.merchant ? `${pkg.merchant} · ` : ""}
                        {pkg.tracking_number ? `Tracking ${pkg.tracking_number}` : "No tracking number"}
                        {pkg.carrier ? ` · ${pkg.carrier}` : ""}
                      </p>
                    </div>
                    {pkg.tracking_url ? (
                      <a href={pkg.tracking_url} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
                        Tracking ↗
                      </a>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-2 text-xs text-ink-soft sm:grid-cols-2">
                    <p>
                      <span className="font-semibold text-ink">Window:</span>{" "}
                      {pkg.expected_from ? formatDateTime(pkg.expected_from, locale, actor.timezone) : "unknown"} →{" "}
                      {pkg.expected_to ? formatDateTime(pkg.expected_to, locale, actor.timezone) : "unknown"}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Deadline:</span>{" "}
                      {pkg.deadline ? formatDateTime(pkg.deadline, locale, actor.timezone) : "none"}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Recipient:</span> {pkg.recipientName ?? "household"}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Collector:</span> {pkg.collectorName ?? "nobody yet"}
                    </p>
                    {pkg.pickup_point ? (
                      <p className="sm:col-span-2">
                        <span className="font-semibold text-ink">Pickup point:</span> {pkg.pickup_point}
                        {pkg.collection_code ? ` · code ${pkg.collection_code}` : ""}
                      </p>
                    ) : null}
                    {pkg.instructions ? (
                      <p className="sm:col-span-2 rounded-lg bg-sand/60 px-2 py-1.5 text-ink">{pkg.instructions}</p>
                    ) : null}
                  </div>

                  <div className="mt-4 flex flex-wrap items-end gap-2">
                    <form action={updatePackageAction} className="flex items-end gap-2">
                      <input type="hidden" name="packageId" value={pkg.id} />
                      <input type="hidden" name="redirectTo" value="/deliveries" />
                      <div>
                        <label className="label text-[10px]" htmlFor={`collector-${pkg.id}`}>
                          Who can receive it
                        </label>
                        <select
                          id={`collector-${pkg.id}`}
                          name="collectorMemberId"
                          defaultValue={pkg.collector_member_id ?? ""}
                          className="field mt-0 text-xs"
                        >
                          <option value="">Nobody yet</option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button type="submit" className="btn-secondary px-3 py-1.5 text-xs">
                        Save
                      </button>
                    </form>
                    <form action={setPackageStatusAction} className="flex flex-1 items-end gap-2">
                      <input type="hidden" name="packageId" value={pkg.id} />
                      <input type="hidden" name="redirectTo" value="/deliveries" />
                      <div className="flex-1">
                        <label className="label text-[10px]" htmlFor={`status-${pkg.id}`}>
                          Report new status
                        </label>
                        <div className="flex gap-2">
                          <select id={`status-${pkg.id}`} name="status" defaultValue={pkg.status} className="field mt-0 text-xs">
                            {Object.entries(STATUS_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <input name="note" placeholder="What did the carrier say?" className="field mt-0 text-xs" />
                          <button type="submit" className="btn px-3 py-1.5 text-xs">
                            Record
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>

                  {history.length > 0 ? (
                    <details className="mt-3 text-[11px] text-ink-soft">
                      <summary className="cursor-pointer">Status history ({history.length})</summary>
                      <ul className="mt-1 space-y-1">
                        {history.map((entry) => (
                          <li key={entry.id}>
                            {STATUS_LABELS[entry.status] ?? entry.status} · {entry.member_name} ·{" "}
                            {formatDateTime(entry.created_at, locale, actor.timezone)}
                            {entry.note ? ` — ${entry.note}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </Card>
              );
            })
          )}

          <Card title="Errands" subtitle="Pick up prescriptions, return purchases, collect documents.">
            {errands.length === 0 ? (
              <p className="text-sm text-ink-soft">No open errands.</p>
            ) : (
              <ul className="space-y-2">
                {errands.map((task) => (
                  <li key={task.id} className="flex items-center gap-3 rounded-xl border border-black/5 bg-white p-2.5">
                    <form action={setTaskStatusAction}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="status" value="done" />
                      <input type="hidden" name="redirectTo" value="/deliveries" />
                      <button
                        type="submit"
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-black/20 text-transparent hover:border-teal hover:text-teal"
                      >
                        ✓
                      </button>
                    </form>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{task.title}</p>
                      <p className="text-[11px] text-ink-soft">
                        {task.assigneeName ?? "Unassigned"}
                        {task.due_at ? ` · due ${formatDateTime(task.due_at, locale, actor.timezone)}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form action={createTaskAction} className="mt-3 flex gap-2">
              <input type="hidden" name="category" value="errand" />
              <input type="hidden" name="redirectTo" value="/deliveries" />
              <input name="title" required placeholder="Collect the prescription" className="field mt-0" />
              <button type="submit" className="btn shrink-0 px-3 py-1.5 text-xs">
                Add errand
              </button>
            </form>
          </Card>
        </div>

        <div className="space-y-4">
          <details open={params.new === "1"} className="card p-5">
            <summary className="cursor-pointer text-base font-semibold">New package</summary>
            <form action={createPackageAction} className="mt-4 space-y-3">
              <input type="hidden" name="redirectTo" value="/deliveries" />
              <div>
                <label className="label" htmlFor="pkg-description">
                  What is arriving
                </label>
                <input id="pkg-description" name="description" required className="field" placeholder="Sofia's new backpack" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="pkg-merchant">
                    Merchant
                  </label>
                  <input id="pkg-merchant" name="merchant" className="field" />
                </div>
                <div>
                  <label className="label" htmlFor="pkg-tracking">
                    Tracking
                  </label>
                  <input id="pkg-tracking" name="trackingNumber" className="field" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="pkg-from">
                    Window from
                  </label>
                  <input id="pkg-from" type="datetime-local" name="expectedFrom" className="field" />
                </div>
                <div>
                  <label className="label" htmlFor="pkg-to">
                    Window to
                  </label>
                  <input id="pkg-to" type="datetime-local" name="expectedTo" className="field" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="pkg-deadline">
                    Collection deadline
                  </label>
                  <input id="pkg-deadline" type="datetime-local" name="deadline" className="field" />
                </div>
                <div>
                  <label className="label" htmlFor="pkg-collector">
                    Collector
                  </label>
                  <select id="pkg-collector" name="collectorMemberId" className="field" defaultValue="">
                    <option value="">Nobody yet</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="pkg-pickup">
                  Pickup point / locker
                </label>
                <input id="pkg-pickup" name="pickupPoint" className="field" />
              </div>
              <div>
                <label className="label" htmlFor="pkg-code">
                  Collection code
                </label>
                <input id="pkg-code" name="collectionCode" className="field" />
              </div>
              <div>
                <label className="label" htmlFor="pkg-instructions">
                  Delivery instructions
                </label>
                <textarea id="pkg-instructions" name="instructions" rows={2} className="field" />
              </div>
              <button type="submit" className="btn w-full">
                Register package
              </button>
            </form>
          </details>

          <Card title="No invented tracking" subtitle="How HomeOrbit stays honest">
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>📵 Carrier APIs are not configured by default, so HomeOrbit never claims to know where a parcel is.</li>
              <li>✍️ Every status change is stored with who reported it and when.</li>
              <li>🔔 Proactive checks flag deliveries that need someone home, before the deadline.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
