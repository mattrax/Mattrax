# Monitoring

Mattrax exposes liveness, readiness, structured logs and tenant-level health signals. There
is no Prometheus metrics endpoint; use logs, PostHog and the health APIs.

## Health endpoints

| Endpoint           | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `GET /api/health`  | Dependency-free liveness; returns `ok`                          |
| `GET /api/ready`   | Runs `select 1` with a two-second timeout; 200/503 plus version |
| `GET /api/version` | Package version                                                 |

The API Worker also has `/health` as an alias. Only `/api/*` is proxied by the public web
Worker, so use `/api/health` and `/api/ready` from outside.

```bash
curl -fsS https://mdm.example.com/api/ready
```

## Structured logs

One JSON line per request:

```json
{
  "event": "http.request",
  "requestId": "…",
  "method": "GET",
  "path": "/api/v1/tenants/…/devices",
  "status": 200,
  "outcome": "success",
  "durationMs": 42,
  "tenantId": "…"
}
```

Bodies, query strings, cookies, tokens and email addresses are never logged. Every response
carries `x-request-id`; a valid caller-supplied id is propagated.

Successful health and readiness probes are not logged.

## Product analytics

The dashboard loads PostHog web analytics when `POSTHOG_KEY` is configured. It captures
pageviews, autocaptured interactions and client exceptions, then identifies the user with
their dashboard account id and email.

The API captures product events server-side so usage is not lost to ad blockers or client
failures:

- `api_request` — method, path, status, duration, tenant and error tag for every
  user-facing API call.
- `auth_signed_in`, `auth_mfa_pending`, `auth_register_submitted`, `auth_signed_out`,
  `auth_email_verified`, `auth_sso_signed_in` and
  `member_invitation_accepted` conversion events. The dashboard emits
  `auth_registered` only after registration and the first sign-in both succeed.
- Named operation events such as `tenant_created`, `policy_created`,
  `application_created`, `group_created`, `dashboard_created`, `member_invited`,
  `role_created`, `device_command_sent`, `backup_started` and `billing_portal_opened`.

Browser requests carry `x-posthog-session-id` and `x-posthog-distinct-id`. Once the API
authenticates the request, the server uses the authenticated user id and tenant role for
all captured events, so a session cannot spoof attribution. Tenant routes also set the
`tenant` PostHog group for browser pageviews and interactions.

## Error tracking

Set `POSTHOG_KEY` to send uncaught errors and 5xx responses to PostHog error tracking.
Sampling and a per-isolate cap prevent storms. Payloads exclude request bodies, cookies,
query strings, emails and tokens.

## Tenant health signals

| Endpoint                                          | What it shows                             |
| ------------------------------------------------- | ----------------------------------------- |
| `GET /api/v1/tenants/:tenantId/device-health`     | Fleet health counts                       |
| `GET /api/v1/tenants/:tenantId/push-health`       | APNs delivery failures and invalid tokens |
| `GET /api/v1/tenants/:tenantId/credential-health` | APNs and SCEP CA expiry                   |
| `GET /api/v1/tenants/:tenantId/audit/search`      | Recent audit events                       |

Credential expiry alerts are written to the audit log at 30, 7 and 0 days and emailed to
enabled owners/admins once per threshold per day.

## Rate limits

A 429 response has a stable JSON body and `Retry-After`. Watch for:

- Auth 429s — credential stuffing or a broken client.
- Enrollment 429s — a shared NAT or a runaway script.
- SCEP 429s — a device retry loop.

Configure Cloudflare Rate Limiting namespaces for edge enforcement. See
[Configuration](/operations/configuration).

## Backups

Check `GET /api/v1/tenants/:tenantId/backups` and the `backup_run` table. A failed run is
recorded with an error and does not stop other tenants. Test a restore into a scratch
database at least quarterly.

## Recommended alerts

- `/api/ready` non-200 for 5 minutes.
- 5xx rate above baseline.
- APNs invalid-token count increasing.
- SCEP or APNs expiry under 30 days.
- Backup failures for two consecutive days.
- Webhook consecutive failures above 10.
- Enrollment attempts failing with `bad_code`, `no_apns` or `limit`.

## Delivery diagnostics

APNs delivery counts and recent rejected pushes live in **Tenant settings → Delivery**.
Push is a wake-up hint rather than the delivery mechanism itself, so a failed push does not
by itself mark a device unhealthy. The overview only lists devices whose derived health
(enrollment, check-in freshness, declarations, storage, encryption, battery) needs a person.

## Log retention

Cloudflare Workers logs and PostHog retention are configured in those products. The
application does not store request logs. Audit retention is controlled by
`MAINTENANCE_AUDIT_RETENTION_DAYS`.

## Next

- [Troubleshooting](/operations/troubleshooting)
- [Audit, webhooks and billing](/admin/operations)
