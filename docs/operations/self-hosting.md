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

## Published image

Released images live in the GitHub Container Registry, and that is what
`apps/docker/docker-compose.yml` pulls:

```bash
docker pull ghcr.io/mattrax/mattrax:latest
```

- `ghcr.io/mattrax/mattrax:<version>` is an immutable release tag. Pin it on a
  deployment that should not change until an operator upgrades it. A published
  version tag is never moved: re-running a release with different bytes fails
  instead of replacing it.
- `ghcr.io/mattrax/mattrax:latest` follows the newest stable release and only
  moves forward, so re-cutting an older version never rolls it back. Pre-release
  versions such as `1.4.0-rc.1` are published under their own tag and never move
  `latest`.

Pulling needs no registry credentials once the package is public. GHCR creates
a package private by default, so an organisation owner flips its visibility once
under the package settings after the first release. If a host cannot pull
anonymously, `docker login ghcr.io` with a token that has `read:packages`.

Images are built for `linux/amd64`; on an ARM host (an Apple Silicon machine or
an arm64 VPS) Docker runs them under emulation.

`.github/workflows/release.yml` is the only publisher. A `v*` tag, or a manual
`workflow_dispatch` that names the version, builds `apps/docker/Dockerfile`,
runs the compose smoke test against the pushed digest, and only then creates the
version tags. Pull requests never run it. Every image carries a BuildKit
provenance attestation and an SPDX SBOM:

```bash
docker buildx imagetools inspect ghcr.io/mattrax/mattrax:latest
```

### What the image contains

- The API and MDM runtime plus the dashboard SSR server, in one process on port
  `8080`. The bundles are prebuilt; nothing is compiled at boot.
- The client assets, including this documentation at `/docs/`, and
  `/sitemap.xml`/`/robots.txt` for the deployment's own origin rather than a
  hosted one.
- The Drizzle migrations, applied automatically before the first request.
- The production-only `node_modules` the host process needs for the migration
  runner and its MySQL client.

The runtime stage is based on [Distroless](https://github.com/GoogleContainerTools/distroless)
(Debian 12). It contains the Node runtime, glibc/libstdc++, CA certificates,
timezone data, the prebuilt bundles and the host process. It deliberately has
no shell, `npm` or package manager, so `docker exec <container> sh` will fail.
Use `docker logs` for diagnostics, or run a Node one-liner with
`docker exec <container> /usr/local/bin/node -e '...'`.

The process runs as the unprivileged `node` user (UID/GID 1000), and `/data` is
owned by that ID. The native `node` binary is stripped of debug symbols at build
time; JavaScript stack traces are unaffected, but native crash traces will not
contain symbol names.

### What the image does not contain

- **Secrets.** `AUTH_SECRET`, database and SMTP credentials,
  `MATTRAX_LICENSE_KEY`, Apple signing material and vendor certificates are read
  from the environment at start. None is baked into a layer, and the build
  context excludes local `.env` files.
- **State.** MySQL is external, and tenant files, app packages and backups live
  on the `/data` volume. A container started without that volume begins empty.
- **Platform.** There is no shell, package manager, TLS certificate or reverse
  proxy; TLS and device-certificate verification are the operator's job.

## Requirements

- Docker 24 or newer, on a `linux/amd64` host (or emulation).
- A MySQL 26.10 database. `apps/docker/docker-compose.yml` starts one next to the app.
- An HTTPS reverse proxy in front of the container. `ORIGIN` must be `https://`,
  because WebAuthn passkeys and email magic links require a secure origin.

## Quick start

```bash
export ORIGIN=https://mdm.example.com
export AUTH_SECRET="$(openssl rand -base64 32)"

docker compose -f apps/docker/docker-compose.yml pull
docker compose -f apps/docker/docker-compose.yml up -d
```

This installs `latest`. Pin a specific release once you have chosen one (see
[Version pinning and upgrades](#version-pinning-and-upgrades)); a network that
cannot reach GHCR can build from source instead
([Building from source](#building-from-source)).

The first start applies the database migrations and creates the `mattrax-data`
volume. Check it with `curl http://127.0.0.1:8080/api/ready` or
`docker compose -f apps/docker/docker-compose.yml ps`.

## Reverse proxy

TLS is terminated by a reverse proxy in front of port `8080`. Compose publishes
the backend on `127.0.0.1` by default, so a proxy on the same host can reach it
without exposing it to other networks. If the proxy runs on another host, set
`MATTRAX_BIND_ADDRESS` to a private host interface and restrict that interface
with a firewall; do not publish it on a public address.

The required proxy configuration is:

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
certificates and overwrites the headers as above. Also set
`TRUSTED_DEVICE_IDENTITY_PEERS` to the comma-separated numeric IPv4/IPv6
addresses of the proxy as seen by the container. For a host-side nginx example,
loopback is typical; some Docker bridge setups present the private gateway
instead, so configure the address the container actually observes. For a proxy
on another host, use its stable private address. Startup fails when
trusted-header mode is enabled without this allowlist.

The API compares the allowlist with the actual Node socket peer, not with
`X-Forwarded-For` or any caller-supplied header. It strips all incoming identity
headers and restores them only for an allowlisted peer. The verified certificate
must include a CN and a serial; an incomplete bundle is discarded rather than
allowing tenant routing by OU alone. The optional SHA-256 fingerprint remains
supported. Exposing the container without a verifying, overwriting proxy would
otherwise let a caller claim any tenant by setting the certificate OU.

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

## Version pinning and upgrades

`MATTRAX_VERSION` selects the image tag and defaults to `latest`. Pinning a
published release makes a restart predictable:

```bash
# Substitute a published release tag (without the leading v), from the GitHub
# releases page or the registry.
export MATTRAX_VERSION=<version>
docker compose -f apps/docker/docker-compose.yml pull
docker compose -f apps/docker/docker-compose.yml up -d
```

Run `pull` explicitly: `up` reuses a `latest` image that is already present, so
it would not fetch a newer stable release. Migrations are applied on start; the
migration runner records the same `__drizzle_migrations` rows as
`drizzle-kit`, so switching between the container and `pnpm db:migrate` is safe.
Migrations are forward-only, so take a database dump and a `mattrax-data`
backup before a version jump: rolling back to an older image may need that
backup rather than only re-pinning `MATTRAX_VERSION`.

### Breaking change: hosted services endpoints

`APNS_RELAY_URL` and `MATTRAX_BILLING_URL` are no longer read. Remove them,
and the old separate relay secret, from the container environment. Push and
billing always use `https://services.mattrax.app`, and a custom relay is no
longer supported. `MATTRAX_LICENSE_KEY` authenticates both the hosted relay
and billing; without a licence the relay is disabled and devices poll.

## Building from source

The compose file is pull-based by default. A checkout can build the same
Dockerfile instead by layering the build override, which adds the `build`
stanza and tags the result `mattrax-selfhost:local`:

```bash
export ORIGIN=https://mdm.example.com
export AUTH_SECRET="$(openssl rand -base64 32)"

docker compose -f apps/docker/docker-compose.yml \
  -f apps/docker/docker-compose.build.yml up -d --build
```

The override ignores `MATTRAX_VERSION`, so a local build cannot overwrite a
release tag in the local image store. This is the path for contributors,
unreleased commits and air-gapped installs that import the source rather than
pull from GHCR.

`pnpm build:image` builds just the image with zstd layers at level 3 and forces
recompression of any layer that arrived as gzip. containerd 2.x reads zstd, and
a new node unpacks zstd layers faster than gzip; Kubernetes clusters that still
run an older runtime should use a plain `docker build` instead.

The Dockerfile also prunes the deployed `node_modules` (type declarations,
source maps, readmes, changelogs, tests and examples) in the same layer as the
production install. Docker layers are additive, so cleaning in a later `RUN`
would ship the files twice. Licences are kept.

## Configuration

| Variable                        | Required   | Purpose                                                                                         |
| ------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `ORIGIN`                        | yes        | Canonical public HTTPS URL. WebAuthn relying party and link generator.                          |
| `AUTH_SECRET`                   | yes        | At least 32 bytes. Signs sessions and seals APNs, SCEP and webhook secrets.                     |
| `DATABASE_URL`                  | yes        | MySQL connection string, e.g. `mysql://user:pass@mysql:3306/mattrax`.                           |
| `TRUST_DEVICE_IDENTITY_HEADERS` | no         | Set to `1` when a TLS proxy forwards verified device certificates.                              |
| `TRUSTED_DEVICE_IDENTITY_PEERS` | with trust | Comma-separated numeric proxy addresses allowed to supply device identity.                      |
| `TRUST_PROXY_HEADERS`           | no         | Set to `1` when the proxy overwrites `X-Forwarded-For`; used for rate limits and audit IPs.     |
| `MATTRAX_BIND_ADDRESS`          | no         | Compose host bind address; defaults to `127.0.0.1`. Use a private interface for a remote proxy. |
| `PORT`                          | no         | HTTP port inside the container. Defaults to `8080`.                                             |
| `DATA_DIR`                      | no         | Object storage and runtime state. Defaults to `/data`.                                          |
| `SKIP_MIGRATIONS`               | no         | Set to `1` to manage the schema from a separate job.                                            |
| `MAIL_TRANSPORT`                | no         | `smtp`; unset disables outbound email.                                                          |
| `MAIL_FROM`                     | with mail  | Verified sender, e.g. `Mattrax <notifications@example.com>`.                                    |
| `MATTRAX_VERSION`               | no         | Compose image tag. Defaults to `latest`; set a release version to pin.                          |

Optional integrations use the same names as the hosted deployment. See
[Configuration](/operations/configuration) for the full list. Anything unset is
disabled rather than fatal: no push relay, no Entra SSO, no Android management,
no analytics, and no Stripe billing.

### Email

Self-hosted deployments send mail directly over SMTP. Set the transport, a
verified sender and the server details:

| Variable             | Purpose                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `MAIL_TRANSPORT`     | `smtp`.                                                                     |
| `MAIL_FROM`          | Sender address, e.g. `Mattrax <notifications@example.com>`.                 |
| `MAIL_SMTP_HOST`     | SMTP server hostname, e.g. `smtp.example.com`.                              |
| `MAIL_SMTP_PORT`     | Port. Defaults to 587, or 465 when `MAIL_SMTP_SECURE` is on.                |
| `MAIL_SMTP_SECURE`   | `true` connects with implicit TLS; otherwise STARTTLS is used when offered. |
| `MAIL_SMTP_USER`     | Username for AUTH PLAIN/LOGIN, when the server requires it.                 |
| `MAIL_SMTP_PASSWORD` | Password for the same account.                                              |
| `MAIL_SMTP_HELO`     | EHLO name; defaults to the runtime hostname.                                |

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

### Mattrax services and licensing

A self-hosted install owns its database, storage, email and TLS. Two optional
features use the hosted services origin at `https://services.mattrax.app`, and
they are the only calls it makes there. The origin is built into the release:
there is no endpoint to configure.

| Feature         | Configuration         | Data sent                                                                                                                                                                     |
| --------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APNs push relay | `MATTRAX_LICENSE_KEY` | Each device push: push token, push magic, topic and the tenant's APNs certificate and private key, which the relay uses to authenticate the request to Apple. It stores none. |
| Licence billing | `MATTRAX_LICENSE_KEY` | A daily count of enrolled devices and tenants, plus the licence summary, portal, checkout and invoice requests an owner starts.                                               |

The licence key is issued against the cloud billing account (see
[Operations](/admin/operations#deployment-licences)). It authenticates both the
hosted relay and billing calls, so the deployment needs no separate shared
secret. The hosted relay holds the Apple connectivity and the Stripe secret, so
the install does not need vendor APNs credentials to wake devices. The release
has no separate relay URL: a self-hosted install always wakes devices through
the hosted relay. Without a licence the relay is disabled and devices poll for
changes.

Self-hosted deployments are billed to the operator for the whole deployment,
based on enrolled devices. The install does not need its own Stripe account:

```bash
MATTRAX_LICENSE_KEY=mtx_lic_...
```

The deployment reports its enrolled device and tenant counts once a day; the
cloud keeps the Stripe subscription quantity in step. Settings → Billing shows
the licence status, Stripe Checkout, the customer portal and invoices from the
cloud. Without a licence the rest of the product keeps running; the billing page
reports that the deployment is unlicensed, and the APNs relay is disabled.

Your deployment's own product analytics is separate and opt-in: the
dashboard and API send events only when you configure `POSTHOG_KEY`. The hosted
relay also reports each relayed push to the Mattrax operator's PostHog project,
identified only by a SHA-256 hash of the deployment licence id (no tenant data,
push token, certificate or request body), so relay usage can be told apart.
See [Monitoring](/operations/monitoring) for the analytics and metrics your
deployment exposes.

## Operations

- **Upgrades.** Pull the release you want and restart, as shown in
  [Version pinning and upgrades](#version-pinning-and-upgrades). Migrations are
  applied on start. Upgrading from a pre-Node image re-homes object storage: the
  old workerd/Miniflare local bucket is not readable by the Node runtime. Export
  or restore tenant files and backups through the product before switching, or
  copy them into `/data/storage` using the same keys.
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
  volume. Owners can pin, unpin, delete and restore them from Settings → Backups; a
  restore runs in place and creates a pinned pre-restore snapshot first. See
  [Operations](/admin/operations#restoring-in-place). To move a tenant in or out of
  this deployment without re-enrolling devices, see
  [Move a deployment](/operations/cutover).
- **Scheduled work.** The Node scheduler runs the same cron expressions as the
  hosted Worker: daily maintenance and tenant backups, plus the hourly
  outbox/Entra/certificate sweep.
- **Scaling.** Run one container per database. Object storage is the local
  filesystem volume, not a shared service.

## Limitations

- R2 is local to the `/data` volume; it is not replicated off the host.
- Only `linux/amd64` images are published. An arm64 build is not available yet;
  ARM hosts run the amd64 image under emulation.
- Cloudflare-specific secrets (vendor APNs relay, managed Android Pub/Sub) still
  point at the hosted services if configured, and are otherwise disabled.
- The hosted APNs relay reports each push to the Mattrax operator's PostHog
  project when that project is configured, with a hash of the deployment licence
  id. It is not a per-deployment analytics feed, and it is not enabled by your
  deployment's `POSTHOG_KEY`.
