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
  Cloudflare's Rate Limiting binding is used for auth and enrollment when the
  deployment supplies a namespace; otherwise a per-isolate fallback applies.
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
  and leaves the previous cursor usable.
- Tenant owners can export a versioned JSON bundle
  (`GET /v1/tenants/:tenantId/export`) and import it as a new tenant
  (`POST /v1/tenants/import`). The bundle carries profile/branding, groups,
  policies/configuration, application metadata, enrollment settings and
  pre-registrations; it excludes credentials, token hashes, private keys and R2
  bytes. Import re-maps ids, derives a free slug and runs in one transaction;
  members, devices, audit history and SCEP certificates are not imported.
  [Self-hosting](./self-hosting#backups) now documents the MySQL/R2/secrets
  backup and restore order, key-rotation caveats and bundle limits.

- Stripe billing is wired: `POST /api/v1/billing/webhook` verifies signatures,
  syncs subscription created/updated/deleted and invoice events, maps Stripe
  failures to `EnterpriseStripeError`, and returns a clear unconfigured state
  instead of a 500. Plan/seat enforcement still needs a pricing catalogue.
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

## Observability and rate limiting: exact gaps

- **The edge limiter is optional.** Cloudflare Rate Limiting namespaces are
  account resources, so the build only adds `RATE_LIMITER_AUTH` /
  `RATE_LIMITER_ENROLLMENT` when `MATTRAX_RATE_LIMIT_AUTH_NAMESPACE` and
  `MATTRAX_RATE_LIMIT_ENROLLMENT_NAMESPACE` are set. Without them every isolate
  keeps its own in-memory counters: the effective limit is
  `configured limit × live isolates`, and counters reset on deploy/eviction.
  MDM/SCIM/billing/SCEP buckets always use that fallback today.
- **Logs are structured JSON on stdout.** They are queryable in Workers Logs /
  Logpush, but there is no cross-request error tracker (Sentry-style grouping,
  alerting or release correlation) yet.
- **Readiness does not cancel the underlying query.** The 2s timeout returns
  503, but the driver call may finish in the background; there is no
  request-scoped abort in the current MySQL client.

## Remaining production work

### P0 — required before selling to a real fleet

- **Apple ADE/ABM and VPP.** Zero-touch enrollment and Apps & Books licences are
  not implemented. Requires an ABM account and a supervised device to validate.
- **Android Enterprise delivery.** The AMAPI client exists, but enterprise
  signup, Pub/Sub handling and policy push are not mounted. Requires a Google
  Cloud project and a managed Android device. Until then Android must stay
  explicitly unavailable.
- **Federated Entra enrollment / Autopilot.** Tenant-scoped Windows enrollment is
  done (signed discovery token, tenant-bound WSTEP token, certificate
  revocation). Remaining gap: device-token-based Autopilot/federated Entra
  enrollment, and end-to-end validation on a real Windows device.
- **Billing plan/seat enforcement.** Stripe signature-verified webhook ingestion,
  subscription upsert, optional billing configuration and mapped Stripe errors
  are implemented. There is still no plan/seat limit catalogue or enforcement
  against device/tenant counts — that requires a product pricing decision.

### P1 — operational and enterprise requirements

- **Generic SAML SSO and IdP group → role mapping.** Entra OIDC is supported;
  Okta/Google/OneLogin need SAML.
- **MFA for administrators.** TOTP/passkey support is not wired into the auth
  layer. `@yielded/auth` ships the primitives, but tenant/member enforcement and
  recovery-code persistence still need implementation.
- **Scheduled/background work for large fleets.** Bounded concurrency (12 in
  flight, chunked) and per-device outcomes are in place. Large fan-outs are still
  synchronous with the request; move them to Queues (or `waitUntil` with a job
  id) and track retries.
- **Entra directory sync background scheduling.** Locking, stale takeover,
  per-page transactions, incremental cursors and `lastError` are in place.
  Running the sync as a scheduled background job remains.
- **Scheduled backup automation.** MySQL + R2 backup/restore, `AUTH_SECRET`,
  APNs and SCEP CA handling, restore order and tenant export/import limits are
  documented in [self-hosting](./self-hosting#backups), and owners can download
  or import a tenant bundle. Remaining: scheduled dumps/object mirroring,
  retention/encryption policy, restore drills and backup-failure alerting.
- **Observability and abuse protection.** Structured request logs, request ids,
  readiness checks and multi-bucket rate limiting are in place. Remaining:
  configure the optional shared edge limiters for every bucket, add an error
  tracker/alerting, and cover auth/enrollment with a distributed limiter even on
  deployments without Cloudflare Rate Limiting namespaces.
- **Outbound idempotency.** APNs, Graph, Stripe and relay calls have deadlines
  and bounded retries; webhook deliveries are signed and retried. Command/policy
  delivery still needs an end-to-end idempotency key so a retried request cannot
  double-apply a mutation.
- **Real-device validation.** Apple `SecurityInfo`/FileVault escrow and
  `InstalledApplicationList` software inventory are fixture-tested; they still
  need a real supervised Mac. Windows tenant-scoped WSTEP and Apple per-device
  SCEP binding also need real-device validation.

### P2 — product polish

- Android QR/deep-link enrollment once AMAPI delivery lands.
- Split or serve the large Windows policy catalogue without shipping 17 MB.
- Surface push/bulk job summaries to clients through a job id/Queue response.
- Move health/push/software inventory aggregation from application-side scans to
  indexed/materialised SQL at very large fleet sizes.
