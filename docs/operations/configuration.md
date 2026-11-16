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

### Web Worker

`AUTH_SECRET` is also a runtime secret on the dashboard Worker (`mattrax`), not just the
API Worker (`mattrax-api`). It verifies the short-lived `__Host-mattrax_ssr` bootstrap
token at the edge. Both Workers must use exactly the same value:

```bash
cf workers secrets update AUTH_SECRET --worker mattrax-api --type secret_text --text '...'
cf workers secrets update AUTH_SECRET --worker mattrax --type secret_text --text '...'
```

Self-hosted deployments get it from the same `AUTH_SECRET` environment variable in
`apps/docker`. If the dashboard Worker has no secret, or the two values differ, pages
still render correctly: the Worker falls back to `GET /api/v1/bootstrap` on every
authenticated navigation. That costs one membership/role query per tenant, turns every
warm token into a miss, and logs a one-time `console.error` per isolate (grouped by
Workers Issues). It never logs the secret and is not an authorisation bypass: bootstrap
remains the authority.

Blast radius: the web Worker only verifies HMACs, but the value it holds is the platform
root secret. Anyone who can read that Worker's bindings or ship code to it can forge
sessions, unseal stored vendor credentials and sign SSR tokens for any account. Keep the
web Worker's environment as restricted as the API Worker's while the key is shared.
Long term the plan is a dedicated `SSR_TOKEN_SECRET` minted by the API and verified by the
edge, so the web Worker never holds `AUTH_SECRET`; this is not implemented yet.

## Hyperdrive

The API Worker reaches MySQL through Hyperdrive. Query caching must stay disabled:

```bash
cf hyperdrive update <hyperdrive-id> --caching-disabled true
cf hyperdrive restart <hyperdrive-id>
```

Tenant creation writes the membership row and the next `/api/v1/me` reads it back. With the
default 60-second query cache, a brand-new tenant can be missing from the switcher for about
a minute even though the write succeeded. Disabling the cache keeps every read consistent
with the write and avoids similar stale reads on policy and membership changes.

## Auth and origins

| Variable          | Default | Purpose                                 |
| ----------------- | ------- | --------------------------------------- |
| `TRUSTED_ORIGINS` | —       | Comma-separated extra same-site origins |

## Billing

| Variable                         | Purpose                           |
| -------------------------------- | --------------------------------- |
| `STRIPE_SECRET_KEY`              | Stripe API key                    |
| `STRIPE_WEBHOOK_SECRET`          | Stripe webhook signature          |
| `STRIPE_DEVICE_MONTHLY_PRICE_ID` | Price mapped to the `device` plan |
| `STRIPE_LICENSE_PRICE_ID`        | Per-device price for self-hosted deployment licences |
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

| Variable                                 | Purpose                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CLOUD_APPLE_VENDOR_CERT`                | Vendor certificate for APNs CSR signing                                                         |
| `CLOUD_APPLE_VENDOR_KEY`                 | Vendor private key                                                                              |
| `APPLE_PROFILE_SIGNING_CERT`             | Leaf certificate used to CMS-sign Apple profiles                                                |
| `APPLE_PROFILE_SIGNING_KEY`              | RSA PKCS#8 PEM private key for profile signing                                                  |
| `APPLE_PROFILE_SIGNING_CHAIN`            | Optional intermediate/root PEM bundle                                                           |
| `APNS_RELAY_URL`                         | Multi-tenant APNs relay base URL                                                                |
| `APNS_RELAY_SECRET`                      | Relay HMAC secret (at least 32 characters)                                                      |
| `MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS` | Lifetime of the bearer SCEP challenge in an enrollment profile, 60–86400 seconds (default 3600) |

Without the vendor key, tenants upload a manually signed APNs certificate. Without the
relay, hosted multi-tenant Cloud has no push transport and devices poll.

When the profile signing identity is absent, the owning tenant's SCEP CA signs profile
downloads. The CA is created on first use, so there is no unsigned window. A configured
identity that cannot be loaded fails the download rather than serving an unsigned profile.

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

| Variable                                | Default | Purpose                           |
| --------------------------------------- | ------- | --------------------------------- |
| `MAINTENANCE_STALE_DEVICE_DAYS`         | `30`    | Mark devices stale                |
| `MAINTENANCE_AUDIT_RETENTION_DAYS`      | `365`   | `0` keeps forever                 |
| `MAINTENANCE_BACKUP_RETENTION_DAYS`     | `30`    | `0` keeps forever                 |
| `MAINTENANCE_BACKUP_CONCURRENCY`        | `4`     | Tenants backed up at once         |
| `MAINTENANCE_ENTRA_SYNC_CONCURRENCY`    | `2`     | Tenants synced at once            |
| `MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY`  | `4`     | Outbox deliveries in flight       |
| `MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS` | `5`     | Attempts before permanent failure |

## Transactional email

Invitations, verification codes, email-change notices and credential-expiry
alerts are queued in the `email_outbox` table and delivered by the cron, not
sent inline. A request writes one row per recipient with the rendered message;
an outage delays mail instead of failing the request or losing the message.

- The hourly trigger drains the outbox; the daily maintenance run drains and
  prunes it as well, so a deployment with only one cron still delivers.
- Attempts back off exponentially from 5 minutes, capped at 6 hours, and a row
  is permanently failed after `MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS` (default
  5). The failure is written to the tenant audit log as
  `email.delivery_failed` (or `account.email_delivery_failed` for account mail)
  with the template and recipient.
- Delivery is bounded to `MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY` rows at once
  and 50 rows per run. A claim prevents two isolates delivering the same row.
- Rows carry a dedupe key where one is possible (`invitation:<id>:<send>`), so a
  retried request cannot queue the same invitation twice. Delivered rows are
  pruned after 7 days and permanently failed rows after 30.
- With no transport rows stay pending. Nothing is logged in place of a message:
  verification fails with "This deployment cannot send email" and invitations
  return their one-time link.

Transport selection is explicit:

| Variable                 | Purpose                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| `MAIL_TRANSPORT`         | `smtp`, `cloudflare` or `disabled`.                                           |
| `MAIL_FROM`              | Verified sender, e.g. `Mattrax <notifications@example.com>`.                  |
| `MAIL_SMTP_HOST`         | SMTP server for `MAIL_TRANSPORT=smtp`.                                        |
| `MAIL_SMTP_PORT`         | SMTP port; defaults to 587, or 465 with `MAIL_SMTP_SECURE`.                   |
| `MAIL_SMTP_SECURE`       | `true` for implicit TLS instead of STARTTLS.                                  |
| `MAIL_SMTP_USER`         | SMTP AUTH username.                                                           |
| `MAIL_SMTP_PASSWORD`     | SMTP AUTH password.                                                           |
| `MAIL_SMTP_HELO`         | EHLO name; defaults to the runtime hostname.                                  |

Hosted Mattrax uses the Cloudflare `send_email` binding when `MAIL_TRANSPORT`
is unset; `smtp` sends through the operator's own mail server. `MAIL_FROM` defaults to `hello@mattrax.cloud` there, and
`MATTRAX_INVITATION_FROM` still overrides the invitation sender. The binding
only accepts the addresses listed in `apps/cloud/cloudflare.config.ts`
(`hello@mattrax.cloud`); set `MAIL_TRANSPORT=smtp` to send from
another verified domain.
`/api/ready` reports `mailer: ok`, `skipped` (explicitly disabled) or `error`
(the transport is misconfigured or missing), so a typo cannot look healthy.

## Onboarding email

Two one-time emails are sent from `MAIL_FROM` when it is configured; the hosted
default is `hello@mattrax.cloud` with the display name **"Oscar from Mattrax"**.
They never use a `no-reply` address; replies go to the configured mailbox.

- **Welcome** — sent once per manual account immediately after email
  verification. SCIM/Graph accounts are never emailed. A bounded daily backstop
  retries recent verified accounts whose marker is still empty.
- **One-week follow-up** — one private message per verified tenant owner/admin,
  sent once per tenant by the daily cron when the tenant is at least seven days
  old, is still inside the window (by default up to fourteen days old), and has
  no enrolled device, no recently created enrolling device and no successful
  enrollment attempt.

| Variable                                | Default               | Purpose                                                        |
| --------------------------------------- | --------------------- | -------------------------------------------------------------- |
| `MATTRAX_ONBOARDING_REPLY_TO`           | `oscar@otbeaumont.me` | Reply-To for both emails; use a monitored mailbox              |
| `MATTRAX_ONBOARDING_SUPPORT_EMAIL`      | `hello@mattrax.cloud` | Footer support address                                         |
| `MATTRAX_ONBOARDING_SINCE`              | —                     | ISO date; tenants created earlier are never follow-up eligible |
| `MAINTENANCE_ONBOARDING_EMAILS`         | `true`                | Set `false`, `0` or `off` to disable the follow-up sweep       |
| `MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS` | `7`                   | Days after tenant creation before the follow-up is eligible    |
| `MAINTENANCE_ONBOARDING_WINDOW_DAYS`    | `7`                   | Extra days after the threshold that remain eligible            |
| `MAINTENANCE_ONBOARDING_COOLDOWN_DAYS`  | `7`                   | Per-recipient cooldown across tenants; `0` disables it         |

An invalid `MATTRAX_ONBOARDING_REPLY_TO` or `MATTRAX_ONBOARDING_SUPPORT_EMAIL`
is reported once per isolate and the built-in default is used instead, so a typo
cannot fail every send.

Set `MATTRAX_ONBOARDING_SINCE` to the deploy date when enabling the follow-up on
an existing deployment. Without it, tenants created in the trailing
`FOLLOW_UP_DAYS + WINDOW_DAYS` window are eligible, which may include customers
who predate the feature. The welcome email is transactional and is not affected
by `MAINTENANCE_ONBOARDING_EMAILS`.

The follow-up eligibility window is therefore 7–14 days after tenant creation
with the defaults. The cooldown is derived from onboarding audit rows, so
`MAINTENANCE_AUDIT_RETENTION_DAYS` must stay well above
`MAINTENANCE_ONBOARDING_COOLDOWN_DAYS` (365 versus 7 by default); trimming audit
retention below the cooldown would let the same owner receive another tenant's
follow-up. Both emails claim their one-time marker before calling the provider:
if an isolate dies in that gap the message is lost rather than sent twice.

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

## Analytics and error tracking

| Variable                              | Default                    | Purpose                 |
| ------------------------------------- | -------------------------- | ----------------------- |
| `POSTHOG_KEY`                         | —                          | PostHog project API key |
| `POSTHOG_HOST`                        | `https://us.i.posthog.com` | PostHog ingestion host  |
| `POSTHOG_ENVIRONMENT`                 | —                          | Environment tag         |
| `POSTHOG_ERROR_SAMPLE_RATE`           | `1`                        | Error sampling, `0`–`1` |
| `POSTHOG_ERROR_MAX_EVENTS_PER_MINUTE` | `20`                       | Per-isolate error cap   |

`POSTHOG_KEY` is a write-only project key. Set it on both the dashboard and API
Workers: the dashboard injects it into the HTML for browser analytics, and the API
uses it for server-side product events and error tracking. Payloads contain a
redacted message, request id, path, method, status, release and deployment id.
Bodies, cookies, query strings, emails and tokens are excluded.

## Development only

| Variable                   | Purpose                                |
| -------------------------- | -------------------------------------- |
| `DEV_MAILBOX`              | Enable `/api/debug/emails` on loopback |
| `DEV_MAILBOX_ALLOW_REMOTE` | Allow a non-loopback dev origin        |
| `DEV_MAILBOX_SECRET`       | Required header for remote exposure    |

`POST /api/debug/onboarding-emails` runs the welcome backstop and follow-up
sweeps in the current isolate so browser tests can prove once-only delivery.
It is gated by the same loopback/secret rules as `/api/debug/emails` and is
excluded from analytics.

Never enable the debug mailbox in production.

## Local development

```bash
cp .dev.vars.example apps/cloud/.dev.vars
cp .dev.vars.example apps/web/.dev.vars
pnpm cloud db:migrate
pnpm web dev
```

`ORIGIN` must match the browser URL (`http://localhost:9050` by default). For HTTPS:

```bash
pnpm dev:cert
DEV_HTTPS=1 pnpm web dev
# ORIGIN=https://localhost:9050
```

## Next

- [Monitoring](/operations/monitoring)
