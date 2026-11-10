# Running locally

The gateway source is in `apps/mttx` and is implemented as the `mttx` CLI
(`@mattrax/server`).

## Development

```bash
pnpm install

pnpm mserver dev serve \
  --webhook-url http://localhost:8787
```

Defaults in development:

| Option             | Default                   |
| ------------------ | ------------------------- |
| `--port`           | `3000`                    |
| `--origin`         | `http://localhost:3000`   |
| `--webhook-secret` | `$MATTRAX_WEBHOOK_SECRET` |
| `--data-dir`       | `./.data`                 |

`--webhook-url` is required: the MDM service delegates every product decision to your
backend.

To run a complete example, including a management backend and dashboard, use:

```bash
pnpm --filter @mattrax/example-whitelabel dev
```

That Worker listens on port `9051` by default. It reads branding from
`BRAND_NAME` (default `Mattrax`), `BRAND_LOGO_URL`, `SUPPORT_EMAIL` (default
`hello@mattrax.app`) and `BRAND_COLOR` in `cloudflare.config.ts`, and uses the first two
for the generated Apple enrollment profile. `GET /branding.json` exposes the resolved
values to a white-label frontend.

## CLI

| Command   | Purpose                                             |
| --------- | --------------------------------------------------- |
| `version` | Prints the package version.                         |
| `serve`   | Starts the HTTP server.                             |
| `update`  | Placeholder; prints that it is not implemented yet. |

`serve` flags:

| Flag                  | Required | Description                                                                                                                                |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `--port`              | No       | HTTP port. Defaults to `3000`.                                                                                                             |
| `--origin`            | No       | Public origin used in enrollment and asset URLs. Defaults to `http://localhost:3000`.                                                      |
| `--webhook-url`       | Yes      | Base URL for your management webhook backend.                                                                                              |
| `--webhook-secret`    | Yes      | HMAC secret for webhook requests. Defaults to `MATTRAX_WEBHOOK_SECRET`. The management backend rejects unsigned requests when it is unset. |
| `--data-dir`          | No       | Directory for filesystem-backed state. Defaults to `./.data`, or `/opt/mattrax` in bundled builds.                                         |
| `--apple-vendor-cert` | No       | Path to an Apple vendor certificate PEM used to derive the MDM topic.                                                                      |
| `--brand-name`        | No       | Organisation name in generated enrollment profiles. Defaults to `Mattrax` / `MATTRAX_BRAND_NAME`.                                          |
| `--brand-logo-url`    | No       | Optional logo URL or data URL for a white-label frontend.                                                                                  |
| `--support-email`     | No       | Support address in the enrollment profile description. Defaults to `hello@mattrax.app`.                                                    |
| `--brand-color`       | No       | Optional hex brand colour for a white-label frontend.                                                                                      |

Example:

```bash
pnpm mserver dev serve \
  --port 3000 \
  --origin https://mdm.example.com \
  --webhook-url https://api.example.com \
  --webhook-secret "$MATTRAX_WEBHOOK_SECRET" \
  --data-dir ./data \
  --apple-vendor-cert ./certs/apple-vendor.pem
```

## Building

```bash
pnpm mserver build
```

The build script:

1. Bundles the TypeScript server with esbuild to `apps/mttx/dist/server.cjs`.
2. Generates a Node single-executable-application blob.
3. Copies the current Node binary, injects the blob with `postject`, and writes
   `apps/mttx/dist/mttx`.
4. Ad-hoc signs the binary on macOS.

Bundled builds have `MATTRAX_SERVER_BUNDLED=1` baked in, so the default data directory is
`/opt/mattrax`. You can still override it with `--data-dir`.

## Runtime limits

The current `serve` command intentionally shuts down after 24 hours and applies a
per-process rate limit of about 5 requests per second. Run it under systemd, Docker, or
another supervisor with automatic restart. See [Deployment](./deployment) for a unit file
and container example.

## Next steps

- [HTTP surface](./endpoints)
- [Management webhooks](./webhooks)
- [Deployment](./deployment)
