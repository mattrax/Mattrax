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

### Retention

Daily maintenance applies `MAINTENANCE_AUDIT_RETENTION_DAYS` (default 365). Set it to `0`
to keep audit entries indefinitely.

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
updated and deleted plus invoice paid/succeeded/failed. Tenants are resolved by
`metadata.organizationId` or the stored Stripe customer id.

### Portal and summary

```text
GET  /api/v1/tenants/:tenantId/billing
POST /api/v1/tenants/:tenantId/billing/portal
```

The portal requires owner/admin and step-up. The summary includes plan, status,
`billableDevices`, device and tenant limits, usage and over-limit flags.

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
Retention is `MAINTENANCE_BACKUP_RETENTION_DAYS` (default 30). `retention = pinned` rows
are never pruned (SQL only; no API).

```text
POST /api/v1/tenants/:tenantId/backups
GET  /api/v1/tenants/:tenantId/backups
GET  /api/v1/tenants/:tenantId/backups/:id/download
```

Manual runs require owner. Download requires owner plus the `backup-download` step-up
action.

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
creates a **new** tenant.

Limits: version 1, 8 MB, 10,000 rows per class, one transaction. Slugs are sanitised and
suffixed (`-2`, `-3`). Uploaded app files must be re-uploaded.

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
