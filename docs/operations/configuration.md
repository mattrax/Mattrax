# Configuration

This page lists the runtime configuration for the Cloud API Worker. Secrets are set with
`cf workers secrets update <NAME> --worker mattrax-api --type secret_text --text '...'`.

## Required

| Variable      | Purpose                                                            |
| ------------- | ------------------------------------------------------------------ |
| `ORIGIN`      | Canonical public origin and WebAuthn relying party                 |
| `AUTH_SECRET` | Signs sessions, seals APNs/SCEP/device secrets and webhook secrets |

Back up `AUTH_SECRET`. Rotating it makes existing sealed values unreadable. There is no
online re-wrap; export and re-seal with the old secret before rotating.

## Auth and origins

| Variable          | Default  | Purpose                                    |
| ----------------- | -------- | ------------------------------------------ |
| `AUTH_RESET_URL`  | `ORIGIN` | Password-reset landing page; must be HTTPS |
| `TRUSTED_ORIGINS` | —        | Comma-separated extra same-site origins    |

## Billing

| Variable                         | Purpose                           |
| -------------------------------- | --------------------------------- |
| `STRIPE_SECRET_KEY`              | Stripe API key                    |
| `STRIPE_WEBHOOK_SECRET`          | Stripe webhook signature          |
| `STRIPE_DEVICE_MONTHLY_PRICE_ID` | Price mapped to the `device` plan |
| `MATTRAX_PLAN_LIMITS`            | JSON plan/seat catalogue          |

All are optional. Without them billing reports `configured: false`.

```json
{
  "defaultPlan": "free",
  "plans": {
    "free": { "devices": 50, "tenants": 1 },
    "device": { "devices": null, "tenants": null }
  }
}
```

## Apple

| Variable                  | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `CLOUD_APPLE_VENDOR_CERT` | Vendor certificate for APNs CSR signing    |
| `CLOUD_APPLE_VENDOR_KEY`  | Vendor private key                         |
| `APNS_RELAY_URL`          | Multi-tenant APNs relay base URL           |
| `APNS_RELAY_SECRET`       | Relay HMAC secret (at least 32 characters) |

Without the vendor key, tenants upload a manually signed APNs certificate. Without the
relay, hosted multi-tenant Cloud has no push transport and devices poll.

## Windows and Entra

| Variable                     | Purpose                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `AZURE_CLIENT_ID`            | Entra app client id                                                |
| `AZURE_CLIENT_SECRET`        | Entra app secret                                                   |
| `WINDOWS_ORGANIZATION_ID`    | Legacy single-tenant fallback                                      |
| `WINDOWS_FEDERATED_AUDIENCE` | Audience for federated WSTEP tokens; defaults to `AZURE_CLIENT_ID` |

## Android

| Variable                                  | Purpose                                                     |
| ----------------------------------------- | ----------------------------------------------------------- |
| `ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON` | Full service-account JSON                                   |
| `ANDROID_MANAGEMENT_PROJECT_ID`           | Google Cloud project                                        |
| `ANDROID_MANAGEMENT_PUBSUB_TOPIC`         | `projects/{project}/topics/{topic}`                         |
| `ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION`  | Push subscription                                           |
| `ANDROID_MANAGEMENT_PUBSUB_AUDIENCE`      | OIDC audience; defaults to `<ORIGIN>/api/v1/android/pubsub` |
| `ANDROID_MANAGEMENT_PUBSUB_JWKS_URI`      | JWKS override for tests/non-Google                          |

Without the service account, Android endpoints return `EnterpriseNotConfigured`.

## Maintenance

| Variable                             | Default | Purpose                   |
| ------------------------------------ | ------- | ------------------------- |
| `MAINTENANCE_STALE_DEVICE_DAYS`      | `30`    | Mark devices stale        |
| `MAINTENANCE_AUDIT_RETENTION_DAYS`   | `365`   | `0` keeps forever         |
| `MAINTENANCE_BACKUP_RETENTION_DAYS`  | `30`    | `0` keeps forever         |
| `MAINTENANCE_BACKUP_CONCURRENCY`     | `4`     | Tenants backed up at once |
| `MAINTENANCE_ENTRA_SYNC_CONCURRENCY` | `2`     | Tenants synced at once    |

## Rate limits

Build-time namespace variables create Cloudflare Rate Limiting bindings:

| Variable                                  | Binding                   | Bucket              |
| ----------------------------------------- | ------------------------- | ------------------- |
| `MATTRAX_RATE_LIMIT_AUTH_NAMESPACE`       | `RATE_LIMITER_AUTH`       | Auth POSTs, 120/min |
| `MATTRAX_RATE_LIMIT_ENROLLMENT_NAMESPACE` | `RATE_LIMITER_ENROLLMENT` | Enrollment, 600/min |
| `MATTRAX_RATE_LIMIT_MDM_NAMESPACE`        | `RATE_LIMITER_MDM`        | `/mdm/*`, 600/min   |
| `MATTRAX_RATE_LIMIT_SCIM_NAMESPACE`       | `RATE_LIMITER_SCIM`       | SCIM, 600/min       |
| `MATTRAX_RATE_LIMIT_BILLING_NAMESPACE`    | `RATE_LIMITER_BILLING`    | Billing, 600/min    |
| `MATTRAX_RATE_LIMIT_SCEP_NAMESPACE`       | `RATE_LIMITER_SCEP`       | SCEP, 300/min       |

Without a binding, that bucket falls back to per-isolate counters.

## Error tracking

| Variable                       | Default | Purpose               |
| ------------------------------ | ------- | --------------------- |
| `SENTRY_DSN`                   | —       | Sentry-compatible DSN |
| `SENTRY_ENVIRONMENT`           | —       | Environment tag       |
| `SENTRY_SAMPLE_RATE`           | `1`     | `0`–`1`               |
| `SENTRY_MAX_EVENTS_PER_MINUTE` | `20`    | Per-isolate cap       |

Payloads contain a redacted message, request id, path, method, status, release and
deployment id. Bodies, cookies, query strings, emails and tokens are excluded.

## Development only

| Variable                   | Purpose                                |
| -------------------------- | -------------------------------------- |
| `DEV_MAILBOX`              | Enable `/api/debug/emails` on loopback |
| `DEV_MAILBOX_ALLOW_REMOTE` | Allow a non-loopback dev origin        |
| `DEV_MAILBOX_SECRET`       | Required header for remote exposure    |

Never enable the debug mailbox in production.

## Local development

```bash
cp .dev.vars.example apps/api/.dev.vars
cp .dev.vars.example apps/web/.dev.vars
pnpm api db:migrate
pnpm web dev
```

`ORIGIN` must match the browser URL (`http://localhost:9050` by default). For HTTPS:

```bash
pnpm dev:cert
DEV_HTTPS=1 pnpm web dev
# ORIGIN=https://localhost:9050
```

## Next

- [Self-hosting](/operations/self-hosting)
- [Monitoring](/operations/monitoring)
