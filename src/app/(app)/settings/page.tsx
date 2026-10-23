import Link from "next/link";
import { headers } from "next/headers";
import { all, get } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { can } from "@/lib/auth/actor";
import { requireActor } from "@/lib/auth/session";
import { intlLocale } from "@/lib/i18n";
import { formatDate } from "@/lib/util/dates";
import {
  getHouseholdSettings,
  listAuditLog,
  listIntegrations,
  listInvitations,
  listMembers,
} from "@/lib/domain/settings";
import { listCalendars } from "@/lib/domain/calendars";
import { getNotificationPreferences, type DashboardWidgets, type NotificationPreferences } from "@/lib/domain/notifications";
import { ALL_CAPABILITIES } from "@/lib/auth/permissions";
import { HOLIDAY_COUNTRIES } from "@/lib/domain/holidays";
import { parseJson } from "@/lib/util/ids";
import {
  addMemberAction,
  createCalendarAction,
  createResetLinkAction,
  deactivateMemberAction,
  deleteAccountAction,
  deleteWorkflowAction,
  installSampleWorkflowAction,
  inviteMemberAction,
  saveWorkflowAction,
  shareCalendarAction,
  toggleWorkflowAction,
  updateDashboardPrefsAction,
  updateHouseholdAction,
  updateIntegrationAction,
  updateProfileAction,
  switchLocaleAction,
} from "@/lib/actions";
import { listWorkflows, sampleWorkflowList, WORKFLOW_OPERATIONS } from "@/lib/domain/image-workflows";
import { comfyuiConfigured } from "@/lib/images/comfyui";
import { imageQueueInfo } from "@/lib/images/queue";
import { Badge, Card, FeedbackBanner, MemberAvatar, PageHeader } from "@/components/ui";
import { MobileAppSettings } from "@/components/MobileAppSettings";
import { MobilePairingCard } from "@/components/MobilePairingCard";

export const metadata = { title: "Settings & family" };

function timeZones(): string[] {
  const preferred = ["Europe/Sofia", "Europe/London", "Europe/Berlin", "Europe/Madrid", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"];
  let supported: string[] = [];
  try {
    supported = Intl.supportedValuesOf("timeZone");
  } catch {
    supported = preferred;
  }
  return [...new Set([...preferred, ...supported])];
}

const INTEGRATION_HELP: Record<string, string> = {
  google_calendar: "Two-way sync requires a Google Cloud OAuth client, GOOGLE_CLIENT_ID/SECRET and an authorised sync worker. ICS export works today.",
  outlook_calendar: "Requires an Azure app registration with Calendars.ReadWrite and MICROSOFT_CLIENT_ID/SECRET. ICS export works today.",
  icloud_calendar: "Apple does not offer public calendar APIs; use a read-only ICS feed URL from iCloud. Two-way editing is not supported.",
  email_import: "Requires an IMAP mailbox and credentials in environment variables; imported content is treated as untrusted.",
  push: "Web push requires VAPID keys (WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY) and a push worker.",
  telegram: "Requires TELEGRAM_BOT_TOKEN and a verified chat id per member.",
  whatsapp: "Requires a WhatsApp Business API account and approved templates.",
  carrier_tracking: "Requires per-carrier API credentials. Without them, status remains member-reported.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const locale = intlLocale(actor.locale);
  const household = getHouseholdSettings(actor);
  const actorRow = get<MemberRow>("SELECT * FROM members WHERE id = ?", [actor.id]);
  const prefs: NotificationPreferences = actorRow ? getNotificationPreferences(actorRow) : {};
  const dashboardPrefs = {
    briefing: true,
    agenda: true,
    insights: true,
    week: true,
    feed: true,
    approvals: true,
    quickAdd: true,
    availability: true,
    ...parseJson<DashboardWidgets>(actorRow?.dashboard_prefs_json, {}),
  };
  const members = listMembers(actor);
  const calendars = listCalendars(actor);
  const invitations = can(actor, "members.manage") ? listInvitations(actor) : [];
  const integrations = listIntegrations(actor);
  const canManageWorkflows = can(actor, "household.manage");
  const workflows = canManageWorkflows ? listWorkflows(actor, { includeDisabled: true }) : [];
  const samples = sampleWorkflowList();
  const queue = imageQueueInfo(actor);
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = forwardedHost || requestHeaders.get("host") || "";
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const hostIsLocal = !requestHost || /^(localhost|127\.|\[::1\])/i.test(requestHost);
  let mobileServerUrl = process.env.MOBILE_PUBLIC_URL?.trim().replace(/\/+$/, "") ?? "";
  if (mobileServerUrl) {
    try {
      mobileServerUrl = new URL(mobileServerUrl).origin;
    } catch {
      mobileServerUrl = "";
    }
  } else if (!hostIsLocal) {
    mobileServerUrl = `${forwardedProto || "https"}://${requestHost}`;
  }
  const audit = can(actor, "audit.read") ? listAuditLog(actor, 40) : [];
  const isAdmin = can(actor, "household.manage");

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Settings & family"
        subtitle="Profiles, permissions, calendars, notification preferences, integrations and the audit trail."
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Household" subtitle="Time zone and locale drive every date shown in HomeOrbit.">
            {isAdmin ? (
              <form action={updateHouseholdAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="redirectTo" value="/settings" />
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="household-name">Household name</label>
                  <input id="household-name" name="name" defaultValue={household.name} className="field" />
                </div>
                <div>
                  <label className="label" htmlFor="household-timezone">Time zone</label>
                  <select id="household-timezone" name="timezone" defaultValue={household.timezone} className="field">
                    {timeZones().map((zone) => (
                      <option key={zone} value={zone}>{zone}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="household-locale">Default language</label>
                  <select id="household-locale" name="locale" defaultValue={household.locale} className="field">
                    <option value="en">English</option>
                    <option value="bg">Български</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="holiday-country">Public holiday calendar</label>
                  <select id="holiday-country" name="holidayCountry" defaultValue={household.holidayCountry} className="field">
                    {HOLIDAY_COUNTRIES.map((country) => (
                      <option key={country.code} value={country.code}>{country.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button type="submit" className="btn w-full">Save household</button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-ink-soft">
                {household.name} · {household.timezone} · {household.locale}. Only household administrators can change
                these settings.
              </p>
            )}
          </Card>

          <Card title="Your profile" subtitle="How you appear to the family.">
            <form action={updateProfileAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="memberId" value={actor.id} />
              <input type="hidden" name="redirectTo" value="/settings" />
              <div>
                <label className="label" htmlFor="profile-name">Name</label>
                <input id="profile-name" name="name" defaultValue={actor.name} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="profile-relationship">Relationship</label>
                <input id="profile-relationship" name="relationship" defaultValue={actor.relationship ?? ""} className="field" placeholder="Parent, aunt, nephew…" />
              </div>
              <div>
                <label className="label" htmlFor="profile-avatar">Avatar emoji</label>
                <input id="profile-avatar" name="avatar" defaultValue={actor.avatar} maxLength={4} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="profile-color">Colour</label>
                <input id="profile-color" name="color" type="color" defaultValue={actor.color} className="field h-10 p-1" />
              </div>
              <div>
                <label className="label" htmlFor="profile-timezone">Time zone</label>
                <select id="profile-timezone" name="timezone" defaultValue={actor.timezone} className="field">
                  {timeZones().map((zone) => (
                    <option key={zone} value={zone}>{zone}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="profile-locale">Language</label>
                <select id="profile-locale" name="locale" defaultValue={actor.locale} className="field">
                  <option value="en">English</option>
                  <option value="bg">Български</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="profile-birthday">Birthday</label>
                <input id="profile-birthday" name="birthday" type="date" defaultValue={actorRow?.birthday ?? ""} className="field" />
              </div>
              <div className="flex items-end">
                <button type="submit" className="btn w-full">Save profile</button>
              </div>
            </form>
          </Card>

          <Card title="Notifications" subtitle="In-app notifications respect these preferences and quiet hours.">
            <form action={updateProfileAction} className="space-y-3">
              <input type="hidden" name="memberId" value={actor.id} />
              <input type="hidden" name="redirectTo" value="/settings" />
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ["calendar", "Calendar changes"],
                  ["tasks", "Tasks and chores"],
                  ["shopping", "Shopping"],
                  ["packages", "Deliveries"],
                  ["school", "School and pickups"],
                  ["holidays", "Holidays and trips"],
                  ["briefing", "Daily briefing"],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name={`mute${key.charAt(0).toUpperCase()}${key.slice(1)}`} defaultChecked={prefs.categories?.[key] === false} />
                    <span className="text-ink-soft">Mute {label.toLowerCase()}</span>
                  </label>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="quietEnabled" defaultChecked={prefs.quietHours?.enabled !== false} />
                  <span>Quiet hours</span>
                </label>
                <input name="quietStart" type="time" defaultValue={prefs.quietHours?.start ?? "22:00"} className="field mt-0" aria-label="Quiet hours start" />
                <input name="quietEnd" type="time" defaultValue={prefs.quietHours?.end ?? "07:00"} className="field mt-0" aria-label="Quiet hours end" />
              </div>
              <button type="submit" className="btn w-full">Save notification preferences</button>
            </form>
          </Card>

          <Card title="Dashboard widgets" subtitle="Choose what appears on your home screen.">
            <form action={updateDashboardPrefsAction} className="space-y-3">
              <input type="hidden" name="redirectTo" value="/settings" />
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(dashboardPrefs).map(([key, value]) => (
                  <label key={key} className="flex items-center gap-2 capitalize">
                    <input type="checkbox" name={key} defaultChecked={value} />
                    <span className="text-ink-soft">{key}</span>
                  </label>
                ))}
              </div>
              <button type="submit" className="btn w-full">Save widgets</button>
            </form>
          </Card>

          {can(actor, "members.manage") ? (
            <>
              <Card title="Family members" subtitle="Roles decide server-side permissions. Six is a starting size, not a limit.">
                <ul className="space-y-2">
                  {members.map((member) => {
                    const isSelf = member.id === actor.id;
                    return (
                      <li key={member.id} className="rounded-xl border border-black/5 bg-white p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <MemberAvatar name={member.name} color={member.color} avatar={member.avatar} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-ink">
                              {member.name} {isSelf ? <span className="text-[10px] uppercase text-ink-soft">(you)</span> : null}
                            </p>
                            <p className="text-[11px] text-ink-soft">
                              {member.email ?? "No sign-in account (managed profile)"} · {member.relationship ?? member.role}
                            </p>
                          </div>
                          <Badge tone={member.is_admin ? "teal" : "neutral"}>{member.role}{member.is_admin ? " · admin" : ""}</Badge>
                        </div>
                        {!isSelf ? (
                          <details className="mt-2 text-xs">
                            <summary className="cursor-pointer text-ink-soft hover:text-teal">Manage {member.name.split(" ")[0]}</summary>
                            <form action={updateProfileAction} className="mt-3 space-y-2">
                              <input type="hidden" name="memberId" value={member.id} />
                              <input type="hidden" name="redirectTo" value="/settings" />
                              <div className="grid grid-cols-2 gap-2">
                                <select name="role" defaultValue={member.role} className="field mt-0">
                                  <option value="parent">Parent</option>
                                  <option value="adult">Adult</option>
                                  <option value="teen">Teenager</option>
                                  <option value="child">Child</option>
                                  <option value="relative">Invited relative</option>
                                </select>
                                <label className="flex items-center gap-2">
                                  <input type="checkbox" name="isAdmin" defaultChecked={member.is_admin === 1} /> Administrator
                                </label>
                              </div>
                              <details>
                                <summary className="cursor-pointer text-ink-soft">Extra / revoked capabilities</summary>
                                <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
                                  {ALL_CAPABILITIES.map((capability) => (
                                    <div key={capability} className="rounded-lg border border-black/5 p-1.5">
                                      <p className="font-mono">{capability}</p>
                                      <label className="mr-2 inline-flex items-center gap-1">
                                        <input type="checkbox" name="grant" value={capability} /> grant
                                      </label>
                                      <label className="inline-flex items-center gap-1">
                                        <input type="checkbox" name="revoke" value={capability} /> revoke
                                      </label>
                                    </div>
                                  ))}
                                </div>
                              </details>
                              <input type="hidden" name="permissionForm" value="1" />
                              <button type="submit" className="btn-secondary w-full py-1.5 text-xs">Save member</button>
                            </form>
                            <form action={deactivateMemberAction} className="mt-2">
                              <input type="hidden" name="memberId" value={member.id} />
                              <input type="hidden" name="redirectTo" value="/settings" />
                              <button type="submit" className="btn-ghost px-2 py-1 text-[11px] text-red-700 hover:bg-red-50">
                                Deactivate account
                              </button>
                            </form>
                            {member.email && member.password_hash ? (
                              <form action={createResetLinkAction} className="mt-1">
                                <input type="hidden" name="memberId" value={member.id} />
                                <input type="hidden" name="redirectTo" value="/settings" />
                                <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">
                                  Create one-time password reset link
                                </button>
                              </form>
                            ) : null}
                          </details>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </Card>

              <div className="grid gap-5 md:grid-cols-2">
                <Card title="Invite by email" subtitle="Creates a one-time activation link. No email provider is configured, so copy the link shown after creating it.">
                  <form action={inviteMemberAction} className="space-y-2">
                    <input type="hidden" name="redirectTo" value="/settings" />
                    <input name="name" required placeholder="Name" className="field mt-0" />
                    <input name="email" type="email" required placeholder="Email" className="field mt-0" />
                    <div className="grid grid-cols-2 gap-2">
                      <select name="role" className="field mt-0" defaultValue="adult">
                        <option value="parent">Parent</option>
                        <option value="adult">Adult</option>
                        <option value="teen">Teenager</option>
                        <option value="child">Child</option>
                        <option value="relative">Relative / guest</option>
                      </select>
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" name="isAdmin" /> Administrator
                      </label>
                    </div>
                    <button type="submit" className="btn w-full">Create invitation</button>
                  </form>
                  {invitations.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-[11px] text-ink-soft">
                      {invitations.map((invitation) => (
                        <li key={invitation.id}>
                          {invitation.memberName} · {invitation.email} · {invitation.role} · expires{" "}
                          {formatDate(invitation.expires_at, locale, actor.timezone, { day: "numeric", month: "short" })}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Card>

                <Card title="Add a managed profile" subtitle="For children or relatives without an email account.">
                  <form action={addMemberAction} className="space-y-2">
                    <input type="hidden" name="redirectTo" value="/settings" />
                    <input name="name" required placeholder="Name" className="field mt-0" />
                    <div className="grid grid-cols-2 gap-2">
                      <select name="role" className="field mt-0" defaultValue="child">
                        <option value="adult">Adult</option>
                        <option value="teen">Teenager</option>
                        <option value="child">Child</option>
                        <option value="relative">Relative</option>
                      </select>
                      <input name="relationship" placeholder="Relationship" className="field mt-0" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input name="birthday" type="date" className="field mt-0" aria-label="Birthday" />
                      <input name="color" type="color" defaultValue="#64748b" className="field mt-0 h-10 p-1" aria-label="Colour" />
                    </div>
                    <button type="submit" className="btn w-full">Add profile</button>
                  </form>
                </Card>
              </div>
            </>
          ) : null}

          <Card title="Calendars" subtitle="Personal calendars stay private unless shared explicitly.">
            <div id="calendars" className="space-y-2">
              {calendars.map((calendar) => (
                <div key={calendar.id} className="rounded-xl border border-black/5 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: calendar.color }} />
                    <p className="text-sm font-medium text-ink">{calendar.name}</p>
                    <Badge tone={calendar.scope === "shared" ? "blue" : "neutral"}>{calendar.scope}</Badge>
                    {calendar.ownerName ? <span className="text-[11px] text-ink-soft">owner: {calendar.ownerName}</span> : null}
                    {calendar.canEdit ? <Badge tone="teal">editable</Badge> : <Badge tone="neutral">read-only</Badge>}
                  </div>
                  {calendar.sharedWith.length > 0 ? (
                    <p className="mt-1 text-[11px] text-ink-soft">
                      Shared with: {calendar.sharedWith.map((entry) => `${entry.name} (${entry.access})`).join(", ")}
                    </p>
                  ) : null}
                  {calendar.canEdit ? (
                    <form action={shareCalendarAction} className="mt-2 flex flex-wrap items-end gap-1">
                      <input type="hidden" name="calendarId" value={calendar.id} />
                      <input type="hidden" name="redirectTo" value="/settings#calendars" />
                      <select name="memberId" className="rounded-full border border-black/10 bg-white px-2 py-1 text-[11px]" defaultValue="">
                        <option value="">Share with…</option>
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>{member.name}</option>
                        ))}
                      </select>
                      <select name="access" className="rounded-full border border-black/10 bg-white px-2 py-1 text-[11px]" defaultValue="view">
                        <option value="view">View</option>
                        <option value="edit">Edit</option>
                      </select>
                      <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">Share</button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
            {can(actor, "calendar.create") ? (
              <form action={createCalendarAction} className="mt-3 grid gap-2 sm:grid-cols-[1.5fr_0.7fr_0.7fr_auto]">
                <input type="hidden" name="redirectTo" value="/settings#calendars" />
                <input name="name" required placeholder="New calendar name" className="field mt-0" />
                <select name="scope" className="field mt-0" defaultValue="shared">
                  <option value="shared">Shared</option>
                  <option value="personal">Personal</option>
                </select>
                <input name="color" type="color" defaultValue="#0f766e" className="field mt-0 h-10 p-1" aria-label="Colour" />
                <button type="submit" className="btn">Create</button>
              </form>
            ) : null}
          </Card>

          {canManageWorkflows ? (
            <Card
              title="Image workflows"
              subtitle="ComfyUI API-format workflows. Ports stay private; only enabled workflows can run."
            >
              <div className="mb-3 rounded-xl bg-sand/60 p-3 text-[11px] text-ink-soft">
                <p>
                  <strong>ComfyUI:</strong> {comfyuiConfigured() ? "configured" : "not configured"} · queue {queue.queued} waiting,{" "}
                  {queue.running} running.
                </p>
                <p className="mt-1">
                  Set <code>COMFYUI_URL</code> (for example http://127.0.0.1:8188) and <code>COMFYUI_CHECKPOINT</code> on the
                  Mac Studio. Placeholders: <code>{"{{PROMPT}}, {{NEGATIVE_PROMPT}}, {{SEED}}, {{WIDTH}}, {{HEIGHT}}, {{STEPS}}, {{CFG}}, {{DENOISE}}, {{IMAGE}}, {{MASK}}, {{CHECKPOINT}}, {{SCALE}}"}</code>.
                  Use ComfyUI&apos;s “Export (API)” JSON, not the UI workflow JSON.
                </p>
              </div>

              <div className="space-y-3">
                {workflows.length === 0 ? <p className="text-xs text-ink-soft">No workflows yet. Install a sample below.</p> : null}
                {workflows.map((workflow) => (
                  <details key={workflow.id} className="rounded-xl border border-black/5 bg-white p-3 text-xs">
                    <summary className="cursor-pointer">
                      <span className="font-semibold text-ink">{workflow.name}</span>{" "}
                      <span className="text-ink-soft">
                        · {workflow.operation.replace(/_/g, " ")} · {workflow.enabled === 1 ? "enabled" : "disabled"}
                      </span>
                    </summary>
                    {workflow.description ? <p className="mt-1 text-[11px] text-ink-soft">{workflow.description}</p> : null}
                    <form action={toggleWorkflowAction} className="mt-2 flex items-center gap-2">
                      <input type="hidden" name="workflowId" value={workflow.id} />
                      <input type="hidden" name="redirectTo" value="/settings" />
                      <label className="flex items-center gap-1 text-[11px]">
                        <input type="checkbox" name="enabled" defaultChecked={workflow.enabled === 1} /> Enabled
                      </label>
                      <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">
                        Update status
                      </button>
                    </form>
                    <form action={saveWorkflowAction} className="mt-2 space-y-2">
                      <input type="hidden" name="workflowId" value={workflow.id} />
                      <input type="hidden" name="redirectTo" value="/settings" />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input name="name" defaultValue={workflow.name} className="field mt-0 py-1" />
                        <select name="operation" defaultValue={workflow.operation} className="field mt-0 py-1">
                          {WORKFLOW_OPERATIONS.map((operation) => (
                            <option key={operation.value} value={operation.value}>
                              {operation.label}
                            </option>
                          ))}
                        </select>
                        <input name="modelLabel" defaultValue={workflow.model_label ?? ""} placeholder="Model label" className="field mt-0 py-1" />
                        <label className="flex items-center gap-1 text-[11px]">
                          <input type="checkbox" name="enabled" defaultChecked={workflow.enabled === 1} /> Enabled
                        </label>
                      </div>
                      <input name="description" defaultValue={workflow.description ?? ""} placeholder="Description" className="field mt-0 py-1" />
                      <textarea
                        name="workflowJson"
                        rows={8}
                        defaultValue={JSON.stringify(JSON.parse(workflow.workflow_json), null, 2)}
                        className="field mt-0 font-mono text-[10px]"
                        spellCheck={false}
                      />
                      <div className="flex gap-2">
                        <button type="submit" className="btn-secondary px-2 py-1 text-[11px]">
                          Save workflow
                        </button>
                      </div>
                    </form>
                    <form action={deleteWorkflowAction} className="mt-1">
                      <input type="hidden" name="workflowId" value={workflow.id} />
                      <input type="hidden" name="redirectTo" value="/settings" />
                      <button type="submit" className="text-[11px] text-red-700 hover:underline">
                        Delete workflow
                      </button>
                    </form>
                  </details>
                ))}
              </div>

              <form action={saveWorkflowAction} className="mt-4 space-y-2 border-t border-black/5 pt-3">
                <input type="hidden" name="redirectTo" value="/settings" />
                <p className="text-xs font-semibold text-ink">Add a workflow</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input name="name" required placeholder="Workflow name" className="field mt-0" />
                  <select name="operation" className="field mt-0" defaultValue="text_to_image">
                    {WORKFLOW_OPERATIONS.map((operation) => (
                      <option key={operation.value} value={operation.value}>
                        {operation.label}
                      </option>
                    ))}
                  </select>
                  <input name="modelLabel" placeholder="Model label (optional)" className="field mt-0" />
                  <label className="flex items-center gap-1 text-[11px]">
                    <input type="checkbox" name="enabled" /> Enable immediately (only after models are installed)
                  </label>
                </div>
                <input name="description" placeholder="Description" className="field mt-0" />
                <textarea name="workflowJson" rows={6} required placeholder="Paste ComfyUI API-format JSON here" className="field mt-0 font-mono text-[10px]" spellCheck={false} />
                <button type="submit" className="btn-secondary">Add workflow</button>
              </form>

              <details className="mt-4 text-xs">
                <summary className="cursor-pointer text-ink-soft hover:text-teal">Install a sample workflow</summary>
                <div className="mt-2 space-y-2">
                  {samples.map((sample) => (
                    <form key={sample.id} action={installSampleWorkflowAction} className="flex items-center justify-between gap-2 rounded-xl border border-black/5 p-2">
                      <input type="hidden" name="sampleId" value={sample.id} />
                      <input type="hidden" name="redirectTo" value="/settings" />
                      <div>
                        <p className="font-semibold text-ink">{sample.name}</p>
                        <p className="text-[10px] text-ink-soft">
                          {sample.operation.replace(/_/g, " ")} · {sample.description}
                        </p>
                      </div>
                      <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">Add</button>
                    </form>
                  ))}
                </div>
              </details>
            </Card>
          ) : null}

          {can(actor, "integrations.manage") ? (
            <Card title="Integrations" subtitle="Only in-app features run today. Everything else is explicitly disabled until configured.">
              <div className="space-y-2">
                {integrations.map((integration) => (
                  <div key={integration.id} className="rounded-xl border border-black/5 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-ink">{integration.display_name}</p>
                        <p className="text-[11px] text-ink-soft">{INTEGRATION_HELP[integration.kind] ?? "Requires credentials."}</p>
                      </div>
                      <Badge tone={integration.status === "connected" ? "teal" : integration.status === "error" ? "red" : "neutral"}>
                        {integration.status}
                      </Badge>
                    </div>
                    <form action={updateIntegrationAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="kind" value={integration.kind} />
                      <input type="hidden" name="redirectTo" value="/settings" />
                      <select name="status" defaultValue={integration.status} className="rounded-full border border-black/10 bg-white px-2 py-1 text-[11px]">
                        <option value="disabled">Disabled</option>
                        <option value="configured">Configured (no worker)</option>
                        <option value="connected">Connected</option>
                        <option value="error">Error</option>
                      </select>
                      <input name="feedUrl" placeholder="ICS feed URL (optional)" className="field mt-0 max-w-xs text-[11px]" />
                      <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">Save</button>
                    </form>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] text-ink-soft">
                Secrets belong in environment variables, never in the database or source control. See README → Integrations.
              </p>
            </Card>
          ) : null}

          {can(actor, "audit.read") ? (
            <Card title="Audit log" subtitle="Important actions, who performed them and when.">
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-white text-ink-soft">
                    <tr>
                      <th className="py-1 pr-2 font-semibold">When</th>
                      <th className="py-1 pr-2 font-semibold">Who</th>
                      <th className="py-1 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((entry) => (
                      <tr key={entry.id} className="border-t border-black/5">
                        <td className="py-1 pr-2 text-ink-soft">{formatDate(entry.created_at, locale, actor.timezone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="py-1 pr-2 text-ink">{entry.actor_name ?? "System"}</td>
                        <td className="py-1 font-mono text-ink-soft">{entry.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card title="Your access" subtitle="Computed server-side from your role">
            <p className="text-xs text-ink-soft">
              Role: <strong className="text-ink">{actor.role}</strong>
              {actor.isAdmin ? " · administrator" : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {actor.capabilities.map((capability) => (
                <span key={capability} className="chip font-mono text-[9px]">{capability}</span>
              ))}
            </div>
          </Card>

          <Card title="Language" subtitle="Switch the interface language for your account">
            <form action={switchLocaleAction} className="flex gap-2">
              <input type="hidden" name="redirectTo" value="/settings" />
              <select name="locale" defaultValue={actor.locale} className="field mt-0">
                <option value="en">English</option>
                <option value="bg">Български</option>
              </select>
              <button type="submit" className="btn px-3">Apply</button>
            </form>
            <p className="mt-2 text-[10px] text-ink-soft">
              Navigation, dashboard and primary actions are translated. Notes and free-text data keep the language they
              were written in.
            </p>
          </Card>

          <MobileAppSettings />

          <MobilePairingCard serverUrl={mobileServerUrl} />

          <Card title="Data & privacy" subtitle="Export or delete your own account">
            <a href="/api/account/export" className="btn-secondary w-full text-xs">⬇ Export my data (JSON)</a>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-red-700">Delete my account</summary>
              <form action={deleteAccountAction} className="mt-2 space-y-2">
                <p className="text-[10px] text-ink-soft">
                  This removes your profile and personal data. Household records you created remain with the household.
                  You cannot delete the last administrator.
                </p>
                <input name="password" type="password" required placeholder="Confirm your password" className="field mt-0 text-xs" />
                <button type="submit" className="btn-danger w-full text-xs">Delete account</button>
              </form>
            </details>
          </Card>

          <Card title="Automation" subtitle="Scheduled checks">
            <p className="text-[11px] text-ink-soft">
              Run <code className="rounded bg-sand px-1">npm run proactive:run</code> from a scheduler, or POST to{" "}
              <code className="rounded bg-sand px-1">/api/proactive/run</code> with the{" "}
              <code className="rounded bg-sand px-1">x-proactive-secret</code> header set to{" "}
              <code className="rounded bg-sand px-1">PROACTIVE_SECRET</code>.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
