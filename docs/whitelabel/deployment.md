# Deployment

Deploy the gateway anywhere it can receive public HTTPS traffic from Apple devices and
reach your management backend.

## Production command

For the standalone binary:

```bash
./mttx serve \
  --port 3000 \
  --origin https://mdm.example.com \
  --webhook-url https://api.example.com \
  --data-dir /opt/mattrax \
  --apple-vendor-cert /etc/mattrax/apple-vendor.pem
```

`--webhook-url` is the backend **base** URL. The gateway appends `/webhook/...`; do not
include `/webhook` yourself.

## Configuration checklist

| Setting               | Production guidance                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `--origin`            | Public HTTPS origin devices can reach. Required for correct profile and asset URLs.      |
| `--webhook-url`       | Base URL of your management backend, reachable only by the gateway.                      |
| `--data-dir`          | Persistent, backed-up directory or volume. Bundled builds default to `/opt/mattrax`.     |
| `--apple-vendor-cert` | Apple MDM vendor certificate PEM, so profiles use the correct topic.                     |
| TLS                   | Terminate HTTPS at a load balancer, reverse proxy, or hosting platform.                  |
| Supervisor            | Restart the process automatically; `serve` exits after 24 hours.                         |
| Webhook security      | Require mTLS or a shared bearer token at your proxy; the gateway does not sign requests. |

## Persistent data

The gateway stores SCEP CA material in `scep-ca.json` under `--data-dir`. It contains
private key material.

| Requirement                     | Reason                                                  |
| ------------------------------- | ------------------------------------------------------- |
| Restrict filesystem permissions | Prevent access to SCEP private key material.            |
| Back up the data directory      | Preserve enrollment continuity across host replacement. |
| Mount persistent storage        | Avoid regenerating CA state on every deploy.            |
| Exclude from source control     | Prevent accidental key disclosure.                      |

The gateway has no device database. Back up your management backend separately; it owns
all inventory, policy, command, and push state.

## Health checks

```bash
curl -fsS https://mdm.example.com/health
# {"status":"ok"}
```

Use this for load balancer and process health checks. It does not verify that your webhook
backend is reachable.

## Reverse proxy notes

The gateway builds incoming request URLs from the `Host` header, while generated
device-facing URLs use `--origin`. Ensure the proxy preserves the intended host header and
that `--origin` exactly matches the public URL devices use.

Example nginx location:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    client_max_body_size 20m;
}
```

Do not rewrite paths. Apple calls `/mdm/apple/*` directly.

## Supervision

Use systemd with `Restart=always` or a container restart policy. The current `serve`
command deliberately exits after 24 hours and limits each process to roughly 5 requests
per second. A supervisor turns the exit into a rolling restart; multiple instances behind
a proxy may be needed for larger fleets.

See [Running locally](./running) for a systemd unit and Dockerfile.

## APNs and push

The gateway does not push. Your management backend must hold the APNs certificate and wake
devices after policy changes:

- Node/single tenant: `NodePushTransport` (direct delivery).
- Worker/single tenant: `MtlsPushTransport` (one mTLS binding per certificate).
- Multi-tenant hosted product: `RelayPushTransport` (HMAC-signed relay).

If you do not push, devices still converge on their next scheduled check-in.

## Branding

There is no gateway-rendered UI. Your enrollment page, dashboard, domain, and emails are
yours. The Apple enrollment profile currently has fixed `Mattrax` display/organisation
text from the protocol package; changing it requires modifying `packages/dm-apple`.

## Operational notes

- Startup logs print the port, webhook backend, and data directory.
- MDM and SCEP handler errors are logged to stdout/stderr.
- `SIGINT` closes the HTTP listener and disposes the Effect HTTP handler.
- Unknown asset identifiers return `404`; missing declarations surface as gateway errors.
- There is no built-in metrics endpoint. Scrape your proxy and process metrics.

## Next steps

- [HTTP surface](./endpoints)
- [Management webhooks](./webhooks)
- [Self-hosting overview](../self-hosting)
