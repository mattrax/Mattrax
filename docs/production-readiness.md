# Production readiness

This page tracks what is required to run mattRAXe for real fleets, what was
recently hardened, and what remains. It is intentionally separate from the
architecture notes in the porting plan.

## Recently hardened

- Cloud MDM/SCEP/Windows routes now receive their service layers, so
  `/mdm/apple/scep`, `/mdm/apple/mdm` and `/mdm/windows/*` no longer return 500
  from a missing service.
- Password-reset and passwordless email delivery is awaited inside the request
  instead of being dropped by a request-scoped scheduler. Delivery failures are
  logged.
- The development mailbox is restricted to loopback origins (or an explicit
  remote opt-in plus shared secret).
- Whitelabel management webhooks fail closed when no secret is configured.
- Product-key signatures use one shared hex encoding and timing-safe comparison.
- Cloud Windows MDM is tenant-scoped. Enrollment links carry an HMAC-signed
  tenant token (tenant id, issued-at, expiry) that discovery verifies and
  policy/enroll preserve; the WSTEP token is bound to the same tenant. The
  deployment-wide `WINDOWS_ORGANIZATION_ID` pin is now an optional legacy
  fallback, not a prerequisite.
- The dashboard Worker sends CSP, HSTS, `X-Frame-Options`, `nosniff` and a
  referrer policy. Preview URLs are disabled in production.
- Migration snapshots are present for every migration and `db:generate`
  produces no spurious diff.
- Daily maintenance runs via a Worker Cron Trigger: expired invitations, stale
  devices, expired auth proofs/sessions and audit retention.
- Audit logs have a filterable, cursor-paginated search endpoint
  (`GET /v1/tenants/:tenantId/audit/search`) and CSV/JSON export with the same
  filters, a 10k-row cap and an `X-Export-Truncated` header. Device lifecycle
  events (enrollment, check-out, failed/deferred commands, declaration failures
  and dead APNs tokens) are written by a system actor on state transitions
  only, never per check-in. The legacy `/audit-log` endpoint remains for older
  dashboard bundles.
- Device lists have server-side search, filters, sort, pagination and CSV export.
  Group detail loads only its own devices. The `health` filter is derived from
  declarations/inventory rather than a stored column, so it evaluates the
  tenant's devices in application code (bounded by the tenant, not the whole
  fleet); it is not indexed.
- Groups can be `manual` (unchanged) or `dynamic`. Dynamic groups store a
  versioned rule set (`platform`, OS comparisons, model/serial/asset-tag
  matches, stale days and health) and materialise matches into `group_device`
  with `source = 'dynamic'`. Recomputes run on group create/update, on device
  create/update/inventory check-in (evaluating that one device against the
  tenant's dynamic rules) and in daily maintenance (full tenant-scoped pass).
  Manual `group_device` rows are never removed by a recompute and act as
  explicit exceptions; device assign/unassign is rejected for dynamic groups.
  `GET /v1/tenants/:tenantId/groups/:id/preview` returns a live match count for
  the dashboard. Evaluation is application-side and not indexed:
  check-in cost is `O(dynamic groups in tenant)` and a full recompute is
  `O(devices × dynamic groups)`, including declaration loads for health rules.
- `maxDevices = 0` means unlimited, and the enrollment page shows the Windows
  discovery URL and an accurate Android availability state.
- Authenticator-app MFA is available on `/account`. Enrollment shows a QR code
  and manual key, confirmation returns one-time recovery codes, and management
  (disable/regenerate) requires the current password plus a current code. TOTP
  secrets are stored as AES-GCM envelopes keyed from `AUTH_SECRET`; recovery
  codes are stored only as SHA-256 digests. Password, email-code and Entra SSO
  sign-in return a pending-MFA result for enrolled accounts, and the session
  cookie is not issued until the code (or a recovery code) is verified. Password
  and email-code login for accounts without MFA is unchanged. Enrolled accounts
  must sign in with password + authenticator: an email code or SSO assertion is
  possession-only and cannot replace the password factor.
- Passkeys (WebAuthn) are available on `/account` alongside authenticator apps.
  The relying party is derived from `ORIGIN` (never from request input): the RP
  id is the origin host and the allowlist is `ORIGIN` plus same-site
  `TRUSTED_ORIGINS`. Registration, assertion verification, sign counters and
  replay protection are owned by `@yielded/auth` with the maintained
  SimpleWebAuthn verifier; credentials are stored in `auth_passkeyCredentials`
  and in-flight challenges in `auth_passkeyFlows`. A passkey is a
  phishing-resistant, user-verified possession factor: it satisfies MFA on its
  own, works for passwordless/SSO accounts, and completes a pending password,
  email-code or SSO sign-in. Accounts with a passkey or an authenticator are on
  the MFA requirement, and `user.passkey_enabled` is maintained by the auth
  lifecycle hook so sign-in policy follows credential state. Adding or
  removing a key requires a recent step-up; removal invalidates other sessions
  and refuses to leave the account without a usable sign-in method.
- A tenant can require MFA for its owners and admins
  (`sso_config.require_mfa`, exposed under Settings → Identity). Owners/admins
  with neither an authenticator nor a passkey are blocked from that tenant's
  APIs with a 403 and an account-page prompt; members keep read access.
- Sensitive actions require a recent step-up: tenant deletion, API token
  creation/revocation, backup download, FileVault recovery-key reveal, billing
  portal access and SSO/MFA policy changes. The browser confirms with a
  password, authenticator code or passkey; the server issues a five-minute
  grant bound to the account, session and action, and the action retries with
  `x-mattrax-step-up`. Missing or expired grants return a typed
  `StepUpRequired` 403 carrying the action and available factors. Bearer tokens
  are exempt because they are already an explicitly issued, scoped credential.
  TOTP disable/regenerate additionally require the current password plus a
  current code. See `docs/self-hosting.md` for RP/origin requirements and
  lockout recovery.
- Device health rolls up enrollment state, last-seen age, declaration failures,
  FileVault and battery condition, and reported disk pressure, with a tenant
  dashboard summary and device detail card. Identity certificate state is
  summarized separately under credential health (it is not part of the device
  health level).
- DDM status items are persisted as device inventory (FileVault, battery health,
  model number, client capabilities, disk usage) with a tolerant parser for
  nested and flattened keys, exposed through the API, device detail and CSV
  export.
- Apple `SecurityInfo` results escrow the FileVault recovery key and bootstrap
  token in `device_secret`, sealed with `AUTH_SECRET`; device detail exposes
  escrow presence only and the reveal endpoint requires owner/admin and writes
  `device.recovery_key_viewed` to the audit log. `InstalledApplicationList`
  results replace `device_application` rows on every refresh, and the tenant
  Software page exposes search, managed/update filters and per-app device
  counts. Real-device validation of both commands is still outstanding.
- Credential monitoring summarizes APNs and SCEP CA expiry with days-left
  badges on the tenant dashboard and a `GET /v1/tenants/:tenantId/credential-health`
  endpoint. Daily maintenance writes one audit event per tenant per expiry
  threshold (30/7/expired) per day, and emails the tenant's enabled owner/admin
  users once for each new alert (deduped by the audit event). Delivery uses the
  Cloud `EMAIL` binding from `hello@mattrax.cloud` and is best-effort: a missing
  binding or provider failure is logged and never fails maintenance. There is no
  per-user opt-out, no retry queue and no self-hosted (`mttx`) delivery yet.
- SCEP identities can be revoked per device; unenrollment/deletion revokes
  device-scoped certificates and renewal rejects revoked identities. Apple
  certificates are bound to the internal device on Authenticate/TokenUpdate
  using the mTLS identity-certificate serial, so revocation, renewal checks,
  credential health and the device certificate list apply to Apple as well as
  Windows. This requires the edge to forward
  `x-device-identity-certificate-serial`; self-hosted deployments that do not
  forward it keep tenant-scoped certificates without per-device binding.
- APNs delivery outcomes are recorded per device (`last_push_at`,
  `last_push_ok_at`, `last_push_error`, consecutive failures). Invalid tokens
  (`BadDeviceToken`, `Unregistered`, HTTP 410) are surfaced as "device must
  re-enroll", the tenant dashboard summarizes delivery health via
  `GET /v1/tenants/:tenantId/push-health`, and device search accepts
  `push=failing|invalid`.
- Device detail has an aggregated activity timeline
  (`GET /v1/tenants/:tenantId/devices/:id/activity`) merging audit events,
  commands, declaration changes, certificate issue/revocation and lifecycle
  timestamps. It is computed from existing tables; a dedicated event table is a
  later optimisation.
- The global SCEP CA private key is sealed at rest with AES-256-GCM keyed from
  `AUTH_SECRET` in the existing JSON column (`{ "v": 1, "sealed": "..." }`).
  Legacy plaintext rows are sealed on first read; a missing secret, wrong secret
  or tampered value fails closed instead of regenerating the CA. The same
  storage applies to the filesystem gateway (`scep-ca.json`) and the whitelabel
  D1 example. Rotating `AUTH_SECRET` now makes the CA key unreadable, so re-seal
  before rotating (see [self-hosting](./self-hosting#rotating-auth_secret)).
- Outbound calls have deadlines and bounded retries: APNs HTTP/2 connect+request
  (10s, session destroyed on timeout), mTLS/relay fetches (10s), Microsoft Graph
  token/read calls (15s per attempt, existing single retry preserved), the push
  helper (11s backstop) and the Stripe SDK (`timeout: 15s`,
  `maxNetworkRetries: 2`). The shared constants live in `@mattrax/net`.
- Every API response carries `x-request-id` (a valid caller-supplied id is
  propagated, otherwise a UUID is generated). One structured JSON log line per
  request records method, path (no query string), status, duration, tenant id
  from the URL and the Effect error tag. Bodies, cookies, tokens and email
  addresses are never logged; uncaught errors are logged once with a redacted
  message. Successful health/readiness probes are not logged.
- `GET /api/ready` runs a cheap `select 1` through the Db layer with a 2s
  timeout and returns 200/503 plus the package version and Cloudflare version
  id. `GET /api/health` remains the dependency-free liveness response.
- Rate limits apply to auth POSTs, `/api/v1/enrollment/*`,
  `/api/v1/billing/webhook`, `/scim/*` and `/mdm/*` (SCEP separately). A 429
  has a stable JSON body and `Retry-After`.
  Cloudflare's Rate Limiting binding is used for every bucket when the
  deployment supplies a namespace (`RATE_LIMITER_AUTH`, `_ENROLLMENT`, `_MDM`,
  `_SCIM`, `_BILLING`, `_SCEP`); otherwise that bucket uses the per-isolate
  fallback.
- APNs fan-out is bounded (12 in flight, chunked) and returns per-batch
  succeeded/failed/skipped device ids. One undecryptable key or failed delivery
  no longer aborts the rest of the group. Bulk group/policy/application deletes
  and re-syncs fan out with the same bound and collect per-item results. The
  public API success shapes are unchanged, so the push summary is available to
  server-side callers (and logged as a single batch warning); exposing it to
  clients needs a future schema change or a job id from Queues.
- Entra directory sync takes a tenant-scoped lock on `entra_directory_sync`
  (`status = running`) with a 15-minute stale takeover, applies each Graph page
  in its own transaction, and persists each resource class's delta cursor as
  soon as it completes. A failure records `lastError`, sets `status = error`
  and leaves the previous cursor usable. Owners can also run it on a schedule:
  **Settings → Identity → Directory sync** offers Off/Hourly/Daily/Weekly, and
  an hourly cron sweeps due tenants with bounded concurrency and per-tenant
  failure isolation (the daily job runs it too, so single-cron deployments still
  sync). Scheduled runs use the same lock, cursors and status fields, and are
  skipped for tenants without an Entra tenant id or a deployment without Graph
  credentials. Real-Entra validation of the scheduled path remains (see below).
- Tenant owners can export a versioned JSON bundle
  (`GET /v1/tenants/:tenantId/export`) and import it as a new tenant
  (`POST /v1/tenants/import`). The bundle carries profile/branding, groups,
  policies/configuration, application metadata, enrollment settings and
  pre-registrations; it excludes credentials, token hashes, private keys and R2
  bytes. Import re-maps ids, derives a free slug and runs in one transaction;
  members, devices, audit history and SCEP certificates are not imported.
  [Self-hosting](./self-hosting#backups) now documents the MySQL/R2/secrets
  backup and restore order, key-rotation caveats and bundle limits.
- Scheduled tenant backups are implemented. The daily maintenance run backs up
  every tenant after maintenance with bounded concurrency, writes
  `backups/<organizationId>/<timestamp>.json` to R2, and records each attempt in
  `backup_run`. Owners can run a backup now, see recent runs and download a
  retained bundle from **Settings → General → Data and backups**; R2 objects are
  never public and downloads are authenticated. Runs (scheduled and manual) are
  pruned after `MAINTENANCE_BACKUP_RETENTION_DAYS` (default 30); `retention =
  pinned` opts a row out. One tenant failing is recorded and skipped, not fatal
  to the sweep. This complements, but does not replace, MySQL dumps, R2 object
  mirroring and an off-site copy of `AUTH_SECRET`.

- Stripe billing is wired: `POST /api/v1/billing/webhook` verifies signatures,
  syncs subscription created/updated/deleted and invoice events, maps Stripe
  failures to `EnterpriseStripeError`, and returns a clear unconfigured state
  instead of a 500. Plan/seat enforcement is configurable through the optional
  `MATTRAX_PLAN_LIMITS` JSON secret (see
  [Self-hosting → Plan and seat limits](./self-hosting#plan-and-seat-limits)).
  Limits apply to public enrollment readiness, Apple `Authenticate`, Windows
  enrollment, Android enrollment-token issuance, pre-registration imports and
  tenant creation. Existing devices over a lowered limit stay manageable; the
  billing page shows usage against limits and an over-limit warning. Without the
  secret, all plans remain unlimited.
- RBAC adds the `auditor` read-only tenant role. Account API tokens can be
  read-only or read/write and optionally bound to one tenant; tenant data
  access enforces both the token scope and the user's role.
- Audit search/export and system lifecycle events are implemented (see above).
- Tenant branding drives the public enrollment page, Apple profile, DDM
  organization declaration, invitation emails and whitelabel/self-host configs.
- Policy assignments support priority, per-group/device include/exclude modes and
  a device effective-policy preview shared by Apple and Windows delivery.
- Outbound customer webhooks are implemented with HMAC signatures, event
  filtering, SSL/private-address guards, delivery history and bounded retries.
- Credential-expiry alerts now email enabled tenant owners/admins once per
  threshold per UTC day through the Cloud `EMAIL` binding.
- The global SCEP CA is sealed at rest and tenant-scoped Windows enrollment,
  Apple per-device SCEP binding, FileVault recovery-key escrow and installed
  software inventory are implemented.

## Apple Business Manager (ABM/ADE) and Apps & Books (VPP)

Mattrax implements the current Apple Business/School Manager OAuth API and the
Apps and Books v2 API. Credentials are tenant-scoped and sealed with
`AUTH_SECRET`; every endpoint fails closed when a tenant has no valid credential
or when Apple rejects it.

### Credentials and endpoints

- **ABM API account.** In Apple Business Manager → Settings → API, create an
  API account with device/device-management-service permissions, download the
  private key (`.pem`), and copy the **Client ID** and **Key ID**. Upload the
  PEM plus both ids under **Settings → Management → Apple Business Manager**.
  Mattrax accepts a JSON bundle too. The key must be an unencrypted PKCS#8
  EC P-256 key (`-----BEGIN PRIVATE KEY-----`); convert Apple's `.p12` with
  `openssl pkcs12 -in key.p12 -nocerts -nodes | openssl pkcs8 -topk8 -nocrypt`.
- **Legacy DEP token.** A `.p7m` server token is parsed, validated and stored so
  an administrator can see its organization/expiry, but it is **not** used for
  sync. The current API is OAuth; create an API account and replace the token.
  Sync reports this migration explicitly instead of failing silently.
- **OAuth flow.** Mattrax builds an ES256 client assertion
  (`aud=https://account.apple.com/auth/oauth2/v2/token`, `iss`/`sub` = Team/Client
  ID, `kid` = Key ID, 5-minute expiry, unique `jti`), exchanges it at
  `https://account.apple.com/auth/oauth2/token` with
  `grant_type=client_credentials`, and uses the one-hour bearer token against
  `https://api-business.apple.com/v1` (or `api-school.apple.com` for
  `school.api`). Tokens are never persisted.
- **Apps and Books content token.** Download the `.vpptoken` from Apple Business
  Manager → Apps and Books and upload it under **Settings → Management → Apps
  and Books**. The content token is a base64 JSON object (`token`, `expDate`,
  `orgName`); Mattrax validates its structure/expiry, seals it, and sends the
  whole value as the bearer token to `https://vpp.itunes.apple.com/mdm`.

### Sync, assignment and licensing

- `POST /v1/tenants/:tenantId/abm/sync` pages through `GET /v1/orgDevices`,
  upserts `abm_device` by `(organizationId, serial)`, links a matching enrolled
  `device` row, and marks local serials that Apple no longer returns as
  `REMOVED`. The sync is bounded to 5,000 devices.
- `POST /v1/tenants/:tenantId/abm/devices/:serial/assign` finds or creates a
  device management service (`POST /v1/mdmServers`, using the tenant's APNs
  certificate) and assigns the device with `POST /v1/orgDeviceActivities`
  (`ASSIGN_DEVICES`). It records the MDM server id and activity id.
- `GET /v1/tenants/:tenantId/abm/devices/:serial/profile-url` returns a
  short-lived, HMAC-signed, tenant/serial/profile-bound ADE `.mobileconfig` URL.
  `GET /v1/abm/ade/:token` is the public profile endpoint; it re-checks that the
  device is still assigned to the tenant and that the profile revision matches.
  The mobileconfig reuses the existing SCEP and `com.apple.mdm` payloads with an
  ADE-specific display name/identifier and a stable profile UUID.
- **Known ABM gap.** Apple's current API assigns devices to a management service;
  it does not expose a per-device "ADE profile UUID" assignment. Mattrax tracks
  its own stable profile UUID and serves the profile URL, but automatic delivery
  of that profile inside the ADE `Authenticate` check-in response is **not yet
  wired** — the existing MDM check-in still returns an empty `Authenticate`
  response. Validate this path against a real ABM-assigned Mac/iOS device before
  claiming zero-touch enrollment.
- `POST /v1/tenants/:tenantId/vpp/sync` pages through `GET /v2/assets` and
  upserts licence counts. Names/bundle ids are enriched from the tenant
  catalogue and, when an ABM credential is available, `GET /v1/apps`; otherwise
  the row falls back to `App <adamId>`.
- `POST /v1/tenants/:tenantId/vpp/assets/:adamId/install` (and the existing
  application install path for a store app) consumes one device licence with
  `POST /v2/assets/associate`, records the event id/state in
  `device_vpp_assignment`, then queues `InstallApplication` with
  `Options.PurchaseMethod = 1` (VPP). Association is asynchronous: the queued
  command and local state do not claim the app installed until the device
  reports it. `POST .../release` uses `POST /v2/assets/disassociate` for
  revocable licences and returns the local count.
- When an Apps and Books token is present, store-app installs fail closed if the
  token is inactive or no licence pool exists. They never silently fall back to
  a user-account App Store install. Without a VPP token the existing direct
  install path is unchanged.

### Security and tenant isolation

- ABM and VPP tokens are stored only as AES-256-GCM envelopes keyed from
  `AUTH_SECRET` (`apple_business_manager.encrypted_token`,
  `vpp_token.encrypted_token`). List/detail responses expose status, org,
  expiry and counts only; the sealed value and private key never leave the API.
- Every read/write resolves the tenant from the authenticated membership and
  includes `organizationId` in the query. A tenant-bound API token cannot read
  another tenant's ABM/VPP state. Deleting a tenant cascades its credential,
  device and licence rows.
- Outbound Apple calls use `@mattrax/net` `fetchWithTimeout` (15s default) and
  an injectable fetch for tests. Apple error bodies are truncated and redacted
  before being stored in `lastError`.
- The ADE profile endpoint is public only because a device cannot present a
  dashboard cookie. Its token is HMAC-signed, expires (7 days by default),
  binds tenant + serial + profile UUID, and is rejected after the device is
  unassigned/removed.

### Real-ABM validation checklist

1. Create an ABM API account with device and device-management-service
   permissions; upload the PKCS#8 key + Client ID/Key ID. Confirm the status
   becomes **active** and a bad key produces a clear 400.
2. Assign at least one Mac/iPad to the Mattrax MDM server in ABM (or use
   **Assign to Mattrax** on the device page), run **Sync devices**, and confirm
   the serial appears with the correct model/family/state.
3. Confirm a device removed from ABM becomes **removed** after sync and that a
   second tenant's inventory is untouched.
4. Generate an ADE profile URL and verify the `.mobileconfig` contains the
   tenant APNs topic, SCEP challenge and `com.apple.mdm` payload. Then confirm
   whether the device actually receives it during Setup Assistant (the known
   gap above).
5. Upload a `.vpptoken`, sync, and confirm asset totals match ABM. Install a
   purchased app on an assigned Apple device; verify the licence count drops by
   one, the assignment row records the Apple event id, and the device reports
   the app. Return the licence and verify the count recovers (revocable assets).
6. Rotate `AUTH_SECRET` only after re-uploading ABM/VPP credentials; a rotated
   secret makes existing envelopes unreadable by design.

## Windows Autopilot and federated Entra enrollment

Tenant administrators use **Settings → Management → Windows Autopilot** to
import hardware hashes, sync device identities, create deployment profiles and
assign a profile to an Entra group. The public enrollment page explains the
Autopilot/Entra flow when the tenant has a profile and Graph is configured.

### Setup

1. Register an Entra application and grant the **application** permissions
   below with admin consent. `AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` enable the
   Graph client; the same client id is the default federated token audience.
2. In the tenant, connect Entra ID under **Settings → Identity** so the tenant
   has an `azureTenantId`. Autopilot and federated discovery fail closed without
   it.
3. Set `WINDOWS_FEDERATED_AUDIENCE` only when Windows enrollment uses a
   different app registration from SSO. Without either value, discovery never
   advertises `Federated`.
4. Import the Autopilot CSV (`Device Serial Number`, `Hardware Hash`, optional
   `Group Tag`) or headerless `serial,hash` rows. Graph is called before any
   local row is written, and imports are capped at 500 rows / 1 MB per request.
5. Create a deployment profile (user-driven, self-deploying or
   pre-provisioned), then assign it to an Entra group. Autopilot assigns devices
   to profiles through groups; the API stores the assignment but does not
   enumerate group membership.

### Required Microsoft Graph permissions

| Permission                                    | Type        | Used for                                                                                     |
| --------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `DeviceManagementServiceConfig.ReadWrite.All` | Application | Import/list/delete Autopilot device identities and create/update/assign deployment profiles. |
| `DeviceManagementManagedDevices.Read.All`     | Application | Read Autopilot device state and Entra device ids during sync.                                |
| `Group.Read.All`                              | Application | Validate/read assignment targets (the API only stores the group id; Graph enforces it).      |
| `Directory.Read.All`                          | Application | Existing Entra directory sync and tenant/domain discovery.                                   |

The app must be consented in every tenant whose devices it manages. A 403 from
Graph is surfaced as `ConsentRequired` and the dashboard asks the operator to
grant admin consent.

### Security model

- Every Autopilot query is scoped by `organizationId`; Graph calls use the
  tenant's own `azureTenantId` from `sso_config`. A tenant can never import,
  list, assign or delete another tenant's devices.
- Hardware hashes are stored only as imported (they are device fingerprints,
  not secrets) and are never returned by list/detail APIs. Graph errors are
  mapped to typed API errors; a failed Graph import leaves no local rows.
- The WSTEP tenant token remains HMAC-signed with `AUTH_SECRET`. Discovery mints
  a **federated-mode** token (`mttxw2`) only when the client offered
  `Federated`, the tenant has an Entra id and an audience is configured. Policy
  and enrollment then require a JWT whose signature, issuer, `tid`, audience,
  `exp` and `nbf` all validate against the tenant's Entra JWKS.
- OnPremise enrollment is unchanged: a v1 tenant token (or the legacy pin)
  continues to use the signed WSTEP token flow. Federated tokens are never
  accepted for a different tenant, and an invalid/missing JWT fails closed with
  `UnknownDevice`.
- Deleting an Autopilot identity removes it from Graph first; a Graph failure
  keeps the local row so the operation can be retried.

### Real-Entra/device validation checklist

- [ ] Grant the permissions above and confirm `getAutopilotSettings` reports
      `configured: true` and the admin-consent URL works.
- [ ] Import a real Autopilot CSV and confirm Graph returns identities and the
      device list shows serial/model/status.
- [ ] Create each deployment mode, assign a profile to a real Entra group and
      confirm Graph shows the assignment.
- [ ] Reset a registered device and complete Autopilot OOBE with Entra join;
      confirm the device appears in Mattrax and links by serial.
- [ ] With `WINDOWS_FEDERATED_AUDIENCE` set, confirm discovery returns
      `AuthPolicy: Federated` and the Entra STS URL for the tenant.
- [ ] Confirm policy/enroll reject an expired, wrong-issuer, wrong-audience,
      wrong-tenant and tampered token, and accept a fresh device/user token.
- [ ] Confirm OnPremise enrollment still works for the same tenant after
      federated discovery is enabled.
- [ ] Verify profile status/enrollment state converges after sync and that
      deleting an imported identity removes it from Graph.

### Known gaps

- The exact federated WSTEP handshake was not exercised against Entra/Windows
  hardware. The validator and discovery/token routing are fixture-tested; the
  `AuthenticationServiceUrl` defaults to Entra's WS-Federation endpoint and can
  be overridden with `windowsFederated.authServiceUrl`.
- `enableDevicePreparation` is sent to Graph as `enableWhiteGlove`; the newer
  `windowsAutopilotDevicePreparationPolicy` resource is not modelled.
- Autopilot profile assignment is group-based only. Per-device assignment and
  group membership enumeration are not implemented.
- Hardware-hash imports are sequential (one Graph request per row) to respect
  throttling; very large imports should be split into batches of 500.

## Observability and rate limiting: exact gaps

- **The edge limiter is optional per bucket.** Cloudflare Rate Limiting
  namespaces are account resources, so the build only adds a limiter binding
  when its `MATTRAX_RATE_LIMIT_<BUCKET>_NAMESPACE` is set. Supported buckets and
  env vars are `AUTH`, `ENROLLMENT`, `MDM`, `SCIM`, `BILLING` and `SCEP`
  (`MATTRAX_RATE_LIMIT_AUTH_NAMESPACE`, `..._ENROLLMENT_NAMESPACE`,
  `..._MDM_NAMESPACE`, `..._SCIM_NAMESPACE`, `..._BILLING_NAMESPACE`,
  `..._SCEP_NAMESPACE`), producing `RATE_LIMITER_AUTH`, `..._ENROLLMENT`,
  `..._MDM`, `..._SCIM`, `..._BILLING` and `..._SCEP`. Without a namespace that
  bucket keeps its own in-memory counters: the effective limit is
  `configured limit × live isolates`, and counters reset on deploy/eviction.
- **Logs are structured JSON on stdout.** They are queryable in Workers Logs /
  Logpush. Optional Sentry-compatible tracking can be enabled with
  `SENTRY_DSN`: uncaught errors and 5xx responses send a minimal envelope with a
  redacted message, request id, path, method, status, release and deployment id.
  Bodies, cookies, query strings, emails and tokens are never sent. Events are
  sampled (`SENTRY_SAMPLE_RATE`, default 1) and capped per isolate
  (`SENTRY_MAX_EVENTS_PER_MINUTE`, default 20). Without a DSN only request logs
  are written.
- **Readiness does not cancel the underlying query.** The 2s timeout returns
  503, but the driver call may finish in the background; there is no
  request-scoped abort in the current MySQL client.

## Remaining production work

### P0 — required before selling to a real fleet

- **Apple ADE/ABM and VPP.** OAuth credential upload/validation, ABM device
  sync, MDM-service assignment, signed ADE profile URLs, Apps and Books licence
  sync/assignment/release and VPP app installs are implemented and
  fixture-tested. Remaining: real-ABM/device validation of zero-touch delivery
  (the profile is not yet returned inside the ADE `Authenticate` response; see
  the checklist above). Requires an ABM account and a supervised device.
- **Android Enterprise delivery.** Enterprise signup, the Google callback,
  Pub/Sub OIDC verification, enrollment-token/QR issuance, device creation on
  `ENROLLMENT`/`STATUS_REPORT`, erase/restart/lock commands and
  `mttx.android.policy*` compilation/push are implemented and fixture-tested.
  Delivery is mounted in the API Worker and fails closed with
  `EnterpriseNotConfigured` when `ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON` is
  absent; the dashboard keeps Android explicitly unavailable in that case.
  Service-account JSON is deployment configuration only — the database stores
  the client email and Google resource names, never the private key. Remaining
  work is real-device validation against a Google Cloud project and a managed
  Android device: confirm signup redirects, Pub/Sub OIDC delivery, default
  policy creation, enrollment-token/QR provisioning, policy convergence and
  command results on hardware. The Pub/Sub topic and push subscription are
  operator-provisioned (the API records their configured names but does not
  call the Pub/Sub Admin API). Google does not document a universal AMAPI
  deep link, so enrollment uses the token QR payload plus the `afw#setup`
  manual-token flow.
- **Federated Entra enrollment / Autopilot.** Tenant-scoped Windows enrollment
  (signed discovery token, tenant-bound WSTEP token, certificate revocation) is
  joined by Autopilot hardware-hash import, Graph device sync/profile
  assignment and typed federated WSTEP token validation. The federated path is
  fixture-tested, but the exact Entra device-token handshake and Autopilot OOBE
  still need validation against a real Entra tenant and Windows hardware; see
  the checklist below. Until then, treat Federated discovery as preview.
- **Billing plan/seat enforcement.** Stripe signature-verified webhook ingestion,
  subscription upsert, optional billing configuration and mapped Stripe errors
  are implemented. `MATTRAX_PLAN_LIMITS` now supplies the plan catalogue and the
  API enforces device limits at every enrollment entry point plus tenant
  creation. Remaining gap: Android devices reported by Google Pub/Sub after an
  enrollment token was issued are synced without a second device-cap check
  (token issuance is gated); add the same check in the Pub/Sub sync path if
  operators need a hard fleet-wide cap.

### P1 — operational and enterprise requirements

- **Generic SAML SSO and IdP group → role mapping.** Entra OIDC is supported;
  Okta/Google/OneLogin need SAML.
- **Passkey MFA.** TOTP, recovery codes, passkeys (WebAuthn) and owner/admin
  tenant enforcement are implemented, including a step-up prompt for sensitive
  actions. Remaining polish: conditional UI (passkey autofill) on the login
  field, renaming keys from the account page, and a break-glass CLI for
  operators who lose every factor.
- **Scheduled/background work for large fleets.** Bounded concurrency (12 in
  flight, chunked) and per-device outcomes are in place. Large fan-outs are still
  synchronous with the request; move them to Queues (or `waitUntil` with a job
  id) and track retries.
- **Entra directory sync real-tenant validation.** Locking, stale takeover,
  per-page transactions, incremental cursors, `lastError` and a configurable
  Off/Hourly/Daily/Weekly schedule with bounded per-tenant sweeps are in place
  and fixture-tested. The scheduled path still needs a run against a real Entra
  tenant (admin consent, delta expiry/resync and large directories).
- **Backup off-site copy and drills.** Scheduled per-tenant JSON backups, status
  tracking, authenticated restore downloads and age-based retention are in
  place. Remaining: mirror MySQL dumps and R2 objects to an off-site account,
  keep `AUTH_SECRET` separate from dumps, configure an R2 lifecycle rule as a
  backstop, and rehearse a full restore (including SCEP/APNs) quarterly. Per-tenant
  JSON bundles cannot restore members, devices, audit history or SCEP
  certificates; only a database dump can.
- **Observability and abuse protection.** Structured request logs, request ids,
  readiness checks, all-bucket rate limiting and optional Sentry-compatible
  error tracking are in place. Remaining: supply the optional shared edge
  limiter namespaces for every bucket in production, alert on Sentry/5xx rates,
  and add a circuit breaker for deployments without Cloudflare Rate Limiting
  namespaces.
- **Outbound idempotency.** APNs, Graph, Stripe and relay calls have deadlines
  and bounded retries; webhook deliveries are signed and retried. Command/policy
  delivery still needs an end-to-end idempotency key so a retried request cannot
  double-apply a mutation.
- **Real-device validation.** Apple `SecurityInfo`/FileVault escrow and
  `InstalledApplicationList` software inventory are fixture-tested; they still
  need a real supervised Mac. Windows tenant-scoped WSTEP and Apple per-device
  SCEP binding also need real-device validation.

### P2 — product polish

- Android Enterprise real-device validation (signup, Pub/Sub, QR/token
  enrollment and policy/command convergence). AMAPI has no documented universal
  deep link; the UI offers the QR payload and `afw#setup` manual token.
- Split or serve the large Windows policy catalogue without shipping 17 MB.
- Surface push/bulk job summaries to clients through a job id/Queue response.
- Move health/push/software inventory aggregation from application-side scans to
  indexed/materialised SQL at very large fleet sizes.
