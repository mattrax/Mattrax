# Self-hosting

Mattrax ships as one container. It runs the same two Workers as the hosted
deployment — the dashboard (`mattrax`) and the API/MDM Worker (`mattrax-api`) —
inside [workerd](https://github.com/cloudflare/workerd), the runtime Cloudflare
uses in production. Miniflare supplies the platform services the container has
no managed equivalent for: R2 object storage (backed by the `/data` volume),
Hyperdrive (a local MySQL connection) and static asset routing. The container
provides the cron clock that Cloudflare normally provides.

Nothing is bundled or transpiled at boot. The image contains the prebuilt
Worker bundles, and database migrations run automatically before the first
request is served.

workerd is started through Miniflare rather than as a `workerd compile` binary.
A self-contained binary embeds the config and modules, but it cannot provide the
platform services this application relies on (R2 bindings, Hyperdrive, static
asset routing, service bindings). It is also no faster in practice: a compiled
API-only binary reached the first response in ~0.55s, while Miniflare serving
both Workers and the database readiness check stays under 0.3s.

## Container image

The runtime stage is based on [Distroless](https://github.com/GoogleContainerTools/distroless)
(Debian 12). It contains the Node runtime, glibc/libstdc++, CA certificates,
timezone data, the prebuilt Workers and the host process. It deliberately has
no shell, `npm` or package manager, so `docker exec <container> sh` will fail.
Use `docker logs` for diagnostics, or run a Node one-liner with
`docker exec <container> /usr/local/bin/node -e '...'`.

The process runs as the unprivileged `node` user (UID/GID 1000), and `/data` is
owned by that ID. The native `node` and `workerd` binaries are stripped of debug
symbols at build time; JavaScript stack traces are unaffected, but native crash
traces will not contain symbol names.

The image also contains the built documentation, served at `/docs/` on the same
origin, and `/sitemap.xml`/`/robots.txt` advertise that origin rather than a
hosted one.

## Requirements

- Docker 24 or newer.
- A MySQL 8.4 database. `docker-compose.selfhost.yml` starts one next to the app.
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
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
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

## Configuration

| Variable                        | Required  | Purpose                                                                     |
| ------------------------------- | --------- | --------------------------------------------------------------------------- |
| `ORIGIN`                        | yes       | Canonical public HTTPS URL. WebAuthn relying party and link generator.      |
| `AUTH_SECRET`                   | yes       | At least 32 bytes. Signs sessions and seals APNs, SCEP and webhook secrets. |
| `DATABASE_URL`                  | yes       | MySQL connection string, e.g. `mysql://user:pass@mysql:3306/mattrax`.       |
| `TRUST_DEVICE_IDENTITY_HEADERS` | no        | Set to `1` when a TLS proxy forwards verified device certificates.          |
| `PORT`                          | no        | HTTP port inside the container. Defaults to `8080`.                         |
| `DATA_DIR`                      | no        | Object storage and runtime state. Defaults to `/data`.                      |
| `R2_BUCKET`                     | no        | Local bucket name. Defaults to `mattrax`.                                   |
| `SKIP_MIGRATIONS`               | no        | Set to `1` to manage the schema from a separate job.                        |
| `LOG_LEVEL`                     | no        | Miniflare log level: `debug`, `info`, `warn`, `error`, `none`.              |
| `MAIL_TRANSPORT`                | no        | `smtp`; unset disables outbound email.                                      |
| `MAIL_FROM`                     | with mail | Verified sender, e.g. `Mattrax <notifications@example.com>`.                |

Optional integrations use the same names as the hosted deployment. See
[Configuration](/operations/configuration) for the full list. Anything unset is
disabled rather than fatal: no push relay, no Entra SSO, no Android management,
no analytics, and no Stripe billing.

### Email

Self-hosted deployments send mail directly over SMTP. Set the transport, a
verified sender and the server details:

| Variable             | Purpose                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `MAIL_TRANSPORT`     | `smtp`.                                                                  |
| `MAIL_FROM`          | Sender address, e.g. `Mattrax <notifications@example.com>`.              |
| `MAIL_SMTP_HOST`     | SMTP server hostname, e.g. `smtp.example.com`.                           |
| `MAIL_SMTP_PORT`     | Port. Defaults to 587, or 465 when `MAIL_SMTP_SECURE` is on.             |
| `MAIL_SMTP_SECURE`   | `true` connects with implicit TLS; otherwise STARTTLS is used when offered. |
| `MAIL_SMTP_USER`     | Username for AUTH PLAIN/LOGIN, when the server requires it.              |
| `MAIL_SMTP_PASSWORD` | Password for the same account.                                           |
| `MAIL_SMTP_HELO`     | EHLO name; defaults to the runtime hostname.                             |

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
- **Backups.** Back up MySQL and the `mattrax-data` volume. The volume holds
  tenant file uploads, configuration profiles, app packages and backups created
  by the scheduled job.
- **Health.** `GET /api/health` is a liveness check. `GET /api/ready` checks the database,
  writes/reads/deletes a probe object in the local bucket, and verifies the mailer is
  configured. It returns 503 when the database, the `/data` volume or a configured mailer
  is unusable. With no mail transport (or `MATTRAX_EMAIL_DISABLED=1`) `checks.mailer` is
  `skipped` and the overall status is `degraded` (HTTP 200) rather than unhealthy.
- **Backups and restore.** The daily job writes tenant bundles into the `mattrax-data`
  volume. Owners can pin, unpin, delete and restore them from Settings → General; a
  restore runs in place and creates a pinned pre-restore snapshot first. See
  [Operations](/admin/operations#restoring-in-place).
- **Scheduled work.** The API Worker's cron triggers run inside the container:
  daily maintenance and tenant backups, plus the hourly Entra directory sweep.
- **Scaling.** Run one container per database. Object storage is the local
  filesystem volume, not a shared service.

## Limitations

- R2 is local to the `/data` volume; it is not replicated off the host.
- Cloudflare-specific secrets (vendor APNs relay, managed Android Pub/Sub) still
  point at the hosted services if configured, and are otherwise disabled.
