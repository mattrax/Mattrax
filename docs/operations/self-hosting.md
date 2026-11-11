# Self-hosting Cloud

Mattrax Cloud is two Cloudflare Workers plus MySQL, R2 and Email Sending. This guide
deploys the full Enterprise product. If you want the protocol gateway for your own
product, use [Whitelabel](/operations/whitelabel/) instead.

## Prerequisites

- Node.js `>=22.12.0` and pnpm `10.33.2`.
- A Cloudflare account with Workers, Hyperdrive, R2 and Email Sending.
- MySQL 8.0+ reachable from Hyperdrive.
- A domain with trusted TLS.
- Optional: Stripe for billing, Entra for SSO/Autopilot, Google Cloud for Android.

## 1. Install and create the database

```bash
pnpm install

docker run -d \
  --name mattraxe-mysql \
  -e MYSQL_ROOT_PASSWORD=change-me \
  -e MYSQL_DATABASE=mattraxe \
  -e MYSQL_USER=mattrax \
  -e MYSQL_PASSWORD=mattrax \
  -p 3306:3306 \
  mysql:8.0
```

For production use a managed MySQL with TLS. Point Hyperdrive at it.

## 2. Configure Cloudflare bindings

`apps/api/cloudflare.config.ts` declares:

- Worker name `mattrax-api`.
- Hyperdrive binding `HYPERDRIVE` (replace the fixed id with your own configuration).
- R2 bucket `STORAGE` (`mattrax` by default).
- Email binding `EMAIL` with the allowed sender.
- Cron triggers: `17 3 * * *` (daily maintenance, backups, Entra sync) and
  `47 * * * *` (hourly Entra sync sweep).

`apps/web/cloudflare.config.ts` declares the public Worker `mattrax`, its custom domain
(`e.mattrax.app` by default) and the service binding `API` to `mattrax-api`.

Change the domain and bucket names before deploying.

## 3. Set secrets

`ORIGIN` must be the public dashboard origin. `AUTH_SECRET` signs sessions and seals APNs,
SCEP and device secrets.

```bash
cf auth login

cf workers secrets update ORIGIN \
  --worker mattrax-api --type secret_text --text 'https://mdm.example.com'

cf workers secrets update AUTH_SECRET \
  --worker mattrax-api --type secret_text --text "$(openssl rand -base64 32)"
```

Repeat for the secrets you use:

| Secret                                    | Required | Purpose                                |
| ----------------------------------------- | -------- | -------------------------------------- |
| `ORIGIN`                                  | Yes      | Public origin and WebAuthn RP          |
| `AUTH_SECRET`                             | Yes      | Sessions, sealed keys, webhook secrets |
| `AUTH_RESET_URL`                          | No       | HTTPS password-reset landing page      |
| `TRUSTED_ORIGINS`                         | No       | Extra same-site origins                |
| `STRIPE_SECRET_KEY`                       | No       | Stripe API                             |
| `STRIPE_WEBHOOK_SECRET`                   | No       | Stripe signature verification          |
| `STRIPE_DEVICE_MONTHLY_PRICE_ID`          | No       | Per-device price                       |
| `MATTRAX_PLAN_LIMITS`                     | No       | JSON plan catalogue                    |
| `CLOUD_APPLE_VENDOR_CERT` / `_KEY`        | No       | Vendor-signed APNs CSRs                |
| `APNS_RELAY_URL` / `APNS_RELAY_SECRET`    | No       | Multi-tenant APNs relay                |
| `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | No       | Entra SSO, Graph, Autopilot            |
| `WINDOWS_FEDERATED_AUDIENCE`              | No       | Federated Entra WSTEP audience         |
| `ANDROID_MANAGEMENT_*`                    | No       | Android Enterprise                     |
| `SENTRY_DSN`                              | No       | Error tracking                         |

The full table is in [Configuration](/operations/configuration).

## 4. Apply migrations

Drizzle Kit reads individual connection variables, not a URL.

```bash
DATABASE_HOST=your-mysql-host \
DATABASE_PORT=3306 \
DATABASE_USER=mattrax \
DATABASE_PASSWORD=change-me \
DATABASE_NAME=mattraxe \
pnpm api db:migrate
```

Migrations are not applied during deploy. Apply them before deploying code that needs
them.

## 5. Deploy

```bash
pnpm api deploy:prod
pnpm web deploy:prod
# or both, in order
pnpm deploy:prod:all
```

`pnpm web deploy:prod` builds the docs and copies `doc_build` into the asset bundle.

Verify:

```bash
curl https://mdm.example.com/api/health
curl https://mdm.example.com/api/ready
```

`/api/health` is dependency-free liveness. `/api/ready` runs `select 1` with a two-second
timeout and returns 503 when the database is unavailable.

## 6. Create the first administrator

Open `https://mdm.example.com/register`, create an account and create a tenant. The creator
becomes the tenant `owner`. Invite other administrators from **Settings →
Administrators**.

## 7. Configure Apple push

Open **Settings → Management → Apple push**, download the CSR, sign it at Apple and upload
the `.pem`. The private key stays on the server and is sealed with `AUTH_SECRET`.

## 8. Optional integrations

- **Entra SSO / Autopilot** — [Entra ID](/platforms/windows/entra-id).
- **Android Enterprise** — [Android](/platforms/android/).
- **Stripe billing** — [Audit, webhooks and billing](/admin/operations).
- **APNs relay** — [Configuration](/operations/configuration).

## Scheduled maintenance

The daily cron:

1. Expires invitations.
2. Marks devices stale after `MAINTENANCE_STALE_DEVICE_DAYS` (default 30).
3. Removes expired auth proofs and sessions.
4. Applies audit retention (`MAINTENANCE_AUDIT_RETENTION_DAYS`, default 365, `0` keeps).
5. Backs up every tenant (`MAINTENANCE_BACKUP_RETENTION_DAYS`, default 30).
6. Runs due Entra directory syncs.

The hourly cron sweeps due Entra syncs. Both are safe to run with an external scheduler;
the same functions are exported from `@mattrax/enterprise-backend`.

## Security defaults

The dashboard Worker sets:

- `Content-Security-Policy` with `frame-ancestors 'none'`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- HSTS on HTTPS responses

Preview URLs are disabled in production.

## Ports

| Port | Process                    |
| ---- | -------------------------- |
| 443  | Public HTTPS               |
| 3000 | Whitelabel gateway default |
| 9050 | Local dashboard and API    |
| 9051 | Example whitelabel Worker  |
| 3306 | MySQL                      |

## Next

- [Configuration](/operations/configuration)
- [Monitoring](/operations/monitoring)
- [Upgrades and backups](/operations/troubleshooting)
- [Whitelabel gateway](/operations/whitelabel/)
