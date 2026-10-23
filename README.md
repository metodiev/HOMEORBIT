# HomeOrbit — your family's AI assistant

HomeOrbit is a self-hosted family operating system: shared and private calendars, school runs,
deliveries, shopping, meals, notes and holidays — coordinated by a tool-using AI assistant that
works with real family data and asks before it acts.

This repository is a complete, runnable first version, not a mockup. Every button is connected to
validated server-side code and SQLite persistence. Where an external service is not configured,
HomeOrbit says so instead of pretending.

---

## Quick start

Requirements: **Node.js 22.17+** and npm.

```bash
npm install
npm run db:seed      # creates data/homeorbit.db and a demo household
npm run dev          # http://localhost:3000
```

Sign in with a demo account (all demo accounts use the same password):

| Account | Role | Password |
| --- | --- | --- |
| `ivan@homeorbit.demo` | Parent / administrator | `OrbitDemo123!` |
| `maria@homeorbit.demo` | Parent / administrator | `OrbitDemo123!` |
| `alex@homeorbit.demo` | Teenager | `OrbitDemo123!` |
| `elena@homeorbit.demo` | Invited relative | `OrbitDemo123!` |

Mia, Sofia, Nikola and Lora are managed profiles without sign-in accounts, exactly like children
or relatives who do not have an email address.

Reset the demo at any time:

```bash
npm run db:reset && npm run db:seed
```

Production build:

```bash
npm run build
npm start
```

The database lives at `data/homeorbit.db` by default. Set `HOMEORBIT_DB_PATH` to use another
location (recommended in production, on a persistent volume).

---

## What is implemented

### Foundation and security

- ✅ Household registration, sign-in, sign-out, invitations, password reset (self-service in
  development and one-time links from an administrator in production), account export, and account
  deletion by anonymisation with immediate session revocation.
- ✅ Eight seeded profiles (six primary members plus two invited relatives), configurable names,
  colours, avatars, relationships, time zones, locales and birthdays.
- ✅ Role-based permissions enforced **server-side**: every domain function receives the signed-in
  actor and checks capabilities and resource-level access before reading or writing.
- ✅ Private events are visible only to their creator. Guardians cannot read another adult's
  private event or private note.
- ✅ Personal calendars are private; sharing is explicit. Guardians can coordinate a child's
  calendar but not another adult's.
- ✅ Household-level data isolation on every query.
- ✅ scrypt password hashing, hashed session tokens in HTTP-only cookies, 30-day sessions,
  rate-limited sign-in/reset/invite/agent endpoints.
- ✅ Audit log for sensitive actions, plus a per-tool execution log.
- ✅ Security headers, request validation (Zod) on every agent tool, 2 MB ICS limit, 4,000-character
  agent message limit.
- ✅ Prompt-injection guardrail: tool output (notes, imported calendar text) is treated as
  untrusted data, never as instructions.

### Family organiser

- ✅ **Dashboard** "Today in our family": daily briefing, agenda, seven-day strip, proactive
  attention list, school-run status, approvals, activity feed, quick add, and per-member widget
  preferences.
- ✅ **Calendars**: month, week and day views; personal/shared/colour-coded calendars; explicit
  sharing; events with participants, location, notes, visibility, travel/prep time, reminders,
  recurrence (daily/weekly/monthly/yearly with `BYDAY`, `INTERVAL`, `COUNT`, `UNTIL`), exceptions,
  RSVP, conflict detection, common-free-slot search, ICS import/export with duplicate prevention.
- ✅ **School & kids**: timetables, early dismissals, drop-offs/pickups, responsible adults,
  confirmation and completion reported by a member, missing-arrangement alerts, guardian access.
  "Confirmed" means the adults agreed the arrangement — never GPS proof of arrival. Location
  tracking is intentionally absent.
- ✅ **Deliveries & errands**: packages, expected windows, collection deadlines, pickup points,
  collection codes, assigned collector, status history with the reporting member. Carrier tracking
  APIs are not configured, so statuses are always member-reported.
- ✅ **Calls**: missed calls, callbacks, reasons, deadlines and follow-up status.
- ✅ **Shopping**: multiple lists, quantities, priorities, assignees, duplicate merging, bought
  items, clear-bought, low-stock suggestions.
- ✅ **Meals, recipes, inventory**: recipe storage, weekly meal plan, ingredient-to-shopping-list
  generation, stock levels with minimum thresholds.
- ✅ **Notes & documents**: shared/private/restricted notes, sensitive flags, per-person sharing,
  search, category filters.
- ✅ **Holidays & trips**: computed public holidays for Bulgaria, the US, UK, Germany, Greece and
  Romania; trips, invitations for members and guests, RSVP summaries where **only `accepted`
  counts**, polls, trip checklists.
- ✅ **Notifications**: in-app, per-category mute, quiet hours (high urgency bypasses), dedupe keys,
  read state, daily briefing and event reminders.
- ✅ **Proactive intelligence**: conflicts, missing pickups, deliveries needing someone home,
  unanswered invitations, birthdays, due tasks, urgent shopping, holidays without a plan, meal-plan
  gaps.
- ✅ **PWA**: installable manifest, offline caching of static assets only, responsive mobile layout
  with bottom navigation.
- ✅ **Localization**: English and Bulgarian navigation, dashboard and primary actions; per-member
  language preference. Free-text data is not translated.

### AI assistant

- ✅ A real tool-using agent with **28 server-side tools** (`get_family_agenda`,
  `search_calendars`, `check_member_availability`, `detect_schedule_conflicts`, `create_event`,
  `update_event`, `cancel_event`, `request_event_confirmation`, task/shopping/package/call/reminder
  tools, notes, polls, RSVPs, meals, trips, school pickups and weekly summaries). See
  `/assistant` for the live list.
- ✅ Provider abstraction with an **OpenAI-compatible** client (works with OpenAI, Azure OpenAI,
  OpenRouter, Ollama, LM Studio, vLLM) and a **built-in deterministic assistant** that works with
  no key at all. The UI clearly labels which mode is active.
- ✅ Conversation history per member, tool execution audit, and honest failure handling: if the
  model is unreachable, HomeOrbit falls back to the local engine and says so.
- ✅ Consequential actions (cancel an event, edit someone else's event, reassign an existing
  pickup, share sensitive notes) create an **approval request**. Nothing executes until a guardian
  approves it. Children cannot approve their own requests.
- ✅ The assistant refuses to invent availability, delivery status, arrivals or attendance, and
  refuses unsupported integrations.

---

## Architecture

```
src/
  app/                     Next.js App Router pages and API routes
    (app)/                 authenticated product (dashboard, calendar, assistant, …)
    api/agent/chat         agent endpoint
    api/calendar/export    ICS export
    api/account/export     account data export
    api/proactive/run      cron entry point
  components/              responsive shell, nav, UI primitives, chat
  lib/
    db/                    SQLite connection, migrations, seed
    auth/                  sessions, passwords, capabilities, resource access
    domain/                events, tasks, shopping, packages, school, trips, notes, meals, …
    agent/                 tool registry, local engine, provider, orchestrator
    proactive/             insight rules, notifications, reminders
    actions.ts             server actions used by forms
tests/                     Vitest suite (53 tests)
scripts/                   migrate, seed, reset, proactive
```

- **Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4, SQLite via
  `better-sqlite3`.
- **Storage:** UTC timestamps; IANA time zones; local wall-clock recurrence expansion that is
  DST-safe.
- **Why SQLite:** a family-sized single-node deployment needs no extra service. The data layer is
  isolated in `src/lib/db`, so a Postgres adapter is a contained change. It is not designed for
  multi-instance horizontal scaling as shipped.

### Data model (main entities)

`households`, `members`, `sessions`, `invitations`, `password_reset_tokens`, `calendars`,
`calendar_shares`, `events`, `event_participants`, `tasks`, `reminders`, `shopping_lists`,
`shopping_items`, `packages`, `package_updates`, `calls`, `notes`, `note_shares`, `recipes`,
`meal_plan`, `inventory_items`, `school_days`, `pickups`, `trips`, `trip_rsvps`, `polls`,
`poll_options`, `poll_votes`, `notifications`, `approval_requests`, `agent_conversations`,
`agent_messages`, `tool_executions`, `audit_log`, `integrations`.

Migrations are append-only in `src/lib/db/schema.ts` and run automatically on first database use.
Seed data is in `src/lib/db/seed.ts` — all names and data are fictional.

### Roles

| Role | Typical access |
| --- | --- |
| `parent` | Everything; guardians can approve consequential requests, manage members, integrations and audit |
| `adult` | Calendars, tasks, shopping, packages, calls, notes, trips, meals, assistant; cannot manage the household |
| `teen` | Own/shared calendars, tasks, shopping, private or shared notes, meals, assistant |
| `child` | Shared information, own calendar, tasks, shopping, assistant (no sensitive notes or school admin) |
| `relative` | Only calendars/trips explicitly shared with them; can RSVP; no household-wide data |

Per-member `grant`/`revoke` capability overrides are stored and editable in **Settings → Manage
member → Extra / revoked capabilities**.

---

## AI provider configuration

The assistant works out of the box in local mode. To connect a model, copy `.env.example` to
`.env.local` and set:

```bash
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

Any OpenAI-compatible `/chat/completions` endpoint works. For local Ollama:

```bash
AI_API_KEY=ollama
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_MODEL=llama3.1:8b
```

The model receives a system prompt with the household context and the tool catalogue. Tool calls
are executed server-side with the signed-in member's permissions — the model cannot bypass them.
If the endpoint errors or times out (60 s), the request falls back to the local deterministic engine
and clearly reports the fallback.

---

## Integrations

Only in-app features are active. Everything else is explicitly **disabled** in
`Settings → Integrations` until credentials and a worker exist.

| Integration | Status | To enable |
| --- | --- | --- |
| ICS import/export | ✅ working | No credentials. Import dedupes by UID and by title/start/end fingerprint |
| Google Calendar sync | ◐ interface + settings only | Google Cloud OAuth client, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, consent + sync worker; map calendars |
| Microsoft Outlook | ◐ interface + settings only | Azure app registration, `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`, Calendars.ReadWrite |
| Apple / iCloud | ◐ read-only feeds only | Add an iCloud ICS feed URL; no public two-way API |
| Email import | ◐ settings only | IMAP credentials, sanitisation, and a worker; imported content must remain untrusted |
| Web push | ◐ settings only | VAPID keys (`WEB_PUSH_PUBLIC_KEY`/`WEB_PUSH_PRIVATE_KEY`) + push worker |
| Telegram | ◐ settings only | `TELEGRAM_BOT_TOKEN` + verified chat ids per member |
| WhatsApp | ◐ settings only | WhatsApp Business API account and approved templates |
| Carrier tracking | ◐ settings only | Per-carrier API credentials; otherwise status stays member-reported |
| Payments / bookings | ✗ intentionally absent | Would require a payment provider and an explicit approval workflow |

Credentials belong in environment variables, never in the database or source control.

---

## Scheduled checks (cron)

HomeOrbit does not run its own daemon. Trigger proactive checks and reminders with either:

```bash
npm run proactive:run
```

or an HTTP call:

```bash
curl -X POST http://localhost:3000/api/proactive/run \
  -H "x-proactive-secret: $PROACTIVE_SECRET"
```

A signed-in administrator can also trigger it from the dashboard. Example cron entry (Linux):

```cron
*/15 * * * * cd /srv/homeorbit && PROACTIVE_SECRET=... npm run proactive:run >> /var/log/homeorbit.log 2>&1
```

Notifications are deduplicated, so running the job frequently does not spam the family.

---

## Tests

```bash
npm test           # 53 Vitest tests
npm run typecheck
npm run build
```

The suite covers:

- private event visibility, cross-household isolation, sensitive notes and role capabilities;
- authentication, invitations, password reset and password hashing;
- conflict detection, safe availability windows, DST-safe recurrence and ICS import de-duplication;
- the local agent answering from real data, creating real rows, falling back when the model is
  unreachable, and never treating unconfirmed relatives as attending;
- approval gating and guardian-only approval of a child's request;
- notification quiet hours, category mutes and dedupe;
- school-run creation, assignment, confirmation semantics and relative restrictions;
- trip invitations, guest RSVPs, polls and checklist generation;
- recurring tasks and assignment permissions.

A browser-based end-to-end suite (Playwright) is not committed. The responsive UI, sign-in,
calendar, agent, approvals and all main pages were manually smoke-tested in a real browser at
desktop and mobile widths.

---

## Deployment notes

1. Use Node 22.17+ and a persistent volume for `HOMEORBIT_DB_PATH` (e.g. `/data/homeorbit.db`).
2. Set a long random `PROACTIVE_SECRET` and serve over HTTPS (session cookies are `Secure` in
   production).
3. Back up the SQLite database together with its `-wal` file, or use `sqlite3 .backup`.
4. Put self-registration behind your usual controls if this instance is public; anyone who can
   reach `/register` can create a household.
5. Configure the AI key if you want an LLM. Without it, the local assistant remains fully usable.
6. Run `npm run db:seed` only for demos; it is skipped automatically if the demo household exists.

---

## Known limitations

- External calendar sync, email import, push, Telegram, WhatsApp and carrier tracking are designed
  for but **not implemented**; only ICS import/export is real.
- There is no outbound email service, so invitation and reset links are shown once in the app and
  must be shared privately by an administrator. Self-service reset links are shown on screen only in
  development. Wire an email provider before inviting people outside your household.
- File attachments are represented as links on notes; binary upload/storage is not implemented.
- Localization covers navigation, dashboard and primary actions; domain text and seeded content are
  English.
- Search uses SQL `LIKE`, not full-text indexing.
- Recurrence supports a practical RFC 5545 subset with a 2,000-occurrence safety bound.
- The built-in local assistant is deterministic and intentionally simpler than an LLM. It handles
  agendas, availability, conflicts, shopping, reminders, notes, school runs, packages, holidays,
  meals and summaries, but free-form reasoning requires a configured model.
- SQLite is single-node; there is no built-in horizontal scaling or multi-tenant administration.
- No location tracking, payments or travel booking — by design.

---

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run db:seed` | Create demo household (idempotent) |
| `npm run db:reset` | Delete the SQLite database |
| `npm run db:migrate` | Apply migrations without seeding |
| `npm run proactive:run` | Run proactive checks and due reminders |
| `npm test` | Run the Vitest suite |
| `npm run typecheck` | TypeScript check |
