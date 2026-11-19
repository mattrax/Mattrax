# Self-hosting

Mattrax ships as one Node container. It runs the same two entry points as the
hosted deployment — the dashboard (Solid SSR) and the API/MDM runtime — in one
process. `/api`, `/mdm` and `/scim` go to the API; every other request goes to
the dashboard, which serves the built client assets and renders pages.

The Node entry uses Effect for the shared application runtime: the same routes,
auth, MDM handlers and scheduled jobs as the Cloudflare Worker. Platform
bindings become Node adapters: MySQL over `mysql2` (no Hyperdrive), object
storage on the `/data` volume (no R2), and SMTP for email (no Cloudflare Email
binding). The process owns the cron clock that Cloudflare normally provides.

Nothing is bundled or transpiled at boot. The image contains the prebuilt API
and dashboard bundles, and database migrations run automatically before the
first request is served.

## Container image

The runtime stage is based on [Distroless](https://github.com/GoogleContainerTools/distroless)
(Debian 12). It contains the Node runtime, glibc/libstdc++, CA certificates,
timezone data, the prebuilt API/dashboard bundles and the host process. It deliberately has
no shell, `npm` or package manager, so `docker exec <container> sh` will fail.
Use `docker logs` for diagnostics, or run a Node one-liner with
`docker exec <container> /usr/local/bin/node -e '...'`.

The process runs as the unprivileged `node` user (UID/GID 1000), and `/data` is
owned by that ID. The native `node` binary is stripped of debug symbols at build time;
JavaScript stack traces are unaffected, but native crash traces will not contain
symbol names.

The image also contains the built documentation, served at `/docs/` on the same
origin, and `/sitemap.xml`/`/robots.txt` advertise that origin rather than a
hosted one.

## Building a lean image

`pnpm build:image` builds the local image with zstd layers at level 3 and forces
recompression of any layer that arrived as gzip. containerd 2.x reads zstd, and
a new node unpacks zstd layers faster than gzip; Kubernetes clusters that still
run an older runtime should use a plain `docker build` instead.

The Dockerfile also prunes the deployed `node_modules` (type declarations,
source maps, readmes, changelogs, tests and examples) in the same layer as the
production install. Docker layers are additive, so cleaning in a later `RUN`
would ship the files twice. Licences are kept.

## Requirements

- Docker 24 or newer.
- A MySQL 26.10 database. `docker-compose.selfhost.yml` starts one next to the app.
- An HTTPS reverse proxy in front of the container. `ORIGIN` must be `https://`,
  because WebAuthn passkeys and email magic links require a secure origin.

## Quick start

```bash
export ORIGIN=https://mdm.example.com
export AUTH_SECRET="$(openssl rand -base64 32)"

docker compose -f docker-compose.selfhost.yml up -d --build
```

Then put your reverse proxy in front of port `8080`:

```nginx
server {
  listen 443 ssl;
  server_name mdm.example.com;

  # Apple, Windows and Android clients talk to /mdm/* on the same host.
  client_max_body_size 64m;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    # Overwrite rather than append: a caller-supplied chain would let the
    # client choose its own rate-limit key.
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Cf-Connecting-Ip "";
    proxy_set_header X-Forwarded-Proto https;

    # Required for Apple MDM certificate authentication. Strip anything the
    # client sent, then forward only what nginx verified.
    proxy_set_header x-device-identity-certificate "";
    proxy_set_header x-device-identity-certificate-serial "";
    proxy_set_header x-device-identity-certificate-sha256 "";
    proxy_set_header x-device-identity-certificate $ssl_client_s_dn;
    proxy_set_header x-device-identity-certificate-serial $ssl_client_serial;

    ssl_client_certificate /path/to/apple-device-ca.pem;
    ssl_verify_client optional;
  }
}
```

Set `TRUST_DEVICE_IDENTITY_HEADERS=1` **only** when the proxy verifies device
certificates and overwrites the headers as above. Exposing the container without
that proxy would let a caller claim any tenant by setting the certificate OU.

Apple signs MDM check-ins with the SCEP identity certificate and sends its subject
distinguished name in the TLS handshake. The tenant is the `OU` in that subject, so
forwarding `$ssl_client_s_dn` is what routes a device to its tenant. If your proxy
can also compute the certificate's SHA-256 fingerprint, send it as
`x-device-identity-certificate-sha256`; otherwise identity binding falls back to
the serial number.

The container serves plain HTTP because TLS is the proxy's job. Set
`TRUSTED_ORIGINS` when the dashboard and API are served from different origins.
Set `TRUST_PROXY_HEADERS=1` when the proxy overwrites `X-Forwarded-For` as shown:
rate limits then key on the client address, and the device/MDM audit events store
the same verified address. Without the opt-in neither trusts a forwarded header,
so the audit `ip` column stays null rather than recording a caller-chosen value.

## Configuration

| Variable                        | Required  | Purpose                                                                       |
| ------------------------------- | --------- | ----------------------------------------------------------------------------- |
| `ORIGIN`                        | yes       | Canonical public HTTPS URL. WebAuthn relying party and link generator.        |
| `AUTH_SECRET`                   | yes       | At least 32 bytes. Signs sessions and seals APNs, SCEP and webhook secrets.   |
| `DATABASE_URL`                  | yes       | MySQL connection string, e.g. `mysql://user:pass@mysql:3306/mattrax`.         |
| `TRUST_DEVICE_IDENTITY_HEADERS` | no        | Set to `1` when a TLS proxy forwards verified device certificates.            |
| `TRUST_PROXY_HEADERS`           | no        | Set to `1` when the proxy overwrites `X-Forwarded-For`; used for rate limits and audit IPs. |
| `PORT`                          | no        | HTTP port inside the container. Defaults to `8080`.                           |
| `DATA_DIR`                      | no        | Object storage and runtime state. Defaults to `/data`.                        |
| `SKIP_MIGRATIONS`               | no        | Set to `1` to manage the schema from a separate job.                          |
| `MAIL_TRANSPORT`                | no        | `smtp`; unset disables outbound email.                                        |
| `MAIL_FROM`                     | with mail | Verified sender, e.g. `Mattrax <notifications@example.com>`.                  |

Optional integrations use the same names as the hosted deployment. See
[Configuration](/operations/configuration) for the full list. Anything unset is
disabled rather than fatal: no push relay, no Entra SSO, no Android management,
no analytics, and no Stripe billing.

### Email

Self-hosted deployments send mail directly over SMTP. Set the transport, a
verified sender and the server details:

| Variable              | Purpose                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| `MAIL_TRANSPORT`      | `smtp`.                                                                     |
| `MAIL_FROM`           | Sender address, e.g. `Mattrax <notifications@example.com>`.                 |
| `MAIL_SMTP_HOST`      | SMTP server hostname, e.g. `smtp.example.com`.                              |
| `MAIL_SMTP_PORT`      | Port. Defaults to 587, or 465 when `MAIL_SMTP_SECURE` is on.                |
| `MAIL_SMTP_SECURE`    | `true` connects with implicit TLS; otherwise STARTTLS is used when offered. |
| `MAIL_SMTP_USER`      | Username for AUTH PLAIN/LOGIN, when the server requires it.                 |
| `MAIL_SMTP_PASSWORD`  | Password for the same account.                                              |
| `MAIL_SMTP_HELO`      | EHLO name; defaults to the runtime hostname.                                |
| `MATTRAX_BILLING_URL` | Cloud billing origin. Defaults to `https://e.mattrax.app`.                  |
| `MATTRAX_LICENSE_KEY` | Deployment licence key issued by the Mattrax operator.                      |

```bash
MAIL_TRANSPORT=smtp
MAIL_FROM="Mattrax <notifications@example.com>"
MAIL_SMTP_HOST=smtp.example.com
MAIL_SMTP_PORT=587
MAIL_SMTP_USER=notifications@example.com
MAIL_SMTP_PASSWORD=...
```

The sender domain must be authorised by the SMTP server (SPF/DKIM/DMARC at the
provider). Use a monitored mailbox, not `no-reply@`: invitation and verification
replies should reach a person. The container talks to the SMTP server directly,
so there is no sidecar to run and no relay secret to manage.

### Licensing

Self-hosted deployments are licensed by the Mattrax operator and billed to the
operator for the whole deployment, based on enrolled devices. The install does
not need its own Stripe account:

```bash
MATTRAX_BILLING_URL=https://e.mattrax.app
MATTRAX_LICENSE_KEY=mtx_lic_...
```

The licence key is issued against the cloud billing account (see
[Operations](/admin/operations#deployment-licences)). The deployment reports its
enrolled device and tenant counts once a day; the cloud keeps the Stripe
subscription quantity in step. Settings → Billing shows the licence status,
Stripe Checkout, the customer portal and invoices from the cloud. Without a
licence the rest of the product keeps running; the billing page reports that the
deployment is unlicensed.

Without a transport the container declares `MATTRAX_EMAIL_DISABLED=1`: readiness
reports `mailer: skipped` (degraded), verification requests fail with "This
deployment cannot send email", and invitations return their one-time link for the
administrator to copy. Nothing is written to the container log.

`DEV_MAILBOX` exposes messages over `GET /api/debug/emails` instead of sending
them. It only switches on for a loopback `ORIGIN`. To use it on a public host,
set `DEV_MAILBOX=true`, `DEV_MAILBOX_ALLOW_REMOTE=true` and a non-empty
`DEV_MAILBOX_SECRET`, then send that value in `x-dev-mailbox-secret`.

## Operations

- **Upgrades.** Rebuild the image and restart. Migrations are applied on start;
  the migration runner records the same `__drizzle_migrations` rows as
  `drizzle-kit`, so switching between the container and `pnpm db:migrate` is safe.
  Upgrading from a pre-Node image re-homes object storage: the old workerd/Miniflare
  local bucket is not readable by the Node runtime. Export or restore tenant files
  and backups through the product before switching, or copy them into
  `/data/storage` using the same keys.
- **MySQL 26.10.** The bundled compose file now runs MySQL 26.10. A 26.10 server
  refuses to start on an 8.4 data directory (`Invalid MySQL server upgrade`), so
  an existing stack must dump and restore rather than swap the image under the
  `mattrax-mysql` volume: dump from the old container with
  `mysqldump --databases mattrax`, start 26.10 with an empty volume, and load the
  dump before starting the app. A development stack can simply recreate the volume.
- **Backups.** Back up MySQL and the `mattrax-data` volume. The volume holds
  tenant file uploads, configuration profiles, app packages and backups created
  by the scheduled job.
- **Health.** `GET /api/health` is a liveness check. `GET /api/ready` checks the database,
  writes/reads/deletes a probe object on the `/data` volume, and verifies the mailer is
  configured. It returns 503 when the database, the `/data` volume or a configured mailer
  is unusable. With no mail transport (or `MATTRAX_EMAIL_DISABLED=1`) `checks.mailer` is
  `skipped` and the overall status is `degraded` (HTTP 200) rather than unhealthy.
- **Backups and restore.** The daily job writes tenant bundles into the `mattrax-data`
  volume. Owners can pin, unpin, delete and restore them from Settings → General; a
  restore runs in place and creates a pinned pre-restore snapshot first. See
  [Operations](/admin/operations#restoring-in-place).
- **Scheduled work.** The Node scheduler runs the same cron expressions as the
  hosted Worker: daily maintenance and tenant backups, plus the hourly
  outbox/Entra/certificate sweep.
- **Scaling.** Run one container per database. Object storage is the local
  filesystem volume, not a shared service.

## Limitations

- R2 is local to the `/data` volume; it is not replicated off the host.
- Cloudflare-specific secrets (vendor APNs relay, managed Android Pub/Sub) still
  point at the hosted services if configured, and are otherwise disabled.
