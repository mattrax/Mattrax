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

| Secret                           | Required | Purpose                                                         |
| -------------------------------- | -------- | --------------------------------------------------------------- |
| `ORIGIN`                         | Yes      | Canonical public origin used in enrollment profiles and emails. |
| `AUTH_SECRET`                    | Yes      | Signs sessions, seals APNs and SCEP CA keys. Back this up.      |
| `AUTH_RESET_URL`                 | No       | Public URL used in password-reset emails. Defaults to `ORIGIN`. |
| `TRUSTED_ORIGINS`                | No       | Extra comma-separated browser origins for split-origin setups.  |
| `STRIPE_SECRET_KEY`              | Yes      | Stripe API key.                                                 |
| `STRIPE_WEBHOOK_SECRET`          | Yes      | Stripe webhook verification secret.                             |
| `STRIPE_DEVICE_MONTHLY_PRICE_ID` | Yes      | Stripe price used for per-device billing.                       |
| `CLOUD_APPLE_VENDOR_CERT`        | No       | Apple MDM vendor certificate used to sign APNs CSRs.            |
| `CLOUD_APPLE_VENDOR_KEY`         | No       | Vendor private key paired with the certificate.                 |
| `AZURE_CLIENT_ID`                | No       | Entra ID app client ID for tenant SSO.                          |
| `AZURE_CLIENT_SECRET`            | No       | Entra ID app client secret for tenant SSO.                      |

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

### Microsoft Entra ID single sign-on

Create a Microsoft Entra ID app registration with a web redirect URI of
`<ORIGIN>/api/v1/sso/azure/callback`. Set `AZURE_CLIENT_ID` and
`AZURE_CLIENT_SECRET` on the API Worker. Each tenant then enters its Entra
tenant ID under **Settings → Identity**, enables SSO, and can test the flow
there or from the login page's work-email SSO form.

SCIM provisioning uses the same identity provider independently. Users can be
auto-provisioned on first SSO sign-in; disable **Create members on first
sign-in** if membership must come from invitations only.

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
- **Scheduled maintenance.** `apps/api/cloudflare.config.ts` registers a daily cron
  (`17 3 * * *`). It expires invitations, marks devices stale after 30 days without a
  check-in, removes expired auth proofs/sessions and applies 365-day audit retention.
  Override with `MAINTENANCE_STALE_DEVICE_DAYS` and
  `MAINTENANCE_AUDIT_RETENTION_DAYS` (set the latter to `0` to keep audit entries
  indefinitely). The same `runMaintenance` function is exported from
  `@mattrax/enterprise-backend` for external schedulers.
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

## Backups

Nothing in this repository schedules backups today. Treat the following as the
minimum production checklist and wire it into your platform's scheduler, with
restore drills at least quarterly.

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

There is no scheduled export or automatic off-site backup yet. Add both if
export/import is part of your recovery objective rather than an ad-hoc migration
tool.

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
