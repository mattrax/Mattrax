# Monitoring

Mattrax exposes liveness, readiness, structured request logs with W3C trace context, an
opt-in Prometheus metrics endpoint and tenant-level health signals.

## Health endpoints

| Endpoint           | Purpose                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `GET /api/health`  | Dependency-free liveness; returns `ok`                                   |
| `GET /api/ready`   | Runs `select 1` with a two-second timeout; 200/503 plus version          |
| `GET /api/version` | Package version                                                          |
| `GET /api/metrics` | Prometheus text format; disabled unless `MATTRAX_METRICS` says otherwise |

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
  "method": "PUT",
  "path": "/mdm/apple/mdm",
  "status": 200,
  "outcome": "ok",
  "durationMs": 84,
  "tenantId": "…",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "spans": [
    { "name": "mdm.apple.backend.checkin", "durationMs": 71.2, "status": "ok" },
    { "name": "mysql", "durationMs": 12.4, "status": "ok" }
  ],
  "spanCount": 7
}
```

Bodies, query strings, cookies, tokens and email addresses are never logged. Every response
carries `x-request-id`; a valid caller-supplied id is propagated.

`traceId` and `spanId` are present whenever telemetry is on (the default). `spans` holds
the **slowest** child spans of the request, at most 16 of them, and `spanCount` is how many
were recorded in total. Query text is never included.

Successful health, readiness and metric-scrape requests are not logged.

## Tracing

Every request is a trace. The web handler parses the W3C `traceparent` header when a
caller sends one and continues that trace; an absent or invalid header starts a new one.
The root span is named `http.request`, and its id is the `spanId` on the request log line,
so one line locates the whole request.

Spans recorded today:

| Span                          | Source                                               |
| ----------------------------- | ---------------------------------------------------- |
| `http.request`                | The API Worker's fetch handler (root, kind `server`) |
| `mdm.apple.backend.checkin`   | Apple check-in, around the management backend call   |
| `mdm.apple.backend.enroll`    | Apple `Authenticate` (first enrollment transaction)  |
| `mdm.windows.backend.checkin` | Windows management check-in                          |
| `mysql`                       | Every SQL statement, emitted by `@effect/sql`        |
| Any `Effect.withSpan("…")`    | Service code that opts in                            |

To diagnose a slow check-in, take the `traceId` from the log line and search for it. The
`spans` array already splits the request into protocol, management-backend and SQL time,
so manual correlation is usually unnecessary.

Limitations to keep in mind:

- Spans are recorded in-process and summarised into the request log and the metrics. There
  is no OTLP exporter and no long-term span store.
- Outbound vendor calls (APNs relay, Microsoft Graph, Stripe, PostHog) are not instrumented.
- `tracestate` is not interpreted, and `traceparent` is not added to outbound requests.
- A trace id is inherited from `traceparent`, so two concurrent requests that send the same
  header share a trace id; their child-span breakdown may interleave.

Set `MATTRAX_TELEMETRY=off` to install Effect's no-op tracer: no spans are recorded, the
handler does no per-request telemetry work, and `/api/metrics` returns 404.

## Metrics

`GET /api/metrics` serves the Prometheus text format. It is **off by default**: set
`MATTRAX_METRICS=public` to serve it, or `MATTRAX_METRICS=token` plus
`MATTRAX_METRICS_TOKEN` to require `Authorization: Bearer <token>`. `token` without a
token fails closed (404). The payload is aggregate only.

```sh
curl -fsS -H "Authorization: Bearer $MATTRAX_METRICS_TOKEN" \
  https://mdm.example.com/api/metrics
```

| Metric                                   | Type      | Labels                            | Meaning                                |
| ---------------------------------------- | --------- | --------------------------------- | -------------------------------------- |
| `mattrax_http_requests_total`            | counter   | `route`, `method`, `status_class` | Requests handled, by route class       |
| `mattrax_http_request_duration_seconds`  | histogram | `route`, `method`, `status_class` | End-to-end request time                |
| `mattrax_mdm_checkin_total`              | counter   | `platform`, `outcome`             | MDM check-in outcomes                  |
| `mattrax_mdm_enrollment_total`           | counter   | `platform`, `outcome`             | MDM enrollment outcomes                |
| `mattrax_spans_total`                    | counter   | `operation`, `kind`, `status`     | Spans recorded                         |
| `mattrax_span_duration_seconds`          | histogram | `operation`, `kind`, `status`     | Span duration                          |
| `mattrax_db_queries_total`               | counter   | `operation`, `status`             | SQL statements executed                |
| `mattrax_db_query_duration_seconds`      | histogram | `operation`, `status`             | SQL statement duration                 |
| `mattrax_telemetry_series_dropped_total` | counter   | `metric`                          | Observations dropped at the series cap |

`route` is one of `health`, `ready`, `metrics`, `api`, `webhook`, `mdm`,
`mdm.apple`, `mdm.apple.checkin`, `mdm.apple.enrollment`, `mdm.windows`,
`mdm.windows.checkin`, `mdm.windows.enrollment`, `scep`, `scim` or `other`.
`status_class` is `1xx`–`5xx`. An MDM `outcome` is `ok`, `redirect`, `rejected`,
`unauthorized`, `not_found`, `unenrolled` (Apple's 410), `rate_limited` or `error`.

**No tenant, device, user, email or raw URL ever appears in a label.** Label values are
truncated to 64 characters, dynamic span names are sanitised, and each metric caps its
series count (200 by default); overflow is counted in
`mattrax_telemetry_series_dropped_total` rather than published.

The registry lives in the isolate. A Cloudflare Worker runs many isolates, so a scrape sees
one isolate's counters and histograms: treat the numbers as a sample, and use Cloudflare's
own Workers metrics for deployment-wide request totals. A self-hosted Node deployment runs
one process and reports complete figures. Counters reset when the isolate is recycled.

Useful queries:

```text
# p95 request latency over 5 minutes
histogram_quantile(0.95, sum by (le, route) (rate(mattrax_http_request_duration_seconds_bucket[5m])))

# check-in failure ratio
sum(rate(mattrax_mdm_checkin_total{outcome!="ok"}[5m]))
  / sum(rate(mattrax_mdm_checkin_total[5m]))
```

## Product analytics

The dashboard loads PostHog web analytics when `POSTHOG_KEY` is configured. It captures
pageviews, autocaptured interactions and client exceptions, then identifies the user with
their dashboard account id, name, email and verification state. It also describes the
active tenant as a `tenant` PostHog group (with the tenant name) so pageviews can be
filtered by workspace. Every browser event carries `environment` (`production`, `preview`
or `development`), `release` and `deployment_id` super properties, matching the API's
filtering. Query strings, fragments and autocaptured element text are sanitised before
an event leaves the browser, so device names, serials, emails and tokens are not sent by
autocapture.

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
all captured events, so a session cannot spoof attribution. The server emits `$identify`
only when it has to merge an anonymous browser id into the account; the browser SDK is the
identity authority after that, which avoids one identify event per API call. Calls without
a browser SDK (API tokens, scripts, OAuth) get their person fields on their first event
instead. Tenant routes also set the `tenant` PostHog group for browser pageviews and
interactions.

Confirm browser analytics is configured without reading a secret:

```sh
curl -s https://e.mattrax.app/ | grep -o 'name="mattrax-analytics" content="[^"]*"'
```

`content="enabled"` means the dashboard Worker has a non-empty `POSTHOG_KEY`. When it is
disabled, an isolate logs one warning naming the missing binding; fix it with
`cf workers secrets put POSTHOG_KEY --worker mattrax` (and the same command for
`mattrax-api`). The project key is public, but it is stored as a Worker secret on both
Workers so browser analytics and server events use the same PostHog project.

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
- p95 `mattrax_http_request_duration_seconds` above baseline for 10 minutes.
- `mattrax_mdm_checkin_total{outcome="error"}` or `{outcome="rejected"}` rising.
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
