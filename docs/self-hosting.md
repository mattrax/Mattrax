# Self-hosting

There are two different self-hosting stories in this repository. Pick the one that
matches what you are trying to run.

| You want to run…                                            | Deploy                                           | Data                                     |
| ----------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| The full Enterprise product with dashboard, API and billing | **Cloud on Cloudflare** (`apps/api`, `apps/web`) | MySQL, R2, Cloudflare Email, Stripe      |
| Your own product on top of Mattrax's Apple MDM gateway      | **Whitelabel gateway** (`apps/mttx`)             | Your management backend; SCEP CA on disk |

The whitelabel gateway is not a cut-down Enterprise server. It has no tenants, devices,
groups, policies, billing, or dashboard. See [Whitelabel](./whitelabel/) before choosing
that path.

## Prerequisites

- Node.js `>=22.12.0`
- pnpm `10.33.2`
- A domain with trusted TLS. Apple devices will not enrol over HTTP.
- For Cloud: a Cloudflare account with Workers, Hyperdrive, R2, Email Sending and
  (optionally) Stripe.
- For Cloud: MySQL 8.0+ reachable from Hyperdrive.
- For Apple management: an APNs push certificate. Mattrax generates the CSR.

Install workspace dependencies:

```bash
pnpm install
```

## Cloud on Cloudflare

Cloud is two Workers. `mattrax-api` owns the API and MDM endpoints; `mattrax` serves the
dashboard and docs and reaches the API through a service binding. Only the web Worker is
public.

### 1. Create the database

```bash
docker run -d \
  --name mattraxe-mysql \
  -e MYSQL_ROOT_PASSWORD=change-me \
  -e MYSQL_DATABASE=mattraxe \
  -e MYSQL_USER=mattrax \
  -e MYSQL_PASSWORD=mattrax \
  -p 3306:3306 \
  mysql:8.0
```

For production, use a managed MySQL with TLS and point Cloudflare Hyperdrive at it.

### 2. Configure Hyperdrive, storage and email

In `apps/api/cloudflare.config.ts` the Hyperdrive binding currently has a fixed id. Create
your own Hyperdrive configuration and replace that id. The same file declares the R2
bucket (`STORAGE`), the Email Sending binding (`EMAIL`), and the Worker name.

The web Worker's custom domain is set in `apps/web/cloudflare.config.ts`. Change it from
the placeholder `e.mattrax.app` to the hostname you control.

### 3. Set Worker secrets

Cloud validates these at startup. `ORIGIN` must be the public dashboard origin.

| Secret                                    | Required | Purpose                                                             |
| ----------------------------------------- | -------- | ------------------------------------------------------------------- |
| `ORIGIN`                                  | Yes      | Canonical public origin; also the WebAuthn RP id/origin.            |
| `AUTH_SECRET`                             | Yes      | Signs sessions, seals APNs and SCEP CA keys. Back this up.          |
| `AUTH_RESET_URL`                          | No       | Public URL used in password-reset emails. Defaults to `ORIGIN`.     |
| `TRUSTED_ORIGINS`                         | No       | Extra same-site browser origins (and WebAuthn origins).             |
| `STRIPE_SECRET_KEY`                       | Yes      | Stripe API key.                                                     |
| `STRIPE_WEBHOOK_SECRET`                   | Yes      | Stripe webhook verification secret.                                 |
| `STRIPE_DEVICE_MONTHLY_PRICE_ID`          | Yes      | Stripe price used for per-device billing.                           |
| `MATTRAX_PLAN_LIMITS`                     | No       | JSON plan catalogue for device/tenant limits. Unlimited when unset. |
| `CLOUD_APPLE_VENDOR_CERT`                 | No       | Apple MDM vendor certificate used to sign APNs CSRs.                |
| `CLOUD_APPLE_VENDOR_KEY`                  | No       | Vendor private key paired with the certificate.                     |
| `AZURE_CLIENT_ID`                         | No       | Entra ID app client ID for tenant SSO.                              |
| `AZURE_CLIENT_SECRET`                     | No       | Entra ID app client secret for tenant SSO.                          |
| `ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON` | No       | Full Google service-account JSON for Android Enterprise.            |
| `ANDROID_MANAGEMENT_PROJECT_ID`           | No       | Google Cloud project; defaults to the service account project.      |
| `ANDROID_MANAGEMENT_PUBSUB_TOPIC`         | No       | `projects/{project}/topics/{topic}` for Android notifications.      |
| `ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION`  | No       | Push subscription receiving Android notifications.                  |
| `ANDROID_MANAGEMENT_PUBSUB_AUDIENCE`      | No       | OIDC audience; defaults to `<ORIGIN>/api/v1/android/pubsub`.        |
| `ANDROID_MANAGEMENT_PUBSUB_JWKS_URI`      | No       | Optional JWKS override for tests/non-Google setups.                 |
| `SENTRY_DSN`                              | No       | Sentry-compatible DSN for uncaught/5xx error events.                |
| `SENTRY_ENVIRONMENT`                      | No       | Sentry environment tag (for example `production`).                  |
| `SENTRY_SAMPLE_RATE`                      | No       | Fraction of eligible errors to send, `0`–`1`. Default `1`.          |
| `SENTRY_MAX_EVENTS_PER_MINUTE`            | No       | Per-isolate event cap. Default `20`.                                |

```bash
cf auth login

cf workers secrets update ORIGIN \
  --worker mattrax-api --type secret_text --text 'https://mdm.example.com'

cf workers secrets update AUTH_SECRET \
  --worker mattrax-api --type secret_text --text "$(openssl rand -base64 32)"

cf workers secrets update STRIPE_SECRET_KEY \
  --worker mattrax-api --type secret_text --text 'sk_live_...'

# Repeat for the remaining secrets.
```

Generate a suitable auth secret with:

```bash
openssl rand -base64 32
```

If `CLOUD_APPLE_VENDOR_CERT` and `CLOUD_APPLE_VENDOR_KEY` are omitted, tenants can still
upload a manually signed APNs certificate. They cannot use the one-click vendor-signed
CSR flow.

### Plan and seat limits

Plan/seat enforcement is deployment configuration, not a hard-coded pricing decision.
Set the optional `MATTRAX_PLAN_LIMITS` secret to a JSON object mapping each Stripe plan
name to device and tenant limits:

```json
{
  "free": { "devices": 50, "tenants": 1 },
  "device": { "devices": null, "tenants": null }
}
```

```bash
cf workers secrets update MATTRAX_PLAN_LIMITS \
  --worker mattrax-api --type secret_text \
  --text '{"free":{"devices":50,"tenants":1},"device":{"devices":null,"tenants":null}}'
```

The nested form is also accepted when a default plan is needed for tenants without a
subscription:

```json
{
  "defaultPlan": "free",
  "plans": {
    "free": { "devices": 50, "tenants": 1 },
    "device": { "devices": null, "tenants": null }
  }
}
```

- A missing limit or `null` means unlimited. `0` means the plan allows none.
- The plan comes from the `subscription` row written by the Stripe webhook. A tenant
  with no subscription, or with a `canceled`, `incomplete_expired` or `unpaid`
  subscription, uses `defaultPlan` (`free` unless configured).
- An unknown plan name is treated as unlimited, so a newly added Stripe price cannot
  lock out an existing customer before the catalogue is updated.
- The limit is checked when a device enrolls (public enrollment readiness, Apple
  `Authenticate`, Windows enrollment and Android enrollment-token issuance) and when
  pre-registrations are imported. Existing devices are never deleted: a tenant over a
  newly lowered limit keeps every device and can still manage, rename and unenroll them.
- Tenant creation is limited per account, counting tenants where the user is an owner.
  The account uses the most permissive plan among the tenants it already owns.
- Invalid JSON, negative or non-integer limits fail safe to unlimited and log a warning
  at startup. The Worker does not crash.
- Billing (`GET /v1/tenants/:tenantId/billing`) reports `plan`, `status`, `deviceLimit`,
  `tenantLimit`, `devicesUsed`, `tenantsUsed`, `overDeviceLimit` and `overTenantLimit`.

Omitting the secret preserves the previous behaviour: every plan is unlimited.

### Microsoft Entra ID single sign-on

Create a Microsoft Entra ID app registration with a web redirect URI of
`<ORIGIN>/api/v1/sso/azure/callback`. Set `AZURE_CLIENT_ID` and
`AZURE_CLIENT_SECRET` on the API Worker. Each tenant then enters its Entra
tenant ID under **Settings → Identity**, enables SSO, and can test the flow
there or from the login page's work-email SSO form.

SCIM provisioning uses the same identity provider independently. Users can be
auto-provisioned on first SSO sign-in; disable **Create members on first
sign-in** if membership must come from invitations only.

### Android Enterprise

Android delivery is optional. Create a Google Cloud service account with the
Android Management API enabled, grant it the Android Management user role, and
create a Pub/Sub topic plus a push subscription whose endpoint is
`<ORIGIN>/api/v1/android/pubsub`. Configure the subscription with an OIDC
service account token whose audience matches
`ANDROID_MANAGEMENT_PUBSUB_AUDIENCE` (or the default endpoint URL). Set
`ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON` to the full key-file JSON; the private
key is used in memory only and is never written to the database. The topic and
subscription must already exist; the callback records their names and Google
uses the topic for enrollment/status/command notifications. Without the service
account secret every Android endpoint returns a clear `EnterpriseNotConfigured`
error and the dashboard keeps Android unavailable.

After deploying, open **Settings → Management → Android** and use **Connect
Android Enterprise**. Google hosts the signup; the callback stores the
enterprise name, ensures the starting policy exists, and marks the tenant
active. Real-device validation (signup, Pub/Sub, enrollment QR/token, policy
and command convergence) is still required before relying on Android in
production.

### 4. Apply migrations

Drizzle Kit reads individual MySQL connection variables, not a single URL.

```bash
DATABASE_HOST=your-mysql-host \
DATABASE_PORT=3306 \
DATABASE_USER=mattrax \
DATABASE_PASSWORD=change-me \
DATABASE_NAME=mattraxe \
pnpm api db:migrate
```

After changing the schema:

```bash
pnpm api db:generate
```

Migrations are not run automatically during a Worker deploy. Apply them before deploying
code that depends on them.

### 5. Deploy

```bash
# API Worker
pnpm api deploy:prod

# Dashboard Worker; also builds the docs and copies them into the asset bundle
pnpm web deploy:prod

# Both, in order
pnpm deploy:prod:all
```

Verify:

```bash
curl https://mdm.example.com/api/health
```

It should return `ok`. The API Worker also has a `/health` alias, but only `/api/*` is
proxied by the public web Worker.

### Operational defaults

- **Security headers.** The dashboard Worker sets `Content-Security-Policy`
  (`frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin` and HSTS on HTTPS responses. No
  extra configuration is required.
- **Scheduled maintenance and backups.** `apps/api/cloudflare.config.ts` registers a
  daily cron (`17 3 * * *`). It expires invitations, marks devices stale after 30 days
  without a check-in, removes expired auth proofs/sessions, applies 365-day audit
  retention, then backs up every tenant (see [Scheduled tenant
  backups](#scheduled-tenant-backups)). An hourly cron (`47 * * * *`) sweeps due
  Entra directory syncs so tenants can schedule Off/Hourly/Daily/Weekly runs. Override
  with `MAINTENANCE_STALE_DEVICE_DAYS`, `MAINTENANCE_AUDIT_RETENTION_DAYS` (set the
  latter to `0` to keep audit entries indefinitely), `MAINTENANCE_BACKUP_RETENTION_DAYS`,
  `MAINTENANCE_BACKUP_CONCURRENCY` and `MAINTENANCE_ENTRA_SYNC_CONCURRENCY`. The same
  `runMaintenance`, `runScheduledBackups` and `runScheduledEntraSync` functions are
  exported from `@mattrax/enterprise-backend` for external schedulers.
- **Edge rate limits.** Cloudflare Rate Limiting namespaces are optional per bucket. At
  build time, set any of `MATTRAX_RATE_LIMIT_AUTH_NAMESPACE`,
  `MATTRAX_RATE_LIMIT_ENROLLMENT_NAMESPACE`, `MATTRAX_RATE_LIMIT_MDM_NAMESPACE`,
  `MATTRAX_RATE_LIMIT_SCIM_NAMESPACE`, `MATTRAX_RATE_LIMIT_BILLING_NAMESPACE` or
  `MATTRAX_RATE_LIMIT_SCEP_NAMESPACE`; the build then exposes the matching
  `RATE_LIMITER_AUTH`, `RATE_LIMITER_ENROLLMENT`, `RATE_LIMITER_MDM`,
  `RATE_LIMITER_SCIM`, `RATE_LIMITER_BILLING` and `RATE_LIMITER_SCEP` bindings. A
  bucket without a binding falls back to per-isolate counters.
- **Error tracking.** Set `SENTRY_DSN` (plus optional `SENTRY_ENVIRONMENT`,
  `SENTRY_SAMPLE_RATE`, `SENTRY_MAX_EVENTS_PER_MINUTE`) to send uncaught/5xx events.
  Payloads contain a redacted message, request id, path, method, status, release and
  deployment id only; bodies, cookies, query strings, emails and tokens are excluded.
- **Windows.** Tenant-scoped discovery URLs work without extra configuration. Each
  enrollment link carries a signed tenant token that expires; reload the enrollment page
  for a fresh one. `WINDOWS_ORGANIZATION_ID` is optional and only keeps the old
  un-scoped discovery URL working for a single-tenant deployment.
- **Debug mailbox.** `DEV_MAILBOX=true` only enables `/api/debug/emails` on a loopback
  origin. A non-loopback dev origin needs `DEV_MAILBOX_ALLOW_REMOTE=true`, and
  `DEV_MAILBOX_SECRET` adds a required `x-dev-mailbox-secret` header. Never enable it in
  production.

### 6. Create the first administrator

Open `https://mdm.example.com/register`, create an account, then create a tenant. The
account that creates a tenant is its `owner`. Invite other administrators from **Tenant
settings → Administrators**.

### 7. Configure APNs

Open the tenant's **Settings → Management** page and follow the CSR flow described in the
[quick start](./quick-start#_1-configure-apns-apple-only). The private key stays on the
server and is sealed with `AUTH_SECRET`.

## Whitelabel gateway on a Node server

The gateway is the `mttx` CLI in `apps/mttx`. It terminates Apple MDM and SCEP traffic and
calls your management backend over HTTP. It does not schedule pushes or store devices.

The gateway does not run the Enterprise maintenance job and does not send credential-expiry
email. Credential-expiry notifications are a Cloud feature of the `apps/api` scheduled
handler; whitelabel operators must monitor the APNs certificate and SCEP CA expiry in their
own tooling.

### Run from source

```bash
pnpm mserver dev serve \
  --port 3000 \
  --origin https://mdm.example.com \
  --webhook-url https://api.example.com \
  --data-dir ./data \
  --apple-vendor-cert ./certs/apple-vendor.pem
```

| Flag                  | Required | Default                          | Purpose                                                               |
| --------------------- | -------- | -------------------------------- | --------------------------------------------------------------------- |
| `--port`              | No       | `3000`                           | HTTP listen port.                                                     |
| `--origin`            | No       | `http://localhost:3000`          | Public origin embedded in enrollment and asset URLs.                  |
| `--webhook-url`       | Yes      | —                                | Base URL of your management backend.                                  |
| `--data-dir`          | No       | `./.data` / `/opt/mattrax`       | Filesystem state (SCEP CA). Bundled builds default to `/opt/mattrax`. |
| `--auth-secret`       | Yes      | `MATTRAX_AUTH_SECRET`            | Verifies SCEP challenges and seals the SCEP CA private key at rest.   |
| `--apple-vendor-cert` | No       | —                                | PEM used to derive the Apple MDM topic for enrollment profiles.       |
| `--brand-name`        | No       | `Mattrax` / `MATTRAX_BRAND_NAME` | Organisation name in generated enrollment profiles.                   |
| `--brand-logo-url`    | No       | `MATTRAX_BRAND_LOGO_URL`         | Logo URL or data URL for white-label frontends.                       |
| `--support-email`     | No       | `hello@mattrax.app`              | Support address embedded in enrollment profiles.                      |
| `--brand-color`       | No       | `MATTRAX_BRAND_COLOR`            | Hex brand colour (for example `#1c1917`) for white-label frontends.   |

The gateway stores `scep-ca.json` with the CA certificate and the CA private key sealed
with AES-256-GCM keyed from `--auth-secret`/`MATTRAX_AUTH_SECRET`. Keep that secret in the
same backup set as the data directory: without it the CA key cannot be opened, and the
gateway fails closed rather than generating a new CA (which would invalidate every issued
device identity). A legacy plaintext `scep-ca.json` is sealed on first read.

### Build a standalone binary

```bash
pnpm mserver build
```

This bundles the server, creates a Node single executable application, and writes
`apps/mttx/dist/mttx` (plus `dist/server.cjs`). On macOS the binary is ad-hoc signed after
injection.

### systemd

```ini
[Unit]
Description=Mattrax whitelabel gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mattrax
Group=mattrax
WorkingDirectory=/opt/mattrax-gateway
ExecStart=/opt/mattrax-gateway/mttx serve \
  --port 3000 \
  --origin https://mdm.example.com \
  --webhook-url https://api.example.com \
  --data-dir /var/lib/mattrax \
  --apple-vendor-cert /etc/mattrax/apple-vendor.pem
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/mattrax

[Install]
WantedBy=multi-user.target
```

::: warning Runtime limit
The current `serve` command shuts down after 24 hours and restarts when the supervisor
starts it again. Use `Restart=always` (or an equivalent container restart policy) so this
is a rolling restart rather than an outage. The server also applies a per-process limit
of roughly 5 requests per second; size fleets accordingly or run multiple instances
behind a proxy.
:::

### Docker

There is no published gateway image in this repository. Build the server, then package
`dist/server.cjs` in a Node 22 image:

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
COPY apps/mttx/dist/server.cjs ./server.cjs
VOLUME ["/opt/mattrax"]
EXPOSE 3000
ENTRYPOINT ["node", "server.cjs"]
CMD ["serve", \
  "--port", "3000", \
  "--origin", "https://mdm.example.com", \
  "--webhook-url", "https://api.example.com", \
  "--apple-vendor-cert", "/etc/mattrax/apple-vendor.pem"]
```

```bash
docker build -t mattrax-gateway .
docker run -d --name mattrax-gateway \
  -p 3000:3000 \
  -v mattrax-data:/opt/mattrax \
  -v "$PWD/certs:/etc/mattrax:ro" \
  mattrax-gateway
```

Terminate TLS at a reverse proxy or load balancer and forward to port 3000.

## Ports

| Port | Process                                              |
| ---- | ---------------------------------------------------- |
| 443  | Public HTTPS (proxy or Cloudflare).                  |
| 3000 | `mttx serve` default listen port.                    |
| 9050 | Cloud dashboard and API during local `pnpm web dev`. |
| 9051 | Example whitelabel Worker during local dev.          |
| 3306 | MySQL for Cloud.                                     |

The gateway does not use the old multi-port layout (9051/9052/9054). It is a single HTTP
listener that serves Apple MDM, SCEP, assets and health.

## APNs and push

Apple MDM push is per tenant and uses the tenant's APNs client certificate.

| Deployment                       | Transport                                                          |
| -------------------------------- | ------------------------------------------------------------------ |
| Self-hosted Node / single tenant | `NodePushTransport` — direct delivery with the tenant certificate. |
| Single-tenant Worker whitelabel  | `MtlsPushTransport` — a per-certificate Workers mTLS binding.      |
| Hosted multi-tenant Cloud        | `RelayPushTransport` — HMAC-signed requests to a push relay.       |

A Cloud Worker cannot select a different client certificate per tenant request, so hosted
Cloud uses a relay. Set `APNS_RELAY_URL` and `APNS_RELAY_SECRET` on the API Worker to
enable it; without them the transport reports unavailable and Apple devices fall back to
polling at check-in. The gateway itself never pushes; your whitelabel management backend
owns push delivery.

This repository ships the relay as `apps/apns-relay`. Run it somewhere with outbound
HTTP/2 access to Apple:

```bash
APNS_RELAY_SECRET="<at-least-32-characters>" PORT=8788 pnpm --filter @mattrax/apns-relay start
```

Then set `APNS_RELAY_URL=https://relay.example.com` and the same
`APNS_RELAY_SECRET` on the Cloud API Worker.

When wiring the relay, treat the relay secret as production key material:

```text
signature = hex(HMAC-SHA256(secret, "<unix-timestamp>.<json-body>"))
headers: x-apns-timestamp, x-apns-signature
```

The relay verifies the timestamp (±5 minutes), the HMAC and the required APNs
fields before opening the HTTP/2 connection.

## Upgrades

Cloud:

```bash
git pull
pnpm install
pnpm test
pnpm typecheck

# Apply migrations first, then deploy
DATABASE_HOST=... DATABASE_PORT=3306 DATABASE_USER=... \
  DATABASE_PASSWORD=... DATABASE_NAME=mattraxe pnpm api db:migrate

pnpm deploy:prod:all
```

Gateway:

```bash
git pull
pnpm install
pnpm mserver build

# Replace the binary, keep the data directory, then restart
sudo install -m 0755 apps/mttx/dist/mttx /opt/mattrax-gateway/mttx
sudo systemctl restart mattrax-gateway
```

## MFA lockout recovery

If an administrator loses both their authenticator and recovery codes, another
owner can reset the factor from the database after verifying the account:

```sql
-- Replace :user_id with the account id. Bumps the auth revision so every
-- existing session is invalidated.
DELETE FROM auth_totp_factor
 WHERE JSON_UNQUOTE(JSON_EXTRACT(state, '$.subjectId')) = :user_id;
UPDATE `user` SET totp_enabled = false, auth_revision = UUID() WHERE id = :user_id;
```

To remove every passkey for an account (for example when the device is lost and
no other factor is enrolled):

```sql
-- Deactivate rather than delete so the audit trail and counters remain.
UPDATE auth_passkeyCredentials SET active = false WHERE subject_id = :user_id;
DELETE FROM auth_passkeyFlows WHERE JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.context.target.revision.subjectId')) = :user_id;
UPDATE `user` SET passkey_enabled = false, auth_revision = UUID() WHERE id = :user_id;
```

The `auth_passkey_factor_*` triggers recompute `passkey_enabled` when the
credential rows change, but bump `auth_revision` explicitly so existing sessions
are rejected. This is a break-glass operation: audit it, confirm the requester's
identity, and have the user re-enrol a factor immediately. Passkeys do not
require a password, so passwordless and SSO-only accounts can enrol one; an
authenticator app still needs a password because the code is only the possession
half of that factor pair.

## Passkeys and step-up

Passkeys use the deployment origin as the WebAuthn relying party. Set `ORIGIN`
to the exact public dashboard origin (`https://mattrax.example.com`); the RP id
is its hostname and the allowed origins are `ORIGIN` plus any `TRUSTED_ORIGINS`
that share that host or a subdomain of it. A different registrable domain cannot
share the RP id and is ignored. Local development (`http://localhost:…`) is
accepted as `localhost` with WebAuthn's development flag. If `ORIGIN` is an IP
literal or a non-HTTPS host, passkeys fail closed with an unusable sentinel
profile while the rest of auth keeps working.

Consequences for operators:

- Changing `ORIGIN` (or the RP id) invalidates existing passkeys. Users must
  re-enrol; there is no way to migrate a credential to another RP id.
- The origin must serve the dashboard over HTTPS in production. Reverse proxies
  must forward the original host; the server does not trust `X-Forwarded-*` for
  RP identity.
- Sensitive actions (tenant deletion, API token changes, backup download,
  recovery-key reveal, billing portal, SSO/MFA policy changes) require a recent
  step-up. The server issues a five-minute grant bound to the session and action
  after a password, authenticator code or passkey confirmation. Clearing browser
  storage or signing out drops the grant; users simply confirm again.
- Bearer API tokens are exempt from the interactive step-up because a CLI cannot
  complete a WebAuthn or TOTP ceremony. Treat a `write` token as equivalent to a
  signed-in administrator for those actions.

## Backups

The API Worker now runs a daily application-level tenant backup after
maintenance: each tenant is exported to `backups/<organizationId>/<timestamp>.json`
in the `STORAGE` R2 bucket, bounded to four tenants at a time, and the result is
recorded in `backup_run`. Owners can see the latest status and download retained
bundles from **Tenant settings → General → Data and backups**, or run a backup
immediately there. This is a per-tenant safety net, not a database backup: it
cannot restore members, devices, audit history or SCEP certificates, and it does
not back up `AUTH_SECRET`. Keep the infrastructure backup below as the primary
recovery mechanism, and treat the following as the minimum production checklist
with restore drills at least quarterly.

### What to back up

| Deployment | Item                                  | Why it matters                                                                                                              |
| ---------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Cloud      | MySQL database                        | Tenants, members, devices, groups, policies, applications, enrollment and audit history.                                    |
| Cloud      | R2 bucket (`STORAGE`)                 | Policy and application objects. Without them uploads download as 404 even though rows still exist.                          |
| Cloud      | `AUTH_SECRET`                         | Signs sessions and seals APNs private keys and the SCEP CA key. Losing it makes all sealed keys unreadable.                 |
| Cloud      | APNs certificate/key                  | Stored in `apple_push_certificate`; the private key is sealed with `AUTH_SECRET`. Back up the database and secret together. |
| Cloud      | SCEP CA (`scep_ca` table)             | Global CA certificate and sealed private key. Losing it breaks identity renewal and new SCEP issuance.                      |
| Cloud      | `CLOUD_APPLE_VENDOR_CERT` / `..._KEY` | Deployment key material used for the one-click APNs CSR flow. Not in the database.                                          |
| Cloud      | Stripe account and webhook secret     | Billing state lives in Stripe plus `subscription`/usage rows.                                                               |
| Gateway    | `--data-dir/scep-ca.json`             | SCEP CA certificate and sealed private key.                                                                                 |
| Gateway    | `--auth-secret`/`MATTRAX_AUTH_SECRET` | Unseals the CA private key; the gateway fails closed without it.                                                            |
| Gateway    | Apple vendor certificate/key          | Needed to derive the enrollment topic and sign profiles.                                                                    |
| Gateway    | Your management backend's data        | The gateway itself only stores gateway state.                                                                               |

Never store the backup of `AUTH_SECRET` in the same bucket as the database dump:
a leaked dump plus secret is equivalent to full tenant compromise.

### Scheduled tenant backups

The daily Cron Trigger (`17 3 * * *`) runs maintenance first, then backs up every
tenant with concurrency 4. Each run writes the same versioned bundle as the
export endpoint, so it excludes APNs/SCEP private keys, token hashes, passwords,
sessions and R2 object bytes. Failures are recorded per tenant and do not stop
the rest of the sweep; the settings card warns when the latest run failed or the
last success is more than two days old.

| Variable                            | Default | Meaning                                                                   |
| ----------------------------------- | ------- | ------------------------------------------------------------------------- |
| `MAINTENANCE_BACKUP_RETENTION_DAYS` | `30`    | Delete non-pinned runs and R2 objects older than this. `0` keeps forever. |
| `MAINTENANCE_BACKUP_CONCURRENCY`    | `4`     | Tenants backed up in parallel.                                            |

Manual runs are retained by the same policy. Rows with `retention = pinned` are
never pruned (there is no API to pin yet; use SQL for a deliberate long-lived
run). Downloads go through `GET /v1/tenants/:tenantId/backups/:id/download` and
require an owner session; the R2 keys are private. Restore a downloaded bundle
through **Import tenant**, which creates a new tenant rather than overwriting an
existing one.

R2 lifecycle rules are still recommended as a backstop for objects whose row was
removed manually, and neither this job nor a lifecycle rule provides an
off-site copy. Mirror the bucket and database to a separate account if regional
loss is in your recovery objective.

### MySQL dump and restore

Use a consistent, single-transaction dump (the application writes continuously):

```bash
mysqldump \
  --host "$DATABASE_HOST" --port "${DATABASE_PORT:-3306}" \
  --user "$DATABASE_USER" --password \
  --single-transaction --quick --routines --triggers \
  --set-gtid-purged=OFF \
  "$DATABASE_NAME" | gzip > "mattraxe-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

Restore into an empty database before starting the API Worker:

```bash
gunzip -c mattraxe-YYYYMMDDTHHMMSSZ.sql.gz | \
  mysql --host "$DATABASE_HOST" --port "${DATABASE_PORT:-3306}" \
        --user "$DATABASE_USER" --password "$DATABASE_NAME"
```

Apply migrations after restore when the restored dump predates the code you are
deploying:

```bash
DATABASE_HOST=... DATABASE_PORT=3306 DATABASE_USER=... \
  DATABASE_PASSWORD=... DATABASE_NAME=... pnpm api db:migrate
```

Do not deploy code that expects a new column or table before its migration runs.

### R2 object backup

Object keys are stable and derive from tenant/policy/application ids
(`p/<tenant>/<policy>/<sha256>` and `a/<tenant>/<application>/<sha256>`), so a
normal object-store mirror is enough:

```bash
# Any S3-compatible mirror works; rclone is a common choice for R2.
rclone sync r2:mattraxe-storage ./backups/r2 --fast-list --checksum
```

Restore by copying the objects back into the same bucket and key layout. Restore
objects **before** returning the API to service: policy sync and application
downloads resolve keys from the database but read bytes from R2.

### APNs and SCEP CA caveats

- The APNs private key is sealed with `AUTH_SECRET`. Restoring the database
  without the matching secret leaves the certificate configured but the push key
  unreadable; devices fall back to check-in until it is re-uploaded.
- If the APNs certificate/key pair is lost, generate a new CSR under
  **Settings → Management** and upload Apple's signed certificate. A certificate
  rotation does not require devices to re-enroll, but keep the old certificate
  until the new one is verified.
- The SCEP CA private key is sealed with `AUTH_SECRET` in `scep_ca` (Cloud) or
  `scep-ca.json` (gateway). Never regenerate it during a restore: a new CA
  invalidates every issued device identity. Restore the database (or file) and
  the original secret together, then verify a renewal before rotating anything.
- Rotating `AUTH_SECRET` is a separate, planned operation (see below). A backup
  captured before the rotation is only readable with the pre-rotation secret.

### Restore order

1. Provision an empty MySQL database and restore the most recent dump.
2. Restore the R2 bucket (same bucket name and key prefix) or point `STORAGE` at
   the restored bucket.
3. Restore Worker secrets/config: `AUTH_SECRET`, `ORIGIN`, APNs/SCEP vendor
   material, Stripe keys and any optional Azure settings.
4. Run pending migrations against the restored database.
5. Deploy the API and web Workers.
6. Verify `/api/health` and `/api/ready`; then check a tenant's devices, policy
   download, APNs push and SCEP renewal before declaring the restore complete.
7. Re-enable schedules/cron. Maintenance is safe to run after restore but may
   expire invitations, sessions and audit rows that aged out during the outage.

### Tenant export and import limits

Owners can download a versioned JSON bundle from **Tenant settings → General →
Data and backups** (`GET /v1/tenants/:tenantId/export`) and import it as a new
tenant (`POST /v1/tenants/import`). This is for migration and selective restores,
not a replacement for the database/R2 backup above.

Included:

- Organization profile, branding and metadata.
- Member emails and roles (informational; import never creates members).
- Groups, their policy assignments and device membership metadata (keys/names,
  not devices).
- Policies and configuration payloads.
- Application metadata (name, platform, bundle/store/manifest, file name/size/
  hash, original R2 key hint).
- Enrollment settings and pre-registrations.
- SCEP-issued certificate metadata (serial, expiry, revocation; no private keys).
- Audit entries only when **Include the audit log** is selected (capped at
  10,000 recent entries).

Excluded and never exported: APNs private keys, the SCEP CA private key, API/SCIM
token hashes, user passwords/sessions/auth proofs, and R2 object bytes.

Import behaviour:

- The caller becomes the owner of a **new** tenant; existing tenants are never
  modified. Internal ids are regenerated and group/policy/application references
  are re-mapped.
- Slugs are sanitised; if the exported slug is taken, `-2`, `-3`, … is appended.
- Members, devices, audit history and SCEP certificates are **not** imported.
  Uploaded application objects are not in the bundle, so their files must be
  re-uploaded (the imported row keeps the hash/metadata).
- Bundles are capped at 8 MB and unknown versions or unknown group/policy
  references are rejected. The import is applied in one transaction.

The daily scheduled tenant backup covers ad-hoc restores of tenant configuration.
It is not a replacement for the database/R2 backup above: keep the infrastructure
backup and off-site copy for member, device, audit and certificate recovery.

### Rotating `AUTH_SECRET`

`AUTH_SECRET` seals APNs private keys and the SCEP CA private key. A rotation that only
changes the deployment secret makes both unreadable (the code fails closed; it does not
regenerate the CA). To rotate safely:

1. With the old secret configured, export the unsealed values through a trusted script
   (`openSecret` from `@mattrax/crypto`) or start a maintenance window.
2. Re-seal each value with the new secret and write it back before switching the deployment
   to the new secret.
3. Keep the old secret available until you have verified SCEP issuance and an APNs push.

There is no online re-wrap job yet; treat a rotation as a planned operation.

## Next steps

- [Quick start](./quick-start)
- [Whitelabel gateway](./whitelabel/)
- [Enterprise overview](./enterprise/overview)
