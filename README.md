# HomeOrbit — a private family AI platform

HomeOrbit is a self-hosted family operating system and private AI platform for a Mac Studio. It
combines shared and private calendars, school runs, deliveries, shopping, meals, notes, trips and
holidays with per-person AI profiles, isolated memories, a local Ollama model selector, a ComfyUI
Image Studio, a private photo library, real movie data and an authorized web-research toolset.

It is a working application, not a mockup. Every action is validated and authorized on the server,
stored in SQLite, and logged. Where a model server or external source is not configured, HomeOrbit
says so and does not invent a result.

---

## Quick start

Requirements: **Node.js 22.17+**, npm, and macOS/Linux/Windows for development. The production
target is a Mac Studio with 64 GB unified memory.

```bash
npm install
npm run db:seed      # creates data/homeorbit.db and the demo household
npm run dev          # http://localhost:3000
```

Demo accounts (same password for all):

| Account | Role | Password |
| --- | --- | --- |
| `ivan@homeorbit.demo` | Parent / administrator | `OrbitDemo123!` |
| `maria@homeorbit.demo` | Parent / administrator | `OrbitDemo123!` |
| `alex@homeorbit.demo` | Teenager | `OrbitDemo123!` |
| `elena@homeorbit.demo` | Invited relative | `OrbitDemo123!` |

Mia, Sofia, Nikola and Lora are managed profiles without sign-in accounts.

Reset the demo at any time:

```bash
npm run db:reset && npm run db:seed
```

Production build:

```bash
npm run build
npm start
```

The database lives at `data/homeorbit.db` by default. Set `HOMEORBIT_DB_PATH` to another location.
Uploaded and generated images live under `data/media` by default; set `MEDIA_STORAGE_PATH` to a
persistent volume and back it up together with the database.

---

## What is implemented

### Personal AI profiles and memories

- ✅ Per-member AI profile: persona/instructions, interests, tone/detail/humour preferences, answer
  language, provider choice and model name.
- ✅ Configurable model selector: Auto (local Ollama first), Ollama only, external
  OpenAI-compatible, or the built-in deterministic assistant. The UI labels local versus external
  inference, vision and embedding availability.
- ✅ Explicit long-term memories with private or family scope, category and tags.
- ✅ Private memories are queryable only by their owner, including in the assistant prompt context.
- ✅ Family knowledge requires an explicit per-member opt-in (`share_family_knowledge`) and is hidden
  from invited-relative (guest) accounts. Only the owner can edit or delete a memory. Revoking the
  opt-in immediately converts the member's family memories back to private.
- ✅ Memory review, edit, delete and add UI at `/profile`. The assistant has `save_memory`,
  `list_memories`, `update_memory` and `delete_memory` (confirmation required) tools.
- ✅ Account export includes memories, media metadata, albums, movie entries and image jobs. Account
  deletion removes memories, conversations and AI preferences and soft-deletes the member's media.

### Local AI architecture

- ✅ Ollama integration via its OpenAI-compatible `/v1/chat/completions` endpoint for tool use.
- ✅ Native Ollama `/api/generate` for multimodal image descriptions and `/api/embeddings` for local
  semantic photo search.
- ✅ Provider-independent AI service layer with honest fallback: if Ollama or an external provider
  is unreachable or returns malformed tool output, HomeOrbit reports the error and answers with the
  built-in deterministic engine (without repeating a side effect that already happened).
- ✅ Small local models receive a focused subset of tools for the request, plus deterministic
  relative-date repair so “tomorrow” cannot silently become a year from the model's training data.
- ✅ Authorized web research through SearXNG (preferred) or Brave Search, plus a server-side page
  fetcher with SSRF protection: only public http(s) hosts, private/local addresses and
  model/database ports blocked, redirect re-validation, 1 MB/15 s limits, and untrusted-content
  marking.
- ✅ External use is visible: assistant replies expose the provider, model, external-model flag and
  external services used; web and TMDB tool calls are marked external in tool chips and logs.
- ✅ Credentials stay on the server. The browser only receives model names and status, never API
  keys or raw Ollama/ComfyUI/TMDB endpoints with credentials.

### Image Studio and image editing

- ✅ Complete `/studio`: text-to-image, image-to-image, inpainting, background replacement, object
  removal, restoration and upscaling where an enabled workflow supports the operation.
- ✅ Natural-language edit prompts. A source image and optional mask can be selected/uploaded.
- ✅ ComfyUI API integration: health, image upload, `/prompt`, `/queue`, `/history/{id}`, `/view`.
- ✅ A **serial image queue** (one job at a time across the household) with live status, progress,
  queue position, errors, cancellation of queued jobs and result previews/downloads.
- ✅ Workflow manager in Settings: add/edit ComfyUI API-format JSON, enable/disable, delete, and
  install seven sample workflows (disabled until reviewed). Workflow JSON validation rejects UI
  format (`nodes`/`links`) and unknown operations.
- ✅ Recorded metadata per image: owner, creation date, kind, model/workflow label, operation,
  prompt and external ComfyUI job id.
- ✅ Original uploads and edited/generated results are separate assets linked by
  `source_asset_id`; both versions are retained until explicitly deleted.
- ✅ Private library, favourites, tags, captions, albums, per-image sharing with named members and
  family albums. Family albums are hidden from guests.
- ✅ Safe uploads: magic-byte validation for PNG/JPEG/WebP/GIF/AVIF, SVG rejected, filename and
  MIME type never trusted, 25 MB default per-file limit, per-member quota, randomized server-side
  paths and authenticated `/api/media/[assetId]` URLs.
- ✅ Soft delete with configurable retention and a purge script.

### Family photo library

- ✅ Upload photos, captions, tags, dates, albums, favourites and metadata search by filename,
  caption, description, tags and date.
- ✅ Optional local vision descriptions (`OLLAMA_VISION_MODEL`) and local embeddings
  (`OLLAMA_EMBED_MODEL`) for semantic search.
- ✅ Descriptions are objective and instruction-resistant; the prompt explicitly forbids identifying
  or naming people, guessing relationships, inferring sensitive traits or creating biometric
  profiles.
- ✅ No face recognition, no automatic person labels, no biometric identity profiles.
- ✅ Search results are filtered through the same visibility rules as the gallery: private images,
  direct shares and accessible albums only. Guests never see family-library content.
- ✅ Download links, account export and documented retention/backup procedures.

### Movie and entertainment assistant

- ✅ Separate private watchlists, watched status, favourites, 1–10 ratings, notes, genres and
  language/service preferences per member.
- ✅ Real movie search and details from **TMDB** (external service), with a 24-hour detail cache.
- ✅ Regional streaming availability from JustWatch via TMDB. “Verified” is shown only when provider
  data exists for the configured region; recommendations show general movie information with an
  explicit “not verified” note until detail is opened.
- ✅ Personal recommendations use only the current member's preferences and exclude their existing
  entries.
- ✅ Explicit **Family movie night** aggregates genres from household favourites/high ratings and
  hides titles anyone has already watched. Individual watchlists are not exposed.
- ✅ With TMDB unset, no titles, dates or availability are invented; the UI explains what to
  configure.

### Shared and personal assistant

- ✅ Unified chat with conversation history per member and a live tool list.
- ✅ Server-side tools for the original family organiser plus memories, image generation/editing and
  job status, image listing/updating/sharing, photo search/description, movie search/details/
  recommendations/watchlists and web search/page fetch.
- ✅ Consequential actions create approval requests: sharing a private image, deleting a memory,
  cancelling events, changing pickups, etc. Approved actions execute **as the requester**, not as the
  approving guardian, so ownership rules cannot be bypassed.
- ✅ Tool results are displayed as returned. The assistant is instructed not to claim success when
  a tool failed, queued a job, or requested approval.
- ✅ Image job responses return the real job id and status; images appear only when ComfyUI finishes.

### Hosting, security and operations

- ✅ Custom scrypt authentication, hashed session tokens, HTTP-only/SameSite cookies, 30-day
  sessions, CSRF-resistant server actions and explicit role/capability checks.
- ✅ Household isolation on every domain query; cross-member private-resource checks at the
  database and authorization layers.
- ✅ Rate limits for sign-in, password reset, agent chat, uploads, image jobs and vision jobs.
- ✅ Audit log for media, memories, albums, workflows, account and approval events; tool execution
  log with external-service flag.
- ✅ Security headers and a restrictive partial CSP (`base-uri`, `form-action`, `frame-ancestors`,
  `object-src`); authenticated image routes add `nosniff`, sandbox CSP and private no-store caching.
- ✅ Health endpoint with public minimal status and authenticated/token-gated diagnostics: database,
  disk, queue, process memory, Ollama and ComfyUI reachability, optional integrations.
- ✅ Backup script covering SQLite (WAL checkpointed) and the complete media root; restore
  procedure below.
- ✅ English and Bulgarian navigation, page headings and primary workflows; per-member locale.
- ✅ Responsive web app/PWA with mobile navigation.

---

## Architecture

```text
src/
  app/
    (app)/                 authenticated product pages
      dashboard, calendar, assistant, profile, studio, photos, movies,
      tasks, shopping, deliveries, school, holidays, notes, household,
      notifications, approvals, settings
    api/
      agent/chat           tool-using agent endpoint
      media/[assetId]      authenticated image streaming/download
      images/jobs          list/create queued image jobs
      images/jobs/[jobId]  status/cancel
      ollama/models        installed local models for the selector
      health               public + detailed health
      account/export       personal data export
      calendar/export      ICS export
  lib/
    ai/                    Ollama, web research
    agent/                 provider abstraction, runner, tools, local engine
    domain/                authorization + business logic
    images/                ComfyUI client, samples, serial job queue
    media/                 file validation, paths, quotas, retention
    movies/                TMDB client/cache
    db/                    SQLite schema/migrations, rows, seed
    auth/                  sessions, capabilities, resource access, rate limits
  components/              UI, chat, image monitor, media cards, model selector
scripts/                   migrate, seed, reset, proactive, backup, media purge
tests/                     Vitest domain/security/queue integration tests
```

### Data model additions (migration 5)

- `member_memories` — owner, private/family scope, category, content, tags, explicit source.
- `media_assets` — owner, kind (`upload`/`generated`/`edited`), library, source asset, storage path,
  detected MIME, checksum, tags, description, caption, metadata, soft-delete timestamp.
- `albums`, `album_assets`, `album_shares`, `asset_shares` — private/family/selected sharing.
- `image_workflows` — ComfyUI API workflow JSON, operation, model label, enabled flag.
- `image_jobs` — owner, workflow, source asset, prompt, status, progress, error, provider job id,
  queue position and result asset.
- `asset_embeddings` — local embedding vectors for visible-photo semantic search.
- `movie_entries`, `movie_cache` — private lists and TMDB detail cache.
- Additional member AI/profile columns and provider/external-service metadata on messages and tool
  executions.

### Privacy model

| Data | Who can read | Who can write |
| --- | --- | --- |
| Private memory | Owner only | Owner |
| Family memory | Household non-guests (if owner opted in) | Owner |
| Private asset | Owner | Owner |
| Directly shared asset | Owner + named recipients | Owner |
| Family album asset | Household non-guests | Album owner |
| Selected album asset | Owner + named recipients | Album owner |
| Photo search results | Only assets visible to the searcher | n/a |
| Movie list | Owner only | Owner |
| AI conversation | Owner only | Owner |
| Guest account | Only explicitly shared calendars/notes/trips; no media, memories, family knowledge, AI tools or image queue | as configured |

The assistant's retrieval passes through the same actor-scoped domain functions. A prompt or model
cannot bypass these checks; tools execute with the signed-in member's actor.

---

## AI setup on the Mac Studio

### 1. Ollama

Install and start Ollama (Homebrew example):

```bash
brew install ollama
brew services start ollama
```

Pull a text model, a vision model and an embedding model. For 64 GB unified memory, useful starting
points are an 8B–32B text model (fast and leaves room for ComfyUI) or a 70B Q4 model when ComfyUI is
idle:

```bash
ollama pull llama3.1:8b
ollama pull qwen2.5:32b
ollama pull llama3.2-vision:11b
ollama pull nomic-embed-text
```

Configure `.env.local`:

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_VISION_MODEL=llama3.2-vision:11b
OLLAMA_EMBED_MODEL=nomic-embed-text
```

Each member can choose a different installed model in **My AI → Ollama model**; the selector reads
the live `/api/tags` list server-side. In “Auto” mode HomeOrbit prefers local Ollama when
`OLLAMA_BASE_URL` or `OLLAMA_MODEL` is set, then an external key. Keep port 11434 bound to localhost
or the private LAN; never forward it on the router. The app talks to Ollama server-side only.

> Standard Ollama is a text/vision/embedding server, not a text-to-image engine. HomeOrbit therefore
> uses ComfyUI for image generation and documents that limitation instead of pretending otherwise.

### 2. External OpenAI-compatible fallback (optional)

```dotenv
AI_API_KEY=...
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

When this is used, conversations leave the Mac Studio. The assistant UI shows “External model”, and
tool chips mark external services. Leave it unset for a fully local household.

### 3. ComfyUI

Install ComfyUI (Desktop or the Python package) and keep it on localhost:

```bash
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py --listen 127.0.0.1 --port 8188
```

Install a checkpoint in `ComfyUI/models/checkpoints` (for example an SDXL base checkpoint from its
official source) and note the exact filename. Check the model licence before family use.

Configure:

```dotenv
COMFYUI_URL=http://127.0.0.1:8188
COMFYUI_TIMEOUT_SECONDS=300
COMFYUI_CHECKPOINT=your-checkpoint-filename.safetensors
```

Then:

1. Open **Settings → Image workflows**.
2. Install the sample workflow for each operation you need (text-to-image, image-to-image, inpainting,
   background replacement, object removal, restoration, upscale). Samples are installed disabled.
3. Review the JSON, replace model/checkpoint names if needed, and enable each workflow.
4. Open **Image Studio**, choose an operation and workflow, enter a prompt and (for edits) choose a
   source image and optional mask.

The workflow manager accepts **ComfyUI API-format JSON exported with “Save (API Format)”**, not the
UI workflow (`nodes`/`links`). Supported placeholders:

| Placeholder | Value |
| --- | --- |
| `{{PROMPT}}` | positive prompt |
| `{{NEGATIVE_PROMPT}}` | negative prompt (empty string if absent) |
| `{{SEED}}`, `{{STEPS}}`, `{{CFG}}` | sampler values |
| `{{WIDTH}}`, `{{HEIGHT}}` | dimensions |
| `{{DENOISE}}`, `{{SCALE}}` | edit strength / upscale factor |
| `{{CHECKPOINT}}` | `COMFYUI_CHECKPOINT` or form override |
| `{{MODEL}}` | `COMFYUI_MODEL` or form override |
| `{{IMAGE}}` | uploaded source-image filename returned by ComfyUI |
| `{{MASK}}` | uploaded mask filename returned by ComfyUI |

If a placeholder is required but absent, that job fails with a clear error. Jobs are serialized
globally so several family members cannot exhaust the GPU at once. ComfyUI ports must never be
exposed publicly; HomeOrbit never sends the URL or workflow engine to the browser.

### 4. Authorized web research

Preferred: a household SearXNG instance with JSON output enabled.

```dotenv
SEARXNG_URL=http://127.0.0.1:8080
```

Alternative: Brave Search API.

```dotenv
BRAVE_SEARCH_API_KEY=...
```

The page fetcher only allows public http(s) URLs and blocks localhost, `.local`/`.internal` hosts,
private IPv4/IPv6 ranges, credentials in URLs and common database/model ports (including 11434 and
8188). It re-validates redirects, caps pages at 1 MB and 15 seconds, strips scripts/styles and
marks all web content as untrusted. Without a provider, `web_search` returns “not configured” and
never fabricates results.

### 5. Real movie data

Create a free TMDB account, request an API v4 read access token (preferred) and configure:

```dotenv
TMDB_READ_TOKEN=...
# or TMDB_API_KEY=...
TMDB_REGION=BG
TMDB_LANGUAGE=en-US
```

The movie page uses TMDB for titles, overviews, genres and release dates, and TMDB/JustWatch for
regional provider data. “Verified streaming availability” means provider data was returned for the
configured region. Recommendations intentionally carry an “availability not verified” note until
the detail view is opened. No movie data is generated locally.

---

## Environment variables

Copy [.env.example](./.env.example) to `.env.local` (development) or inject the values through your
service manager (production).

| Variable | Purpose | Default |
| --- | --- | --- |
| `HOMEORBIT_DB_PATH` | SQLite database file | `data/homeorbit.db` |
| `MOBILE_PUBLIC_URL` | Public HTTPS root URL shown as a pairing QR in Settings | unset |
| `SESSION_COOKIE_SECURE` | Force/disable secure session cookie | `true` in production |
| `OLLAMA_BASE_URL` | Local Ollama server | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Default text model | unset (built-in assistant) |
| `OLLAMA_VISION_MODEL` | Local vision model for photo descriptions | unset |
| `OLLAMA_EMBED_MODEL` | Local embedding model for semantic search | unset |
| `OLLAMA_API_KEY` | Only if Ollama is behind an authenticated proxy | unset |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | Optional external OpenAI-compatible provider | unset |
| `AI_API_KEY_HEADER` | Custom auth header name for external provider | `Authorization` |
| `AI_JSON_MODE` | Set `true` to request JSON mode | `false` |
| `COMFYUI_URL` | ComfyUI base URL | unset (Image Studio shows not configured) |
| `COMFYUI_TIMEOUT_SECONDS` | Job timeout | `300` |
| `COMFYUI_CHECKPOINT` | Default checkpoint filename | unset |
| `COMFYUI_MODEL` | Optional model placeholder | unset |
| `MEDIA_STORAGE_PATH` | Original/generated media root | `data/media` |
| `MEDIA_MAX_UPLOAD_MB` | Per-file upload limit | `25` |
| `MEDIA_QUOTA_MB` | Per-member storage quota | `2048` |
| `MEDIA_RETENTION_DAYS` | Soft-deleted file retention before purge | `30` |
| `SEARXNG_URL` | Private search provider | unset |
| `BRAVE_SEARCH_API_KEY` | Brave Search provider | unset |
| `TMDB_READ_TOKEN` / `TMDB_API_KEY` | Real movie data | unset |
| `TMDB_REGION` | Streaming availability region | `BG` |
| `TMDB_LANGUAGE` | TMDB metadata language | `en-US` |
| `HEALTH_CHECK_TOKEN` | Bearer token for detailed health checks | unset |
| `PROACTIVE_SECRET` | Cron secret for proactive checks | unset |

Never commit `.env`, `.env.local`, backups, the database or the media folder. They are gitignored.

---

## Android and iOS apps

HomeOrbit ships a Capacitor 8 native shell for **private family distribution**. The shell contains no
AI model and no family data; it loads the authenticated HomeOrbit web app from the Mac Studio. All
Next.js pages, server actions, media routes, AI tools, memories, image jobs and movie data continue
to run on the server exactly as in the browser.

The native projects live in [`android/`](./android) and [`ios/`](./ios). The setup/offline pages and
the native bridge live in [`mobile/www`](./mobile/www).

### What the native shell adds

- A first-launch setup screen with manual server URL entry and QR scanning from a photo.
- A persisted server address (Android SharedPreferences / iOS UserDefaults). Change it later from
  **Settings → Mobile app connection**, which restarts the native bridge with the new origin.
- A self-contained offline/error page with retry and a change-server link that returns to setup even
  when the saved server is unreachable.
- Native back-button handling, external links opened in the system browser, network-offline banner.
- Downloads from the private media library open the native share/save sheet instead of being trapped
  in the WebView.
- File/image inputs use the platform photo picker and camera, so uploads and mask selection work as
  they do on the web.
- Status-bar/splash-screen/keyboard integration and generated app icons.

The server URL must be the **root** address (for example `https://homeorbit.example.ts.net`). A
custom path, query, fragment or embedded credentials are rejected. `http://` is accepted only for
trusted LAN testing; use HTTPS through Tailscale/Caddy for remote use.

### Pairing a phone

1. Set `MOBILE_PUBLIC_URL` on the server to the HTTPS root address phones use.
2. Sign in on a computer and open **Settings → Pair a phone or tablet**. The pairing card shows a QR
   code and the address.
3. On the phone, open the HomeOrbit app and tap **Scan QR**. Choose a photo of the QR code (the photo
   picker works without a special camera permission), or type the address manually.
4. Sign in normally. The session cookie stays in the platform WebView; API keys and AI credentials
   never reach the app.

If the server is unreachable at launch, the native error page offers **Retry** and **Change server**.
The change-server link uses the app-local `homeorbit://setup` scheme, clears only the saved server
address and reopens setup, so the app can always recover without reinstalling. The server session
cookie remains in the platform WebView until it is signed out or the app's site data is cleared.

### Build prerequisites

| Platform | Required tooling |
| --- | --- |
| Android | Android Studio with Android SDK 36, JDK 21, an emulator or USB-debugging phone |
| iOS | macOS with Xcode 16+, an Apple ID/team for signing, a connected iPhone (or Simulator for UI testing) |

The native projects are generated and committed. After changing the setup pages, plugins or
`capacitor.config.ts`, run:

```bash
npm run mobile:sync
```

`mobile:sync` copies the setup shell and plugin manifests into both native projects. The remote
HomeOrbit app itself does **not** need to be copied into the native bundle on every web deploy; the
phone continues to load the server.

### Android

Open the project in Android Studio:

```bash
npm run mobile:android
```

Or build a debug APK from the command line (with the Android SDK and JDK configured):

```bash
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

For a release APK/AAB, create a keystore in Android Studio (Build → Generate Signed Bundle/APK),
keep the keystore and passwords out of git, and distribute the signed artifact privately to family
devices. `applicationId` is `com.homeorbit.family`. The native configuration allows cleartext HTTP
for trusted LAN testing; disable/remove that allowance before any broader distribution.

### iOS

Open the Xcode project:

```bash
npm run mobile:ios
```

In Xcode select the `App` target and configure your signing team. Run on a connected device for a
private install. A command-line archive can be produced with:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/HomeOrbit.xcarchive archive
```

Then distribute through TestFlight (paid Apple Developer account) or a private/enterprise channel.
A free personal team provisioning profile normally expires after seven days. The app uses
`NSAllowsArbitraryLoads` only to support a trusted HTTP LAN trial; use HTTPS for remote access and
review this setting before any public distribution.

### Store distribution note

This is a private web-application shell, not a public consumer app. Apple App Store guideline 4.2
and Google Play policy can reject apps that are merely a website wrapper. The intended deployment is
sideloading, TestFlight, an internal Android track, or a private MDM/enterprise channel. If public
store distribution is required, add native-only features and complete a store review plan first.

### Mobile security checklist

- Serve the app over HTTPS for any device outside the trusted home LAN.
- Keep `SESSION_COOKIE_SECURE=true` for HTTPS; set it to `false` only for an HTTP LAN trial.
- Never put Ollama (11434), ComfyUI (8188), SQLite or SearXNG admin interfaces on a public port.
- The app stores only the server URL in platform preferences. Passwords, session cookies and API
  keys are not copied into the native bundle. The WebView cookie jar is protected by the OS app
  sandbox; use device passcode/biometrics and remote wipe for lost phones.
- Sign out on shared phones; server sessions can be revoked from account settings.
- Rebuild/reinstall after changing the setup shell, native plugin code or app icons.

---

## Running the platform on the Mac Studio

### Production process

1. Build once: `npm ci && npm run build`.
2. Put secrets in the service environment (not in the repo).
3. Run `npm start` under a process manager (pm2, launchd or a container). Example pm2:

   ```bash
   pm2 start npm --name homeorbit -- start
   pm2 save
   pm2 startup
   ```

4. Bind Next.js to localhost behind a reverse proxy (`npm start -- -H 127.0.0.1 -p 3000`) and let
   Caddy/nginx/Tailscale Serve provide HTTPS.
5. Keep Ollama (11434), ComfyUI (8188), SQLite and any SearXNG admin interface off the public
   internet. Only the authenticated HTTPS web port should be reachable.
6. Set `SESSION_COOKIE_SECURE=true` for HTTPS. On a trusted isolated LAN without TLS you may set it
   to `false` for testing, but never expose that setup remotely.

### Remote access

Use a VPN or an authenticated gateway:

- **Tailscale (recommended)**: install Tailscale on the Mac and family devices, use
  `tailscale serve https / http://127.0.0.1:3000` (or a private tailnet address). Do not use a public
  Funnel unless you have separately reviewed authentication and exposure.
- **WireGuard/OpenVPN** into the home network, then browse to the Mac's private HTTPS address.
- **Caddy with local TLS** for the home network, plus VPN for remote access.

Test from outside your network: the only reachable service should be HTTPS through the VPN/gateway.
Ports 3000 (if not proxied), 8188 and 11434 must be closed. Enable the macOS firewall and do not add
router port-forwards for model servers.

### Backups

```bash
npm run backup
```

The script checkpoints SQLite WAL, uses SQLite's online backup API, copies the complete media root
to `data/backups/<timestamp>/`, writes a manifest and prints the restore instructions. Scripts read
the process environment; if your settings live in `.env.local`, load them first with
`set -a; source .env.local; set +a` (or schedule the command under the same service environment).
Schedule it
daily with cron/launchd and copy backups to an encrypted external disk or private NAS. Test a restore
periodically:

1. Stop the app.
2. Copy the database file from the backup to `HOMEORBIT_DB_PATH` (or `data/homeorbit.db`).
3. Copy `media/*` to `MEDIA_STORAGE_PATH` (or `data/media`).
4. Start the app; run `npm run db:migrate` if the backup predates a schema migration.
5. Verify sign-in, media access, queue history and memories.

Media deletion is soft: run `npm run media:purge` after the retention window to remove files and
their metadata. Backups are only as good as the last successful restore test.

### Monitoring and availability

- `GET /api/health` returns minimal `{ status, time }` without credentials.
- Send `Authorization: Bearer $HEALTH_CHECK_TOKEN` (or sign in as an administrator) for details:
  database, disk space, queue counts, memory/uptime, Ollama/ComfyUI reachability, live model count
  and optional integration status.
- A 503 means database or storage is degraded. Model-server outages are reported without failing the
  whole app; the assistant falls back to the built-in engine and image jobs fail with their real
  ComfyUI error.
- Configure an external check (Uptime Kuma, healthchecks.io, etc.) against the private HTTPS health
  URL and alert on 503. Do not expose the token in URLs or logs.

---

## Tests

```bash
npm test          # 72 tests
npm run typecheck
npm run build
```

Coverage includes authentication, permissions, private/shared calendars, trips/RSVP semantics,
pickups, notifications, the agent's approval workflow, memory isolation, media ownership and guest
access, family albums, path traversal and magic-byte validation, image queue serialization and
per-member isolation, a complete ComfyUI job through a stub HTTP server, workflow validation,
approved actions executing as the requester, focused tool-set selection for small local models,
TMDB verification with mocked HTTP, malformed local model output falling back safely without
repeating side effects, relative-date repair for weak local models, SSRF blocking for web fetch, and
native mobile server-address validation.

Manual cross-user checks worth repeating after changes:

1. Sign in as two adults. Create a private memory and a private image in one account; confirm the
   other cannot see either in the UI, search or assistant tools.
2. Share the image explicitly; confirm only the named member can open and download it.
3. Create a family album; confirm a guest relative cannot see it.
4. Queue two image jobs as two members; confirm one runs at a time and each member sees only their
   own jobs.
5. Open `/api/media/<id>` without a session and as a non-owner; both must fail.
6. Run `npm run backup` on a test database, restore to a clean directory and verify media URLs.

---

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | development server |
| `npm run build` / `npm start` | production build / server |
| `npm run typecheck` | TypeScript validation |
| `npm test` / `npm run test:watch` | test suite |
| `npm run db:migrate` | apply append-only migrations |
| `npm run db:seed` | load the demo household (idempotent) |
| `npm run db:reset` | delete the demo database (back up first in production) |
| `npm run proactive:run` | run proactive checks from cron |
| `npm run media:purge` | permanently purge soft-deleted media after retention |
| `npm run backup` | checkpoint and copy database + media |
| `npm run mobile:sync` | copy setup shell and plugins into Android/iOS |
| `npm run mobile:android` / `mobile:ios` | open the native project |
| `npm run mobile:assets` | regenerate native icons/splash from `assets/icon.svg` |

---

## Known limitations and deliberate boundaries

- **ComfyUI models/workflows are not bundled.** The samples are templates; model files, custom
  nodes and checkpoints must be installed and licensed by the household administrator.
- **Ollama does not provide a standard text-to-image API.** ComfyUI is the supported local image
  engine; no fake “Ollama image generation” path is offered.
- **No face recognition or biometric identity profiles.** Vision descriptions are objective and
  forbid person identification. A separate lawful, consented feature would be required before any
  people-labelling capability could be considered.
- **TMDB/JustWatch availability is regional and can change.** “Verified” means the source returned
  provider data, not a guarantee of playback rights.
- **External AI/search providers receive the content needed to answer the request.** Use local
  Ollama and SearXNG for a fully local setup.
- **SQLite is intended for one Next.js instance.** Do not scale horizontally without replacing the
  queue and rate-limit store.
- **No payment, booking, email/SMS or carrier integration is implemented.** Approvals do not turn
  unsupported integrations into working ones.
- **Web fetch validates DNS before connecting but is not a hardened browser sandbox.** A malicious
  authoritative DNS could theoretically rebind between validation and connection; prefer a trusted
  search provider and avoid fetching untrusted links. Model servers are blocked by host/port rules.
- **Free-text user content is not machine-translated.** The interface and primary workflows support
  English and Bulgarian; user-authored text remains as written.
- **The optional integration placeholders remain disabled** until a real OAuth/worker implementation
  is added. ICS export/import works today.
