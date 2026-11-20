# Audit, webhooks and billing

This page covers the tenant-level operational features that sit beside device management.

## Audit log

Every meaningful mutation writes an audit event with actor, action, target and metadata.
The same stream also carries device (MDM) activity, so an operator can explain a device's
behaviour without reading a second log. Rows are append-only except the current check-in
bucket, whose count and last-seen fields are updated in place; everything else is written
once and never changed.

### Who acted

`actorType` says what produced the event:

| Actor type | Meaning                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `account`  | A signed-in administrator. `actorAccountId`/`actorEmail` identify them.          |
| `api-token`| An API token or MCP connection, resolved to its owning account.                  |
| `system`   | The deployment acting on a device or in the background. `actorAccountId` is null.|

`category` splits the stream: `account` (someone changed something), `mdm` (device
protocol traffic and enrollment answers) and `system` (Android tenant connection events,
script results, maintenance, scheduled rotation, delivery failures). MDM events always have
the system actor: a device check-in can never impersonate an account. The classification
rule is shared by new writes and the migration backfill (`defaultAuditCategory`).

### What MDM records

| Action                  | When it is written                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `mdm.checkin`           | A device checked in (Apple device or user channel, Windows discovery/management, Android notification). Repeated check-ins fold into one row per device, fixed time bucket, user principal and presenting identity; `metadata.checkIns` and `metadata.firstSeenAt` describe the fold. |
| `mdm.policy_delivered`  | Declarations, legacy profiles, Windows policy changes or an Android policy actually reached the device. |
| `mdm.status_report`     | A status/inventory report changed at least one stored value or the health level. Timestamps (`lastSeenAt`, `inventoryUpdatedAt`) are excluded from the diff, so identical Apple/Windows reports stay invisible. Android notifications fold per bucket and mean “a report arrived” (there is no payload diff to compare). |
| `mdm.command_result`    | A command reached a successful terminal state. Failures keep `device.command_failed`, deferrals `device.command_not_now`. |
| `mdm.failure`           | A check-in failed: an unparseable payload, an invalid identity, a SOAP/SyncML fault, a rejected policy or a failed Android policy sync. `metadata.code` is stable; `metadata.reason` is bounded and redacted; `metadata.attribution` says whether the device was resolved from a bound certificate (`bound`) or from an asserted UDID/DeviceID (`asserted`). |

Enrollment, checkout, unenrollment, compliance and declaration failures keep their
`device.*` actions. Each state change is appended once per occurrence and is never folded
into a check-in row.

`mdm.checkin` is coalesced because a fleet of devices polls continuously. The window is
`MDM_AUDIT_CHECKIN_COALESCE_SECONDS` (default 15 minutes, `0` records every request) and
the bucket is **fixed**, not sliding: `createdAt` is the bucket start, so a device that
keeps polling produces one row per window instead of one row forever. The fold key is the
organisation, action, device, bucket, user principal and presenting identity (certificate
fingerprint, serial and address). Two tenants, two devices, two users on one device, a
rotated certificate and a changed address therefore never share a row. The row carries the
bucket's first and latest event times, its check-in count and the latest identity.
Certificate PEMs, tokens and payload bodies are never stored.

During a rolling deploy, an older worker that still writes audit rows without the new
columns uses the database default (`actor_type = account`, `category = account`). Those
rows remain identifiable by a null system actor and can be corrected with the same
classifier after the deploy; new workers always set both columns explicitly.

### Search

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/audit/search?action=device.enrolled&limit=50" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Filters: `action`, `actor`, `actorType`, `category`, `protocol`, `deviceId`, `targetType`,
`targetId`, `q` (free text over action, actor, target, device, IP, certificate serial and
fingerprint), `from`, `to`, `limit`, `cursor`, `offset`.

The dashboard's **Settings → Audit log** exposes the same filters and shows the system
actor, the device, the protocol, the principal, the verified IP and the identity
certificate fields. The device page's activity feed matches both the device target and the
`deviceId` column, so command results and newer MDM rows appear there too, with channel,
phase, check-in count and certificate details in the event line.

### Export

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/audit/export?format=csv" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -o audit.csv
```

`format` is `csv` or `json`. Export is capped at 10,000 rows and sets
`X-Export-Truncated` when clipped.

### Account activity

Account-scoped events live in their own stream because they happen before a tenant is
chosen: sign-in, credential lifecycle, email changes, API tokens, session revocation,
account deletion and break-glass recovery.

```bash
# Your own account, newest first, keyset paginated.
curl "$MATTRAX_URL/api/v1/account/audit/search?limit=25" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"

curl "$MATTRAX_URL/api/v1/account/audit/export?format=json" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -o account-activity.json
```

The same `action`, `targetType`, `targetId`, `from`, `to`, `limit`, `cursor` and `offset`
filters apply, and the export is capped at 10,000 rows with `X-Export-Truncated`. A
tenant owner cannot read another person's account stream: it is keyed by the subject
account and always filtered by the authenticated account.

### Retention

Daily maintenance applies `MAINTENANCE_AUDIT_RETENTION_DAYS` (default 365) to **both**
audit streams. Set it to `0` to keep audit entries indefinitely.

Account deletion keeps a tombstone: `account_audit_log.subject_account_id` is nulled by the
foreign key and the email snapshot stays until retention prunes the row.

### Data retention

| Data                   | Where                     | Lifetime                                                                |
| ---------------------- | ------------------------- | ----------------------------------------------------------------------- |
| Audit entries (tenant) | `audit_log`               | `MAINTENANCE_AUDIT_RETENTION_DAYS`                                      |
| Account activity       | `account_audit_log`       | Same setting                                                            |
| Login attempts         | `login_attempt`           | Same setting                                                            |
| Session descriptor     | `account_session_context` | Deleted with its session (revocation) or when the session expires       |
| Email-change tokens    | `account_email_change`    | One hour; rows stay for reference until the account is deleted          |
| Recovery ceremony      | `account_recovery`        | 30 minutes to prove, 15 minutes to complete; rows stay with the account |
| Device commands        | `device_command`          | Terminal history after 90 days; Windows state rows after 30 days        |

Session descriptors never contain a raw client address. The address is hashed with
`AUTH_SECRET` (`SHA-256("<secret>:ip:<address>")`, first 128 bits) and only the
browser/platform family is taken from the `User-Agent` — no version, locale or full
header. The descriptor is captured on the session's first authenticated request, because
the auth library owns session creation and its row has no request context. A deployment
without `AUTH_SECRET` stores no address-derived value at all.

The login log keeps a still-broader view: it stores the approximate client network
(IPv4 `/24` or IPv6 `/64`) and the bounded `User-Agent`, never a host address, and only
shows the bounded row to the account that owns it. A rejection is written only when the
auth boundary can attribute it: a completed session, a pending-MFA failure resolved
through the pending credential, or an SSO callback that already resolved the account.
Unattributable failures are not stored, so no row is invisible to every reader.

Session descriptors and the login log never contain a raw client address, and webhook
payloads never do either. The organisation event log is the deliberate exception: a
security investigation needs the exact address that performed an account action or
presented a device identity certificate. `audit_log.ip` is therefore the verified address,
taken from Cloudflare's edge header or the last hop of a trusted proxy
(`TRUST_PROXY_HEADERS=1`); a deployment that cannot prove an address stores null rather
than a caller-supplied value. Exports include it, so treat an audit export as sensitive.

### Credential issuance

Daily maintenance also detects credentials that have no certificate and repairs what it
can. A tenant with active devices but no SCEP CA gets one generated (sealed with
`AUTH_SECRET`) only when it has no SCEP history. If issued certificates, retired CA
anchors or untrusted identities remain, minting a new CA would fork the trust root and
strand those identities; the run logs an audit event telling the operator to restore or
import the original CA instead. Successful generation is audited as
`scep_ca.auto_issued`, and a refused or failed attempt as `scep_ca.issuance_failed` once
per tenant per day.

A missing APNs certificate starts the manual issuance flow by generating and sealing the
pending CSR key, so the administrator can download the request from
**Settings → Management → Apple push** and have Apple sign it; the certificate itself
still requires the account owner.

The deployment origin is the only domain with a certificate in the schema. When the TLS
probe completes but returns no leaf certificate, the host's `requestDomainCertificate`
hook is called so a Cloudflare/ACME integration can issue one. A probe outage is counted
separately and never treated as a missing certificate. Custom tenant hostnames are not
modelled yet.

## Operator account recovery

Use this only when the account cannot complete the self-service ceremony, for example a
self-hosted deployment without a mailer. It is the same ceremony with the operator
delivering the link.

1. Confirm the requester's identity out of band (video call, employee record, ticket
   history). Record what you checked.
2. Mint a completion token. Run this **in a transaction** on the deployment database:

   ```sql
   -- 1. Cancel any live ceremony and open a completed-by-operator one.
   UPDATE account_recovery
      SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
    WHERE user_id = '<user id>'
      AND status IN ('pending_proof', 'pending_approval', 'ready');

   INSERT INTO account_recovery
     (id, user_id, email, status, approval_required, proof_token_hash,
      approval_token_hash, completion_token_hash, approved_by_user_id, approved_at,
      completed_at, cancelled_at, approval_organization_id, expires_at, created_at, updated_at)
   SELECT '<24 char id>', u.id, u.email, 'ready', 0,
          SHA2('<proof token>', 256), NULL, SHA2('<completion token>', 256),
          NULL, NULL, NULL, NULL, NULL,
          DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
     FROM user u
    WHERE u.id = '<user id>' AND u.email_verified = 1 AND u.disabled = 0;
   ```

   The hashes are plain SHA-256 hex of the raw tokens, matching `recovery.ts`.

3. Send the account owner `https://<ORIGIN>/recover/complete?token=<completion token>`
   over a channel you trust. The link works once and expires in 15 minutes.
4. The ceremony bumps the account's security revision, so every existing session is
   invalidated, and writes `account.recovery_completed` to the account audit stream. Have
   the user enrol a new passkey immediately.
5. Record the incident: who verified the requester, when, and which token was minted.
   Never write a token into a ticket.

Do not delete passkeys, TOTP factors or sessions by hand: the completion link already
revokes sessions, and removing credentials would break the "last passkey cannot be
removed" invariant that protects every other account.

## Outbound webhooks

Webhooks stream selected events to your HTTPS endpoint.

### Events

| Event                        | Fires when                                              |
| ---------------------------- | ------------------------------------------------------- |
| `device.enrolled`            | Apple device completes its first authenticated check-in |
| `device.unenrolled`          | Check-out, admin deletion or stale unenrollment         |
| `device.command_failed`      | A command first moves to failed                         |
| `device.declaration_invalid` | A declaration first reports invalid                     |
| `device.push_invalid_token`  | APNs rejects a token for the first time since success   |
| `device.compliance_changed`  | Derived health level changes                            |
| `policy.deployment_failed`   | A policy applied but at least one APNs wake-up failed   |
| `enrollment.attempt_failed`  | A public enrollment attempt failed                      |
| `webhook.test`               | Sent by the test button                                 |

An empty event filter subscribes to all events, including future ones.

### Create an endpoint

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/webhooks" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://hooks.example.com/mattrax",
    "description": "SIEM",
    "events": ["device.enrolled", "device.compliance_changed"]
  }'
```

The signing secret is returned once. Store it securely; only a suffix is shown later.

### Headers and signature

```http
X-Mattrax-Event: device.enrolled
X-Mattrax-Delivery: evt_...
X-Mattrax-Timestamp: 1760000000
X-Mattrax-Signature: t=1760000000,v1=<hex hmac>
Content-Type: application/json
User-Agent: Mattrax-Webhooks/1
```

Signature:

```text
v1 = hex(HMAC-SHA256(secret, "<timestamp>.<raw body>"))
```

Verify with a constant-time compare and a 300-second tolerance. The delivery id is stable
across retries.

### Payload

```json
{
  "id": "evt_...",
  "type": "device.enrolled",
  "occurredAt": "2026-11-11T10:00:00.000Z",
  "organizationId": "org_...",
  "data": {}
}
```

Payloads never contain keys, tokens, passwords or raw IPs.

### Delivery and retries

- One inline attempt per event per endpoint, 5-second timeout, concurrency 4.
- 2xx is success; anything else is a failure.
- Redirects are rejected.
- Failures are retried by daily maintenance: up to 3 recorded attempts, rows younger than
  24 hours, 100 rows per pass.
- Delivery history is pruned after 30 days.
- URLs must be HTTPS, without credentials, and must not resolve to localhost or private
  address space. The check runs at creation and at delivery.

### Operations

```text
GET    /api/v1/tenants/:tenantId/webhooks
POST   /api/v1/tenants/:tenantId/webhooks
PATCH  /api/v1/tenants/:tenantId/webhooks/:webhookId
DELETE /api/v1/tenants/:tenantId/webhooks/:webhookId
POST   /api/v1/tenants/:tenantId/webhooks/:webhookId/rotate-secret
POST   /api/v1/tenants/:tenantId/webhooks/:webhookId/test
```

### Delivery history

Every attempt is stored for 30 days and is readable from the dashboard's
Settings → Integrations → Deliveries tab or the API:

```text
GET  /api/v1/tenants/:tenantId/webhooks/:webhookId/deliveries
GET  /api/v1/tenants/:tenantId/webhooks/:webhookId/deliveries/:deliveryId
POST /api/v1/tenants/:tenantId/webhooks/:webhookId/deliveries/:deliveryId/replay
```

- The list is newest first and keyset paginated with `cursor`; `limit` defaults
  to 25 and is capped at 100.
- `event` filters to one event name (`device.enrolled`, `webhook.test`, …) and
  `status` to `succeeded` or `failed`.
- The window is the retention window: rows older than 30 days are gone, so a
  cursor can never page past it.
- The single-delivery read returns the exact JSON payload that was signed,
  alongside the recorded status, attempt, response code and truncated error.
- Replay re-sends the stored payload with the same `X-Mattrax-Delivery` header
  (the payload's `id`), re-signed with the endpoint's current secret, and
  records a new attempt row. Receivers can therefore dedupe a replay exactly
  like an automatic retry. The original row is never modified.

Reads need `webhooks.read`; replay needs `webhooks.write`. Both are owner/admin
permissions in the built-in roles.

## Billing

Billing is optional. Without Stripe secrets the API reports `configured: false` instead of
failing.

### Configure Stripe

Set on the API Worker:

```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_DEVICE_MONTHLY_PRICE_ID=price_...
```

Point Stripe at `POST /api/v1/billing/webhook`. Mattrax handles subscription created,
updated and deleted, invoice paid/succeeded/failed and
`checkout.session.completed` (which links the customer and records the plan; the
subscription event then fills in the period). Tenants are resolved by
`metadata.organizationId` or the stored Stripe customer id, and a redelivered
event is skipped by the transactional event-id ledger.

### Deployment licences

A self-hosted operator pays for the whole deployment rather than each tenant.
Set `STRIPE_LICENSE_PRICE_ID` on the cloud API Worker (a per-device recurring
price), then issue a licence:

```bash
DATABASE_URL=mysql://... pnpm license:issue --name "Acme" --email ops@acme.test
```

The command prints the only copy of the key and stores a SHA-256 hash in
`deployment_license`. Give the operator:

```bash
MATTRAX_BILLING_URL=https://e.mattrax.app
MATTRAX_LICENSE_KEY=mtx_lic_...
```

The deployment calls `POST /api/platform/billing/{summary,portal,checkout,invoices,usage}`
with that key. The first authenticated call binds the licence to the
deployment's public origin; later calls from another origin are rejected. The
daily maintenance job reports enrolled-device and tenant counts, and the cloud
keeps the Stripe subscription quantity in step. The self-hosted install never
stores Stripe credentials; the existing tenant billing page renders the
deployment licence for the operator.

### Portal and summary

```text
GET  /api/v1/tenants/:tenantId/billing
POST /api/v1/tenants/:tenantId/billing/portal
POST /api/v1/tenants/:tenantId/billing/checkout
GET  /api/v1/tenants/:tenantId/billing/invoices
```

The portal and checkout both require owner/admin (`billing.write`) and step-up.
The summary includes plan, status, `billableDevices`, device and tenant limits,
usage and over-limit flags.

### Checkout

`POST …/billing/checkout` creates a Stripe Checkout Session for
`STRIPE_DEVICE_MONTHLY_PRICE_ID` and returns `{ url }` for the browser to
follow. The body accepts an optional `trialDays` (1–730).

- `metadata.organizationId` and `client_reference_id` carry the tenant, and the
  same metadata is copied onto the subscription, so
  `checkout.session.completed` and every later subscription/invoice event
  resolve to the same tenant.
- The success and cancel URLs are built from the deployment `ORIGIN`
  (`/t/<tenantId>/settings/billing`), never from the request body. A portal
  `returnUrl` outside `ORIGIN` is replaced by that page, and a Stripe response
  that is not an absolute HTTPS URL is rejected as an upstream failure.
- The first line item quantity is the number of enrolled devices (minimum 1).
  Seat changes thereafter are handled by reconciliation, not by a second
  Checkout Session.
- A deployment without a Stripe key or price id returns
  `EnterpriseStripeError` ("Billing is not configured for this deployment"),
  rendered as a configuration notice instead of a 500.

### Seats

One seat is one device in the `enrolled` state — the same number the dashboard
shows as `billableDevices`. Reconciling sets the subscription item quantity to
that count (never above the plan's device limit when `MATTRAX_PLAN_LIMITS` caps
it) with `proration_behavior: none`, so month-to-month churn settles on the next
renewal instead of emitting credit notes.

- Unenrolling or deleting devices reconciles immediately.
- A device enrols through the protocol layer, which has no Stripe client, so the
  nightly maintenance sweep brings the quantity in line within 24 hours.
- The same sweep retries a Stripe customer rename that failed inline when a
  tenant was renamed, and repairs any drift introduced in the Stripe dashboard.

### Invoices

`GET …/billing/invoices` lists up to 24 invoices for the tenant's Stripe
customer, newest first: number, status, total/amount due/paid, dates and the
hosted/PDF links. Without a Stripe customer the list is empty without calling
Stripe.

### Plan limits

`MATTRAX_PLAN_LIMITS` is a JSON map:

```json
{
  "defaultPlan": "free",
  "plans": {
    "free": { "devices": 50, "tenants": 1 },
    "device": { "devices": null, "tenants": null }
  }
}
```

- `null` or missing means unlimited; `0` means none.
- Missing, canceled, incomplete-expired or unpaid subscriptions use `defaultPlan`.
- Unknown plans are unlimited.
- Malformed JSON fails safe to unlimited with a startup warning.

Limits are enforced at enrollment readiness, Apple `Authenticate`, Windows enrollment,
Android token issuance, pre-registration import and tenant creation. Existing devices are
never deleted. See [Configuration](/operations/configuration).

## Open-source licences

Settings → Legal lists every third-party package in the production dependency graph, its
declared SPDX licence, and the licence text the package ships. The inventory is generated
on every web build by `apps/web/scripts/generate-licences.ts` from `pnpm-lock.yaml` and the
installed packages, so it cannot go stale when a dependency changes. It is served as
`/licenses.json` and the page reads that asset on demand instead of bundling the notices
into the Worker. Run `pnpm license:inventory` to regenerate it without building.

## Backups

### Scheduled tenant backups

Daily maintenance writes a per-tenant JSON bundle to R2 and records a `backup_run`.
Retention is `MAINTENANCE_BACKUP_RETENTION_DAYS` (default 30). `pinned` runs are kept
until an owner unpins them.

```text
POST   /api/v1/tenants/:tenantId/backups
GET    /api/v1/tenants/:tenantId/backups
GET    /api/v1/tenants/:tenantId/backups/:id/download
POST   /api/v1/tenants/:tenantId/backups/:id/pin
POST   /api/v1/tenants/:tenantId/backups/:id/unpin
DELETE /api/v1/tenants/:tenantId/backups/:id
POST   /api/v1/tenants/:tenantId/backups/:id/restore
```

Manual runs, pin, unpin, delete and restore require owner. Every action is audited
(`backup.pinned`, `backup.unpinned`, `backup.deleted`, `tenant.restored`). Download, pin,
delete and restore each require a matching step-up action (`backup-download`,
`backup-pin`, `backup-delete`, `backup-restore`).

Deleting a run removes its R2 object first and then the row, so a storage failure keeps
the row (and the pointer) for a retry. Runs still in progress cannot be pinned or
deleted.

### Restoring in place

`POST /backups/:id/restore` recovers the **same** tenant rather than importing a
duplicate:

1. Takes a pinned `manual` backup first (the pre-restore snapshot).
2. Replaces the tenant's policies, groups, group/policy links, application metadata,
   direct device policy/application assignments, pre-registrations and enrollment
   settings from the bundle.
3. Keeps members, devices, SCEP certificates and audit history. Device group
   memberships and direct device assignments are re-linked by device id with a
   serial-number fallback; entries whose device no longer exists are reported as
   skipped instead of failing the restore.
4. Writes a `tenant.restored` audit entry containing the backup id and snapshot id.

The caller must send `{ "confirm": "<tenant-slug>" }`. The restore is one transaction,
so a failed write leaves the previous configuration untouched. Uploaded application
files are reused because they live under the same tenant's `a/<tenant>/` prefix. If the
wrong backup was restored, restore the pinned pre-restore snapshot; its id is in the
response and the settings table.

Limits of the bundle apply to restore too: dynamic group rules and direct device-policy
assignments are not exported, so recreated groups are manual groups and direct
assignments are dropped. Uploaded app bytes are re-linked only when the bundle carries
the tenant's R2 key; otherwise the application is listed as needing a re-upload.

Directory-linked groups restore their membership from the tenant's **live** directory:
the link is re-established only when the referenced directory group still exists in
this tenant, and a dynamic group never keeps a link. Dropped links are reported in
`skipped.directoryLinks`. Application assignments to directory user groups are re-linked
the same way (`userGroupIds`), because directory groups themselves are not part of a
bundle. Run a directory sync after a restore if the directory group or its members
changed since the backup was taken.

### Bundle contents

Included:

- Tenant profile and branding.
- Groups, policy links and device membership metadata.
- Policies and configurations, including assignments to directory users.
- Directory users referenced by those assignments (email, name, source, external id
  and disabled state). Restore recreates missing directory users; account members are
  not exported.
- Application metadata (not bytes).
- Enrollment settings and pre-registrations.
- SCEP certificate metadata.
- Optional audit (10k cap).

Excluded:

- APNs and SCEP private keys.
- Token hashes and passkey credentials.
- Sessions and auth proofs.
- R2 object bytes.
- Account members, devices and audit history in the import path.

### Export and import

`GET /v1/tenants/:tenantId/export` creates a versioned bundle. `POST /v1/tenants/import`
creates a **new** tenant; `POST /v1/tenants/:tenantId/backups/:id/restore` restores in
place (see above).

Limits: version 1, 8 MB, 10,000 rows per class, one transaction. Slugs are sanitised and
suffixed (`-2`, `-3`). Uploaded app files must be re-uploaded after an import (not after
an in-place restore).

A **new-tenant import drops** directory links on device groups and application
assignments to directory user groups. The bundle carries the source tenant's directory
group ids, but directory groups are not exported, so there is nothing in the new tenant
to link them to. Re-link groups and application assignments after the first directory
sync, or use an in-place restore when the goal is to recover the same tenant.

### Tenant deletion

`DELETE /v1/tenants/:tenantId` performs a complete, retryable teardown instead of deleting
one row. In order:

1. Sends every enrolled device its platform's unenroll signal: Apple devices are marked
   `unenrolling` and pushed through APNs (a check-in that arrives before the row is
   removed receives the protocol's unenroll response), Windows devices get a queued
   `./Vendor/MSFT/DMClient/Provider/Mattrax/Unenroll` command, and Android devices are
   deprovisioned through the Android Management API.
2. Cancels the Stripe subscription immediately and clears `organization.stripe_customer_id`
   together with the local `subscription` row.
3. Deletes every object under `p/<tenant>/`, `a/<tenant>/` and `backups/<tenant>/`.
4. Deletes the organization row (and everything that cascades from it).

Devices that cannot be reached do not block deletion, because one offline laptop must not
pin a tenant forever:

- Apple devices whose APNs push fails (offline, no token or no push certificate) keep
  their management profile and must be removed by hand.
- Windows only applies an unenroll command on a client-initiated check-in, which cannot
  happen after the tenant is removed. Windows devices are always reported as needing
  manual retirement even though the command was queued for a check-in that races the
  delete.
- Android devices that are not linked to an active enterprise, or that Google rejects,
  stay enrolled.

The response lists every device that needs manual action so the operator can remove its
management profile:

```json
{
  "status": "ok",
  "reclaimed": {
    "devices": 12,
    "unreachableDevices": [{ "id": "…", "name": "MacBook", "platform": "apple", "reason": "…" }],
    "objects": 240,
    "subscription": "cancelled"
  }
}
```

A failed reclamation step (Stripe error, R2 error, database error) returns
`EnterpriseTenantTeardownFailed` with the failing `step`, keeps the tenant intact and
leaves a `tenant_deletion` journal row. Repeating `DELETE` resumes from that journal;
already-cancelled subscriptions, already-deleted objects and already-removed devices are
idempotent. Only one attempt runs at a time: a `pending` job is leased for ten minutes
(refreshed by every journal write), and a concurrent `DELETE` returns `409` telling the
operator to retry instead of repeating unenroll, Stripe and R2 side effects. A crashed
attempt becomes claimable once its lease expires. The journal has no foreign key to
`organization`, so support can still read what was freed after the tenant row and its
audit log are gone. Only a completed teardown removes the row; a second delete after
completion returns `404 tenant not found`.

### Infrastructure backups

Tenant bundles are not a database backup. Also back up:

- MySQL with `mysqldump --single-transaction --quick --routines --triggers`.
  The nightly workflow described in [Backups](/operations/backups) does this.
- The R2 bucket.
- `AUTH_SECRET`, `CLOUD_APPLE_VENDOR_CERT`/`KEY`, Stripe secrets and Entra secrets.

Restore order: database → R2 → secrets/config → migrations → deploy → verify health and
readiness → re-enable cron.

## Dashboards and reports

A dashboard is the report definition. Widgets run live queries against the tenant; a
scheduled report takes a snapshot of the same widgets, renders it, and emails it to the
chosen recipients.

### Schedules

| Setting    | Meaning                                                                |
| ---------- | ---------------------------------------------------------------------- |
| `daily`    | Every day at the chosen UTC hour.                                       |
| `weekly`   | Every Monday at the chosen UTC hour.                                    |
| `monthly`  | The 1st of each month at the chosen UTC hour.                           |

The schedule is evaluated in UTC. The hourly cron generates any report whose latest slot
has not been queued, so changing the hour takes effect on the next tick rather than the
next day. A claim row keyed by `(report, period)` and an outbox dedupe key per recipient
make a repeated tick or a retry a no-op: the same digest can be retried after a provider
failure without sending a second copy.

### Formats

- **CSV** — one labelled section per widget (title, type, total, then a header row and
  rows). Columns use the widget's configured order, or the dataset default. Values are
  RFC 4180 escaped and formula-prefixed fields are neutralised.
- **PDF** — a dependency-free text PDF (Helvetica) with headings, totals and tables.
  Charts are represented by their underlying numbers. Core fonts are ASCII/WinAnsi, so
  non-Latin characters render as `?` rather than corrupting the text stream.
- **Email body** — a print-ready HTML summary is the message body; the CSV or PDF is the
  attachment.

### Recipients and permissions

Viewing reports and downloading the current dashboard needs `dashboards.read`; creating,
editing, deleting and sending needs `dashboards.write`. Tenant members are stored by
account id and re-checked on every send, so a removed member stops receiving mail.
External addresses are only writable by a built-in owner or admin, and at most 20
recipients are accepted per report. Disabled and unverified accounts are skipped at send
time: report mail carries tenant data and must not land in an unverified mailbox.

### What a dashboard can show

| Data from the report brief                  | Where it comes from                                |
| ------------------------------------------- | -------------------------------------------------- |
| Active devices                              | Devices dataset (status, health, check-in age)     |
| OS versions                                 | Devices dataset (group by OS version)              |
| Installed/outdated software                 | Software dataset (managed/update state, versions)  |
| Device inventory                            | Devices dataset (table with model, serial, dates)  |
| User inventory and active/inactive users    | Users dataset (name, email, status, source)        |

Two gaps are deliberate rather than accidental:

- **Patch state.** A macOS device's SOFA update status is derived on the device page and
  is not part of the dashboard query row, so a dashboard can filter and group by OS
  version but cannot ask "which Macs are behind on patches". Adding it means extending
  the shared device projection, not inventing a report-only query.
- **Spending.** Mattrax and app spending live behind the billing service and Stripe,
  which the dashboard query layer does not read. A spending widget would need a new
  dataset (and a tenant-scoped billing read) rather than a query on the device snapshot.

## Next

- [Configuration](/operations/configuration)
- [Monitoring](/operations/monitoring)
- [Troubleshooting](/operations/troubleshooting)
