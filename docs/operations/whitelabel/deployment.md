# Gateway deployment

The gateway is the `mttx` CLI in `apps/mttx`. It listens on one HTTP port and serves Apple
MDM, SCEP, Windows MDM, assets and health.

## Run from source

```bash
pnpm mserver dev serve \
  --port 3000 \
  --origin https://mdm.example.com \
  --webhook-url https://api.example.com \
  --webhook-secret "$MATTRAX_WEBHOOK_SECRET" \
  --auth-secret "$MATTRAX_AUTH_SECRET" \
  --data-dir ./data \
  --apple-vendor-cert ./certs/apple-vendor.pem
```

## Flags

| Flag                  | Env                      | Default                            | Purpose                                       |
| --------------------- | ------------------------ | ---------------------------------- | --------------------------------------------- |
| `--port`              | `PORT`                   | `3000`                             | HTTP listen port                              |
| `--origin`            | `MATTRAX_ORIGIN`         | `http://localhost:3000`            | Public origin in profiles and URLs            |
| `--webhook-url`       | —                        | required                           | Management backend base URL                   |
| `--webhook-secret`    | `MATTRAX_WEBHOOK_SECRET` | empty                              | HMAC secret; backend fails closed without it  |
| `--auth-secret`       | `MATTRAX_AUTH_SECRET`    | empty                              | SCEP challenge signing and CA sealing         |
| `--data-dir`          | —                        | `./.data` (`/opt/mattrax` bundled) | SCEP CA storage                               |
| `--apple-vendor-cert` | —                        | —                                  | Apple vendor certificate for topic extraction |
| `--brand-name`        | `MATTRAX_BRAND_NAME`     | `Mattrax`                          | Organization name                             |
| `--brand-logo-url`    | `MATTRAX_BRAND_LOGO_URL` | empty                              | Logo for branding JSON                        |
| `--support-email`     | `MATTRAX_SUPPORT_EMAIL`  | `hello@mattrax.app`                | Support address                               |
| `--brand-color`       | `MATTRAX_BRAND_COLOR`    | `#1c1917`                          | Brand colour                                  |
| `--product-key`       | `MATTRAX_PRODUCT_KEY`    | empty                              | Platform licence key                          |
| `--platform-url`      | `MATTRAX_PLATFORM_URL`   | empty                              | Platform API base                             |
| `--rate-limit`        | `MATTRAX_RATE_LIMIT`     | `5`                                | Requests/sec per process; `0` disables        |

:::warning Rate limit
The default limiter is about five requests per second per process. A fleet of hundreds of
devices checking in at once needs a higher `--rate-limit` or multiple instances behind a
proxy with a shared limiter.
:::

## Build a standalone binary

```bash
pnpm mserver build
```

This writes:

- `apps/mttx/dist/server.cjs` — bundled CJS for Node 22.
- `apps/mttx/dist/mttx` — a Node single executable application, ad-hoc signed on macOS.

The bundled build defaults `--data-dir` to `/opt/mattrax`.

## systemd

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
  --webhook-secret ${MATTRAX_WEBHOOK_SECRET} \
  --auth-secret ${MATTRAX_AUTH_SECRET} \
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

Use `EnvironmentFile=` for secrets rather than literals in the unit file.

## Docker

There is no published image. Build the server, then package `server.cjs`:

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
  -e MATTRAX_WEBHOOK_SECRET \
  -e MATTRAX_AUTH_SECRET \
  mattrax-gateway
```

Terminate TLS at a reverse proxy or load balancer and forward to port 3000.

## Health and OpenAPI

```bash
curl https://mdm.example.com/health
# {"status":"ok"}

curl https://mdm.example.com/api/openapi.json
```

There is no Scalar UI on the gateway. Import the OpenAPI document into your own tooling.

## Platform API

A gateway can verify its licence with a product key and request APNs CSR signing from the
Mattrax Platform API.

### Verify an instance

```http
POST /api/platform/instances/verify
x-mattrax-key: mtxinst_...
x-mattrax-timestamp: 1760000000
x-mattrax-signature: <hex hmac>
content-type: application/json

{"userCount": 0, "deviceCount": 0}
```

Message:

```text
<timestamp>.<userCount>:<deviceCount>
signature = hex(HMAC-SHA256(productKey, message))
```

The gateway verifies on startup and every 45 minutes. An invalid or revoked key exits the
process.

### Sign an APNs CSR

```http
POST /api/platform/instances/apns/sign
x-mattrax-key: mtxinst_...
x-mattrax-timestamp: 1760000000
x-mattrax-signature: <hex hmac>
content-type: application/json

{"csrDer": "<base64 DER>"}
```

Message:

```text
<timestamp>.<csrDer>
signature = hex(HMAC-SHA256(productKey, message))
```

Response:

```json
{
  "pushCertCertificateChain": ["-----BEGIN CERTIFICATE-----..."],
  "pushCertSignature": "<base64>"
}
```

Both endpoints reject timestamps older than 300 seconds.

## Upgrades

```bash
git pull
pnpm install
pnpm mserver build
sudo install -m 0755 apps/mttx/dist/mttx /opt/mattrax-gateway/mttx
sudo systemctl restart mattrax-gateway
```

Keep the data directory. Losing `scep-ca.json` or `AUTH_SECRET` invalidates every issued
device identity.

## Operational notes

- The gateway does not run maintenance, send credential-expiry emails or push.
- It stores only `scep-ca.json`; device state lives in your backend.
- It applies a per-process rate limit.
- It has no dashboard; your product is the UI.
- It does not implement `/mdm/apple/enroll`; see
  [Whitelabel enrollment](/operations/whitelabel/enrollment).

## Next

- [Management backend](/operations/whitelabel/management-backend)
- [Troubleshooting](/operations/troubleshooting)
