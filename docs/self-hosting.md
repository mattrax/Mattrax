# Self-hosting

There are two different self-hosting stories in this repository. Pick the one that
matches what you are trying to run.

| You want to run…                                         | Deploy                                     | Data                                       |
| -------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| The full Enterprise product with dashboard, API and billing | **Cloud on Cloudflare** (`apps/api`, `apps/web`) | MySQL, R2, Cloudflare Email, Stripe        |
| Your own product on top of Mattrax's Apple MDM gateway   | **Whitelabel gateway** (`apps/mttx`)       | Your management backend; SCEP CA on disk   |

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

| Secret                           | Required | Purpose                                                          |
| -------------------------------- | -------- | ---------------------------------------------------------------- |
| `ORIGIN`                         | Yes      | Canonical public origin used in enrollment profiles and emails.  |
| `AUTH_SECRET`                    | Yes      | Signs sessions and seals APNs private keys. Back this up.        |
| `AUTH_RESET_URL`                 | No       | Public URL used in password-reset emails. Defaults to `ORIGIN`.  |
| `TRUSTED_ORIGINS`                | No       | Extra comma-separated browser origins for split-origin setups.   |
| `STRIPE_SECRET_KEY`              | Yes      | Stripe API key.                                                  |
| `STRIPE_WEBHOOK_SECRET`          | Yes      | Stripe webhook verification secret.                              |
| `STRIPE_DEVICE_MONTHLY_PRICE_ID` | Yes      | Stripe price used for per-device billing.                        |
| `CLOUD_APPLE_VENDOR_CERT`        | No       | Apple MDM vendor certificate used to sign APNs CSRs.             |
| `CLOUD_APPLE_VENDOR_KEY`         | No       | Vendor private key paired with the certificate.                  |

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

| Flag                  | Required | Default                 | Purpose                                                        |
| --------------------- | -------- | ----------------------- | -------------------------------------------------------------- |
| `--port`              | No       | `3000`                  | HTTP listen port.                                              |
| `--origin`            | No       | `http://localhost:3000` | Public origin embedded in enrollment and asset URLs.           |
| `--webhook-url`       | Yes      | —                       | Base URL of your management backend.                           |
| `--data-dir`          | No       | `./.data` / `/opt/mattrax` | Filesystem state (SCEP CA). Bundled builds default to `/opt/mattrax`. |
| `--apple-vendor-cert` | No       | —                       | PEM used to derive the Apple MDM topic for enrollment profiles. |

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

| Port | Process                                          |
| ---- | ------------------------------------------------ |
| 443  | Public HTTPS (proxy or Cloudflare).              |
| 3000 | `mttx serve` default listen port.                |
| 9050 | Cloud dashboard and API during local `pnpm web dev`. |
| 9051 | Example whitelabel Worker during local dev.      |
| 3306 | MySQL for Cloud.                                 |

The gateway does not use the old multi-port layout (9051/9052/9054). It is a single HTTP
listener that serves Apple MDM, SCEP, assets and health.

## APNs and push

Apple MDM push is per tenant and uses the tenant's APNs client certificate.

| Deployment                       | Transport                                                         |
| -------------------------------- | ----------------------------------------------------------------- |
| Self-hosted Node / single tenant | `NodePushTransport` — direct delivery with the tenant certificate.  |
| Single-tenant Worker whitelabel  | `MtlsPushTransport` — a per-certificate Workers mTLS binding.    |
| Hosted multi-tenant Cloud        | `RelayPushTransport` — HMAC-signed requests to a push relay.      |

A Cloud Worker cannot select a different client certificate per tenant request, so hosted
Cloud uses a relay. Set `APNS_RELAY_URL` and `APNS_RELAY_SECRET` on the API Worker to
enable it; without them the transport reports unavailable and Apple devices fall back to
polling at check-in. The gateway itself never pushes; your whitelabel management backend
owns push delivery.

When wiring the relay, treat the relay secret as production key material:

```text
signature = hex(HMAC-SHA256(secret, "<unix-timestamp>.<json-body>"))
headers: x-apns-timestamp, x-apns-signature
```

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

| Deployment | Back up                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| Cloud      | MySQL (tenants, devices, policies, declarations), R2 bucket (policy assets and other objects), Worker secrets. |
| Cloud      | `AUTH_SECRET`. Losing it invalidates sessions and makes stored APNs private keys undecryptable.                 |
| Gateway    | `--data-dir/scep-ca.json` (SCEP CA certificate and private key). Losing it breaks continuity for existing enrolments. |
| Gateway    | The Apple vendor certificate/key if you supplied one, and your management backend's own data.                   |

Restore the database and R2 objects before bringing the API Worker back. For the gateway,
restore `scep-ca.json` with restrictive permissions before restarting.

## Next steps

- [Quick start](./quick-start)
- [Whitelabel gateway](./whitelabel/)
- [Enterprise overview](./enterprise/overview)
