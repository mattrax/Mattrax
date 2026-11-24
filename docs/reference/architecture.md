# Architecture

Mattrax is a TypeScript monorepo. Protocol code is shared; product decisions are not. That
boundary keeps protocol handling independent from product state.

## Layers

| Layer               | Packages / apps                                                                                                                                         | Responsibility                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Protocol            | `dm-apple`, `dm-windows`, `dm-android`, `scep`, `soap`, `plist`                                                                                         | Wire protocols and payloads                        |
| Management contract | `management-backend`, `management-backend-http`                                                                                                         | Interface and HMAC webhook binding                 |
| Management services | `mdm-core`, `mdm-apple`, `mdm-windows`                                                                                                                  | Shared policy/command engine and platform backends |
| Product contracts   | `enterprise-domain`                                                                                                                                     | Effect entity modules and HTTP contracts           |
| Product services    | `enterprise-api`, `enterprise-backend`, `enterprise-identity`, `enterprise-tokens`, `enterprise-billing`, `entra-id`, `apple-business-manager`, `email` | API composition, domain services and integrations  |
| Data                | `enterprise-core`                                                                                                                                       | Drizzle/MySQL schema, R2, secrets, plan limits     |
| Hosted services     | `cloud-services`                                                                                                                                        | Mail, SSO, analytics, rate limits, readiness       |
| Surfaces            | `apps/web`, `apps/cloud`, `apps/services`                                                                                                               | Dashboard, API, push relay and billing             |

The APNs relay has a single implementation in `apps/services`. Hosted Cloud
authenticates with `SERVICES_TOKEN`; self-hosted production deployments use the
same relay with their deployment licence.

## Module conventions

The domain and service packages follow Cap's Effect layout:

- `enterprise-domain` keeps one PascalCase module per entity (`Device.ts`,
  `Tenant.ts`, `Application.ts`, …). Each module owns its IDs, schemas, models,
  errors, RPC/HTTP groups and pure helpers. `enterprise-domain/src/Http/` owns
  the HTTP groups and shared parameter declarations; `enterprise.ts` is only a
  compatibility barrel.
- Service packages expose implementations, not contracts. An integration gets
  its own package when it has a distinct external dependency or deployment
  concern: `entra-id`, `apple-business-manager`, `enterprise-billing`,
  `enterprise-tokens`, `email`.
- `enterprise-api` is the HTTP composition root. It binds the domain contract
  to `enterprise-backend` services and the platform MDM backends; it does not
  own policy, storage or protocol logic.
- `enterprise-backend` groups implementations by entity (`Account/`, `Tenant/`,
  `Device/`, `Policy/`, `Scep/`, …) and exports the composition helpers the API
  package needs. Billing is composed directly from `enterprise-billing` by the
  applications; it is not re-exported through the backend barrel.
- Per-isolate caches, refresh coalescing and warning suppression are owned by
  Effect Layers so tests and embeddings can build isolated state. New verticals
  expose typed `Context.Service` contracts and keep HTTP handlers thin while the
  legacy monolithic RPC record is migrated incrementally.
- `mdm-core` owns the shared policy, command, SCEP and webhook engine;
  `mdm-apple` and `mdm-windows` own only their platform-specific backend.

## Cloud topology

```text
Browser/device ──► API Worker (Workers routes: /api/*, /mdm/*, /scim/*)
Browser ─────────► Mattrax web Worker (Custom Domain: HTML, assets, MCP)
                      │  /api/*, /mdm/*, /scim/* (dev, preview, self-host)
                      ▼
                   API Worker (service binding)
                      ├── MySQL via Hyperdrive
                      ├── R2 (application files, backups)
                      ├── Email: Cloudflare Email Sending, or SMTP directly
                      ├── email_outbox (queued transactional mail, drained by cron)
                      └── APNs relay / vendor cert
```

Both Workers answer on the same public hostname, so cookies, CSP and WebAuthn keep one
origin. Workers picks the most specific route, so `/api/*`, `/mdm/*` and `/scim/*` invoke
the API directly while HTML, assets and MCP stay on the web Worker; SSR reaches the API
over the `API` service binding. Development, previews and self-hosting keep the web
Worker's proxy routes.

- The web Worker runs globally (`placement.mode = off`) so assets and HTML render at the
  visitor's nearest edge. The API Worker is pinned to `aws:us-east-1`, close to the hosted
  MySQL origin.
- SSR normally makes **zero** service-binding calls: the API-signed five-minute
  `__Host-mattrax_ssr` token carries the user and per-tenant permissions, and the edge
  verifies it with `AUTH_SECRET`. A cold or stale token makes exactly **one**
  `GET /api/v1/bootstrap` call, which returns the session, `/me` shell, token and revision
  together. Avoid adding another SSR round trip around bootstrap.
- Public, signed-out shells (`/`, `/privacy`, `/terms`) are rendered without a session
  preload and cached per colo for five minutes (`stale-while-revalidate` for a day). The
  client loads the session after hydration. Authenticated HTML stays `private, no-store`
  because it embeds the signed-in snapshot.
- The docs are static assets with a one-hour edge cache; hashed assets are immutable.
  `_headers` supplies the same hardening for asset responses that the Worker applies to
  HTML, and `_redirects` canonicalises legacy paths and `.html` spellings.

### Self-hosted runtime

The container uses the same application code with Node entry points instead of Workers:

- `apps/cloud` owns the shared runtime (`app.ts`: routes, auth, MDM handlers and
  scheduled jobs) and the Cloudflare entry with the Workers crypto layer and
  bindings.
- `packages/cloud-services` owns the hosted-service building blocks used by that
  runtime — transport selection, SSO, analytics, rate limiting, request
  observability, readiness probes and session cookie treatment. The Worker and
  the Docker host share them; neither app reaches into the other for them.
- `apps/docker` owns the self-hosted Node entry, its Vite build and the
  `Dockerfile`; it supplies scrypt, the filesystem R2 adapter, SMTP and
  process-environment bindings, then hosts the dashboard in the same process.
- MySQL comes from `DATABASE_URL` (no Hyperdrive), object storage is the `/data`
  volume (no R2) and email is SMTP (no Cloudflare Email binding).
- The dashboard is built with `MATTRAX_TARGET=node`; `@solidjs/vite-plugin` emits a
  Node SSR server and serves `dist/client` statically. A Node shim replaces
  `cloudflare:workers` and forwards API calls to the same process over loopback.
- The host routes `/api`, `/mdm` and `/scim` to the API and everything else to the
  dashboard, then runs the cron expressions from its own scheduler.

## Request pipeline

1. Request id resolution.
2. Rate limiting (edge binding or per-isolate fallback).
3. Liveness short-circuit.
4. Readiness check for `/api/ready`.
5. Strip caller-supplied identity headers.
6. Rebuild identity from Cloudflare mTLS (`request.cf.tlsClientAuth`).
7. Build the per-request Effect layer.
8. Route through the HTTP contract.
9. Structured request log and optional error capture.
10. `x-request-id` on the response.

## Tenancy and auth

- Tenants are rows with isolated data and branding.
- Membership is `(account, tenant, role)`.
- Session cookie `__Host-mattrax_session`.
- Bearer tokens `mtx_...`, hashed at rest, scoped and optionally tenant-bound.
- Step-up grants are bound to account, session and action.
- Session client descriptors are captured on first authenticated use (the auth library
  owns session creation) and store a browser/platform family plus a salted address digest,
  never the raw `User-Agent` or address.
- Tenant-scoped queries always include the organization id.

## Secrets

| Secret                                    | Used for                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `AUTH_SECRET`                             | Sessions, sealed APNs/SCEP/device secrets, webhook secrets, WSTEP tokens |
| `CLOUD_APPLE_VENDOR_*`                    | APNs CSR signing                                                         |
| `SERVICES_TOKEN`                          | Hosted billing, entitlements and the APNs relay HMAC                     |
| `MATTRAX_LICENSE_KEY`                     | Self-hosted licence, billing and APNs relay bearer                       |
| `AZURE_CLIENT_SECRET`                     | Entra OIDC/Graph                                                         |
| `ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON` | AMAPI                                                                    |

Secrets are AES-GCM sealed with `AUTH_SECRET` before storage. Rotating `AUTH_SECRET`
requires re-sealing; there is no online re-wrap.

## Data model

Core tables:

- `organization` (tenant), `account`, `user`, `member`, `invitation`. Accounts are
  dashboard administrators; users are tenant-scoped directory people used for policy
  scoping and the MDM user channel. See [Accounts and users](/reference/identity-model).
- `device` (identity, management name, physical name, the cross-platform inventory
  columns, Windows security/join state and the applied OMA-URI delivery set),
  `device_apple` (policy delivery mode, ADE awaiting-setup/configured state, Return to
  Service request clocks and the security-report clocks),
  `device_secret` (sealed recovery key, bootstrap token, activation-lock bypass code,
  managed local-admin password, Recovery Lock password and cached Windows LAPS password),
  `device_bitlocker_key` (Entra BitLocker key metadata with a sealed cache once revealed,
  capture/report/retirement times), `device_windows_laps` (Entra backup/refresh metadata and reset
  status; never the password), `device_diagnostics_archive` (DiagnosticLog request and R2
  pointer), `device_command` (device or one
  Apple user channel via `user_id`), `device_apple_user` (per-user Apple channel: identity names, push credentials,
  bind time, last check-in and reported profiles), `device_declaration`,
  `device_application` (Apple bundle ids, Android package names and Windows product/registry
  keys share one table).
- `enterprise_group`, `group_device`, `group_policy`, `device_policy`.
- `attribute_definition` (tenant registry: key, label, type, options, required,
  visibility), `device_attribute` (one canonical value per device and definition with the
  writing user and timestamp), `enrollment_question` (which attributes the public
  enrollment page asks for) and `enrollment_answer` (answers keyed by tenant and serial
  until the device checks in).
- `policy`, `configuration`, `policy_deployment`.
- `application`, `application_group`, `application_device`.
- `script`, `script_assignment` (device or group target, tenant-scoped), `script_execution`
  (queued/terminal run per device with capped output and a unique
  `(device, script, dedupe_key)` index). `organization.scripts_enabled` is the tenant
  opt-out.
- `apple_push_certificate`, `apple_push_key`, `apple_business_manager`, `abm_device`,
  `vpp_token`, `vpp_asset`, `device_vpp_assignment`.
- `scep_ca` (one active CA per tenant, unique `organization_id`), `scep_ca_trust`
  (certificate-only, `onDelete: cascade` retained CAs and their trust deadline during a
  rotation overlap), `scep_challenge`, `scep_issued_certificate` (now records the issuing
  CA's SHA-256 fingerprint).
- `server_certificate_health` (one row for the deployment origin: the latest scheduled TLS
  probe with expiry, subject/issuer, chain length, validation result and probe error).
- `apple_fde_escrow_key` (one per tenant: escrow certificate plus the AES-GCM-sealed
  private key used to unwrap CMS recovery keys).
- `autopilot_profile`, `autopilot_device`, `android_enterprise`, `android_device`, `android_pubsub_message` (AMAPI
  resource name, policy hash and the Android-only inventory columns).
- `audit_log`: the organisation event log. One row per action with `actorType`
  (`account`/`api-token`/`system`), `category` (`account`/`mdm`/`system`), target,
  `metadata`, verified `ip`, bounded `userAgent`, optional `deviceId`
  (`onDelete: set null`), identity certificate SHA-256 fingerprint and serial, and
  `principalId` (Apple user channel), and `protocol` (`apple`/`win`/`android`). Device
  check-ins are coalesced per device, fixed time bucket, principal and presenting
  identity (`mdm.checkin`); lifecycle, delivery, status, command-result and failure events
  always append. The same table backs the settings audit page and the device activity
  feed; there is no second device-event table. `category` is assigned by
  `defaultAuditCategory`: `device.*`/`mdm.*`/`enrollment.*` are `mdm`, everything else
  written by the system actor is `system`.
- `realtime_event`: a transient, append-only notification stream (auto-increment `seq`,
  `organization_id`, `kind`, optional `device_id`/`protocol`, `created_at`). It is written
  from `writeSystemAudit` for the mapped check-in, enrollment, command-result,
  declaration and status actions and read by the dashboard's SSE endpoint;
  daily maintenance prunes it after a day. It is not a history table: audit retention
  and the activity feed still read `audit_log`.
- `webhook_endpoint`, `webhook_delivery`, `backup_run`, `subscription`,
  and `email_outbox` (one row per transactional message, claimed and retried by the
  cron with exponential backoff and a permanent-failure audit entry).
- `account_audit_log` (account-scoped audit, nullable `subject_account_id` so the deletion
  record survives), `account_session_context` (client descriptor per session id),
  `account_email_change` (single-use confirm/cancel token digests) and `account_recovery`
  (proof/approval/completion token digests for break-glass recovery).
- `organization.require_mfa` is the tenant-wide MFA requirement; `sso_config.require_mfa`
  is legacy and only read by the backfill migration.
- `tenant_deletion`: the teardown journal (no foreign key to `organization`, so it
  survives the row) and the retry record for device unenroll, Stripe cancellation, object
  reclamation and the final delete.

## Realtime invalidation and presence

Open dashboards keep MDM state in TanStack Query and invalidate it, rather than mirroring
it. `GET /api/v1/tenants/:tenantId/realtime` is an authenticated, tenant-scoped SSE
stream. It requires a verified account, tenant membership, any tenant-wide MFA
requirement, and `devices.read` (role and credential scopes); a cursor can only ever
read that tenant's rows. Each response is bounded to 25 seconds, 200 events and 100 rows
per poll (every 2.5 seconds), and ends normally so the browser reconnects with
`Last-Event-ID` (or `?after=`). Workers cannot hold a WebSocket without Durable Objects,
and pinning an isolate and a MySQL connection to one idle tab is worse than a bounded
stream: the trade-off is roughly 2.4 requests/minute per open tab and immediate
disconnect detection. The browser coalesces events in a debounce window, collapses
repeated device events, and falls back to a 60-second invalidation poll when EventSource
is unavailable or repeatedly failing. Sign-out and tenant switches dispose the
subscription.

Presence is check-in recency, not a socket: an `enrolled` device is online when
`last_seen_at` is inside a 15-minute window (the same cadence the check-in coalescing
uses), offline after that, and never online before its first check-in. The dashboard
derives it from the same row and clock on a 30-second tick, and `device.online` exposes
the server's answer next to `lastSeenAt`. Health keeps its own seven-day "stale" and
fourteen-day MIA thresholds; presence is the shorter, live signal.

Migrations live in `apps/cloud/migrations` and are applied with Drizzle Kit.

Indexes are declared for the queries that exist, not for columns in general:

- A device check-in resolves its row by `dm_identifier` (`device_dm_identifier_idx`);
  enrollment proves a departing device by `(proto, serial)`. The per-tenant indexes
  cannot serve either lookup.
- Fleet lists, CSV export, dashboards, group resolution and policy resolution read
  through an `organization_id`-leading index; a separate single-column organisation
  index is never declared when another index already leads with it. The fleet's
  `sort=name` and `sort=enrolledAt` (ascending by default) paths are ordered by
  `(organization_id, name)` / `(organization_id, enrolled_at)`; InnoDB's implicit
  primary-key suffix makes `ORDER BY name, id` and `ORDER BY enrolled_at, id`
  index-ordered, so neither composite may be dropped.
- Per-device command history reads `(device_id, created_at)`; the activity page's
  keyset pagination reads `(device_id, updated_at)`. Queue maintenance reads the
  deployment-wide `(status, expires_at)` / `(status, updated_at)` shapes.
- Device activity and the audit device filter read `audit_log` by
  `(device_id, organization_id, created_at)`; the device column leads so the same index
  also supports the `onDelete: set null` foreign key on device deletion. The activity
  feed also matches the legacy `(target_type = 'device', target_id = device.id)` pair, so
  rows written before `device_id` existed keep appearing.
- Retention sweeps delete by `created_at` (or the table's equivalent clock), so
  append-only tables carry a time index for the prune even when every read is
  tenant-scoped: `created_at` alone, or a status-leading composite such as
  `(status, created_at)` when the sweep also filters status.
- The `device` table keeps per-platform columns rather than splitting Windows state
  into a `device_windows` table: the fleet list selects the row for every device, so a
  split would add a join to the hottest read to save columns that are only written on
  Windows check-in.

## Script execution

Scripts are a product feature with a device-facing edge:

1. The dashboard queues a manual run (or an assignment changes).
2. Apple check-in builds one `com.mattrax.script` `.mobileconfig` per assigned script and
   installs it with the existing `InstallProfile` command. The diff comes from the
   device's command history, like legacy policy delivery, so no extra state table is
   needed. A queued run changes the payload's `RunID`.
3. `mattraxd` (`apps/mattraxd`) runs the body on its trigger and posts the result to
   `POST /api/v1/script-agent/results` with an HMAC device token derived from
   `AUTH_SECRET`. The token embeds the device id; the handler resolves the device and
   filters by its organization, so a token can never cross tenants.
4. The server caps and redacts output again, stores the terminal row, and writes a
   `script.run_completed`/`script.run_failed` audit entry against the device.
5. Maintenance expires queued runs past their 24-hour deadline and prunes terminal history
   past 30 days.

The agent group (`ScriptAgentApi`) is deliberately not part of the browser client
contract: it authenticates with a device token and no session.

Windows has no arbitrary-script CSP; Microsoft's supported route is an agent (the Intune
Management Extension is the same design). The agent sync endpoint returns assigned scripts
and pending run ids for the Windows build of `mattraxd`. Android Management API exposes no script command,
so Android devices are skipped with a reason.

## Protocol boundaries

- Apple: `PUT /mdm/apple/mdm`, `/mdm/apple/scep/<organizationId>`, expiring
  device-bound asset URLs and signed profiles.
- Windows: discovery, policy, enroll and SyncML management.
- Android: AMAPI client, Pub/Sub receiver and policy delivery.
- Whitelabel: the same protocol routes, with the management contract over HTTP.

## Design constraints

- No Cloudflare Queues. Bulk work is synchronous with bounded concurrency.
- Health and inventory aggregation is application-side, not indexed.
- Dynamic groups are evaluated in application code.
- The API is versioned in the path (`/v1`).
- Additive response fields are not breaking changes.

## Key files

| File                                                    | Why                                     |
| ------------------------------------------------------- | --------------------------------------- |
| `apps/cloud/src/index.ts`                               | Worker composition and request pipeline |
| `packages/enterprise-domain/src/enterprise.ts`          | REST contract                           |
| `packages/enterprise-backend/src/enterpriseHandlers.ts` | Enterprise handlers                     |
| `packages/mdm-apple/src/index.ts`                       | Apple/Windows management                |
| `packages/enterprise-core/src/schema.ts`                | Database schema                         |
| `packages/management-backend-http/src/layer.ts`         | Webhook signing                         |
| `packages/scep/src/pkcs7.ts`                            | SCEP CA and certificate issuance        |

## Next

- [Production readiness](/reference/production-readiness)
