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

### Support and calendar link

| Variable      | Default                                              | Purpose                              |
| ------------- | ---------------------------------------------------- | ------------------------------------ |
| `SUPPORT_URL` | `mailto:hello@mattrax.app?subject=Mattrax%20support` | Support form or calendar booking URL |

Set `SUPPORT_URL` on the dashboard Worker (`mattrax`) or in the self-hosted
container's environment. It is used by the account menu and the overview's "Get
started" checklist. `https:`, `http:` and `mailto:` values are accepted; anything
else falls back to the default mailto so a misconfiguration cannot render a dead
or script link. The value is public: it is injected into the HTML shell like the
PostHog configuration.

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

## Platform superadmins

| Variable              | Default | Purpose                                                     |
| --------------------- | ------- | ----------------------------------------------------------- |
| `MATTRAX_SUPERADMINS` | —       | Comma-separated verified emails that always hold superadmin |

A superadmin is a platform operator, not a tenant role. It grants the
cross-tenant account catalogue at **Account menu → Platform accounts**
(`/admin/accounts`): listing every account, its tenant memberships and its
platform-access flag, and promoting or demoting other accounts. It does not
grant access to any tenant's devices, policies, members or audit log.

`MATTRAX_SUPERADMINS` is the bootstrap path: a fresh deployment has no stored
superadmin, so the deployer names one before the first sign-in. Entries are
trimmed and compared case-insensitively; blank entries are ignored. The listed
address must be verified on the account, and the allowlist is authoritative
over the stored flag — an account named there cannot be demoted from the
dashboard or the API. Removing the entry and redeploying is the only way to
take that account's access away.

Keep the list small and owned by the deployer. The first stored superadmin can
then grant access to the others without a redeploy. The API refuses to demote
the caller themselves or the last enabled superadmin, and refuses to promote a
disabled account. Every grant and revocation is written to the account audit
stream with the actor, target and before/after state.

## Billing

| Variable              | Purpose                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `SERVICES_URL`        | Hosted services origin; defaults to `https://services.mattrax.app` |
| `SERVICES_TOKEN`      | Shared Cloud-to-services bearer token                              |
| `STRIPE_*`            | Configured on the services deployment, not the application         |
| `MATTRAX_PLAN_LIMITS` | JSON plan/seat catalogue                                           |

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
| `APNS_RELAY_URL`                         | APNs relay URL; defaults to `https://services.mattrax.app/v1/apns/push`                         |
| `APNS_RELAY_SECRET`                      | Optional relay HMAC secret; self-hosted installs use `MATTRAX_LICENSE_KEY` instead              |
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

## Google Workspace directory sync

| Variable                                | Purpose                                                      |
| --------------------------------------- | ------------------------------------------------------------ |
| `GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON` | Optional deployment-wide service-account JSON key            |
| `GOOGLE_WORKSPACE_ADMIN_EMAIL`          | Workspace super-admin to impersonate (deployment mode)       |
| `GOOGLE_WORKSPACE_CUSTOMER`             | `my_customer` or a primary domain; defaults to `my_customer` |
| `MAINTENANCE_GOOGLE_SYNC_CONCURRENCY`   | Parallel tenants in the scheduled sweep; defaults to 2       |

Tenants can instead save their own key under **Settings → Identity → Directory sync**;
it is sealed with `AUTH_SECRET` and takes precedence over the deployment values. See
[Identity](/admin/identity#google-workspace).

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

| Variable                                | Default | Purpose                                          |
| --------------------------------------- | ------- | ------------------------------------------------ |
| `MAINTENANCE_STALE_DEVICE_DAYS`         | `30`    | Auto-unenrol devices not seen for this many days |
| `MAINTENANCE_AUDIT_RETENTION_DAYS`      | `365`   | `0` keeps forever                                |
| `MAINTENANCE_BACKUP_RETENTION_DAYS`     | `30`    | `0` keeps forever                                |
| `MAINTENANCE_BACKUP_CONCURRENCY`        | `4`     | Tenants backed up at once                        |
| `MAINTENANCE_ENTRA_SYNC_CONCURRENCY`    | `2`     | Tenants synced at once                           |
| `MAINTENANCE_EMAIL_OUTBOX_CONCURRENCY`  | `4`     | Outbox deliveries in flight                      |
| `MAINTENANCE_EMAIL_OUTBOX_MAX_ATTEMPTS` | `5`     | Attempts before permanent failure                |

### Device (MDM) event volume

Device check-ins are recorded in the same organisation log as account actions. Repeated
check-ins from one device are folded into a single `mdm.checkin` row inside a window;
enrollment, policy delivery, status changes, command results and failures always append a
separate row. `MDM_AUDIT_CHECKIN_COALESCE_SECONDS` sets the window (default `900`, `0`
records every check-in); the setting is bounded to one day.

| Variable                             | Default | Purpose                                            |
| ------------------------------------ | ------- | -------------------------------------------------- |
| `MDM_AUDIT_CHECKIN_COALESCE_SECONDS` | `900`   | Fold repeated device check-ins into one audit row. |

Device health uses fixed thresholds ahead of the auto-unenrol sweep: stale after 7 days
(`attention`) and MIA after 14 days (still enrolled). `MAINTENANCE_STALE_DEVICE_DAYS` must
stay above 14 for MIA to be observable; the default 30 retires the device after both
states. If this is lowered below 14, maintenance unenrols devices before they can be MIA.

## macOS update warnings (SOFA)

The dashboard, device list and device page compare each Mac's reported `osVersion` with
the [SOFA](https://github.com/macadmins/sofa) macOS feed. SOFA publishes the latest
release and the security releases for each macOS major version, so a device on an older
patch of a supported major gets "Security update required", and a device that is current
for its major but has a newer major available gets "Update available".

The feed is deployment-wide and cached in `software_update_feed`. Dashboard and device
requests reuse the cached catalog for the cache window. Concurrent requests in one worker
isolate share a single refresh, and a timeout, an HTTP error or a malformed feed is
remembered as a short cooldown; the last good catalog (if any) is served as stale. If there
is no cached catalog, macOS devices report `unknown` — they are never treated as up to
date. Check-in and policy delivery do not depend on this feed.

| Variable                     | Default                                                 | Purpose                                                        |
| ---------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| `SOFA_FEED_URL`              | `https://sofafeed.macadmins.io/v1/macos_data_feed.json` | Feed or mirror URL                                             |
| `SOFA_FEED_CACHE_SECONDS`    | `21600` (6 hours)                                       | Minimum age before a cached feed is refreshed                  |
| `SOFA_FEED_RETRY_SECONDS`    | `900` (15 minutes)                                      | Failure cooldown before another refresh is attempted           |
| `SOFA_FEED_TIMEOUT_MS`       | `5000`                                                  | Deadline for one feed request                                  |
| `SOFA_FEED_SUPPORTED_MAJORS` | `3`                                                     | Current plus previous majors treated as supported (1–10)       |
| `SOFA_FEED_DISABLED`         | unset                                                   | `true` disables the feed; every macOS status becomes `unknown` |

Only macOS is covered. Windows and Android devices report no status (the UI shows "—")
until a supported update source is added; they are not counted as up to date.

## Transactional email

Invitations, verification codes, email-change notices and credential-expiry
alerts are queued in the `email_outbox` table. A request writes one row per
recipient with the rendered message; an outage delays mail instead of failing
the request or losing the message.

- Verification codes and the email-change confirmation are the exception: the
  request also attempts that one row immediately, because a code the person is
  waiting on cannot sit until the next sweep. The row is still the durable
  record — a failed attempt backs off and is retried like any other — and the
  response reports `emailSent: false` so the page can say the mail did not go
  out.
- Every other message waits for the sweep. The hourly trigger drains the outbox;
  the daily maintenance run drains and prunes it as well, so a deployment with
  only one cron still delivers.
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

| Variable             | Purpose                                                      |
| -------------------- | ------------------------------------------------------------ |
| `MAIL_TRANSPORT`     | `smtp`, `cloudflare` or `disabled`.                          |
| `MAIL_FROM`          | Verified sender, e.g. `Mattrax <notifications@example.com>`. |
| `MAIL_SMTP_HOST`     | SMTP server for `MAIL_TRANSPORT=smtp`.                       |
| `MAIL_SMTP_PORT`     | SMTP port; defaults to 587, or 465 with `MAIL_SMTP_SECURE`.  |
| `MAIL_SMTP_SECURE`   | `true` for implicit TLS instead of STARTTLS.                 |
| `MAIL_SMTP_USER`     | SMTP AUTH username.                                          |
| `MAIL_SMTP_PASSWORD` | SMTP AUTH password.                                          |
| `MAIL_SMTP_HELO`     | EHLO name; defaults to the runtime hostname.                 |

Hosted Mattrax uses the Cloudflare `send_email` binding when `MAIL_TRANSPORT`
is unset; `smtp` sends through the operator's own mail server. `MAIL_FROM` defaults to `hello@mattrax.cloud` there, and
`MATTRAX_INVITATION_FROM` still overrides the invitation sender. The binding
only accepts the addresses listed in `apps/cloud/cloudflare.config.ts`
(`hello@mattrax.cloud`); set `MAIL_TRANSPORT=smtp` to send from
another verified domain.

Cloudflare refuses recipients with `destination address is not a verified
address` until the sender's domain is onboarded to Email Sending in that
account. That failure is recorded on the outbox row (and audited once the
attempts run out), and the sign-up page reports it as "we couldn't send that
email", so a binding that deploys but never delivers is visible rather than
silent. Onboard the domain, or switch to `MAIL_TRANSPORT=smtp`.

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
uses it for server-side product events and error tracking. The dashboard classifies
its environment from the public hostname (`production`, `preview` or `development`)
and attaches its deployment id to every event. API payloads contain a redacted
message, request id, path, method, status, release and deployment id. Bodies,
cookies, query strings, emails and tokens are excluded; browser autocapture text is
redacted the same way.

## Telemetry and metrics

| Variable                | Default | Purpose                                                                                  |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `MATTRAX_TELEMETRY`     | on      | `off` installs Effect's no-op tracer: no spans, no metrics, no per-request work          |
| `MATTRAX_METRICS`       | `off`   | `public` serves `/api/metrics`; `token` requires a bearer token; `on`/`true` mean public |
| `MATTRAX_METRICS_TOKEN` | —       | Bearer token for `MATTRAX_METRICS=token`; a missing token fails closed (404)             |

The endpoint is Prometheus text format with aggregate-only labels: no tenant, device, email
or raw URL. See [Monitoring](/operations/monitoring#metrics) for the metric catalogue and
the per-isolate caveat.

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
