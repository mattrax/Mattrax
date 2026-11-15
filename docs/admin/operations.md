# Audit, webhooks and billing

This page covers the tenant-level operational features that sit beside device management.

## Audit log

Every meaningful mutation writes an audit event with actor, action, target and metadata.

### Search

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/audit/search?action=device.enrolled&limit=50" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Filters: `action`, `actor`, `targetType`, `targetId`, `from`, `to`, `limit`, `cursor`,
`offset`.

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
tenant owner cannot read another person's account stream: it is keyed by the subject user
and always filtered by the authenticated account.

### Retention

Daily maintenance applies `MAINTENANCE_AUDIT_RETENTION_DAYS` (default 365) to **both**
audit streams. Set it to `0` to keep audit entries indefinitely.

Account deletion keeps a tombstone: `account_audit_log.subject_user_id` is nulled by the
foreign key and the email snapshot stays until retention prunes the row.

### Data retention

| Data                   | Where                     | Lifetime                                                                |
| ---------------------- | ------------------------- | ----------------------------------------------------------------------- |
| Audit entries (tenant) | `audit_log`               | `MAINTENANCE_AUDIT_RETENTION_DAYS`                                      |
| Account activity       | `account_audit_log`       | Same setting                                                            |
| Session descriptor     | `account_session_context` | Deleted with its session (revocation) or when the session expires       |
| Email-change tokens    | `account_email_change`    | One hour; rows stay for reference until the account is deleted          |
| Recovery ceremony      | `account_recovery`        | 30 minutes to prove, 15 minutes to complete; rows stay with the account |

Session descriptors never contain a raw client address. The address is hashed with
`AUTH_SECRET` (`SHA-256("<secret>:ip:<address>")`, first 128 bits) and only the
browser/platform family is taken from the `User-Agent` — no version, locale or full
header. The descriptor is captured on the session's first authenticated request, because
the auth library owns session creation and its row has no request context. A deployment
without `AUTH_SECRET` stores no address-derived value at all.

Same rule as webhook and audit payloads: nothing user-facing or exported contains a raw
IP address.

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

### Bundle contents

Included:

- Tenant profile and branding.
- Groups, policy links and device membership metadata.
- Policies and configurations.
- Application metadata (not bytes).
- Enrollment settings and pre-registrations.
- SCEP certificate metadata.
- Optional audit (10k cap).

Excluded:

- APNs and SCEP private keys.
- Token hashes and passkey credentials.
- Sessions and auth proofs.
- R2 object bytes.
- Members, devices and audit history in the import path.

### Export and import

`GET /v1/tenants/:tenantId/export` creates a versioned bundle. `POST /v1/tenants/import`
creates a **new** tenant; `POST /v1/tenants/:tenantId/backups/:id/restore` restores in
place (see above).

Limits: version 1, 8 MB, 10,000 rows per class, one transaction. Slugs are sanitised and
suffixed (`-2`, `-3`). Uploaded app files must be re-uploaded after an import (not after
an in-place restore).

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
- The R2 bucket.
- `AUTH_SECRET`, `CLOUD_APPLE_VENDOR_CERT`/`KEY`, Stripe secrets and Entra secrets.

Restore order: database → R2 → secrets/config → migrations → deploy → verify health and
readiness → re-enable cron.

## Next

- [Configuration](/operations/configuration)
- [Monitoring](/operations/monitoring)
- [Troubleshooting](/operations/troubleshooting)
