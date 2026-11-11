# Monitoring

Mattrax exposes liveness, readiness, structured logs and tenant-level health signals. There
is no Prometheus metrics endpoint; use logs, Sentry and the health APIs.

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

## Error tracking

Set `SENTRY_DSN` to send uncaught errors and 5xx responses. Sampling and a per-isolate cap
prevent storms. The payload excludes request bodies, cookies, query strings, emails and
tokens.

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

## Log retention

Cloudflare Workers logs and Sentry retention are configured in those products. The
application does not store request logs. Audit retention is controlled by
`MAINTENANCE_AUDIT_RETENTION_DAYS`.

## Next

- [Troubleshooting](/operations/troubleshooting)
- [Audit, webhooks and billing](/admin/operations)
