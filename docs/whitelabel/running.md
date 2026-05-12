# Running Locally

The server package is `@mattrax/server` in `apps/server/`.

## Development

Run the TypeScript entrypoint with:

```sh
pnpm --filter @mattrax/server dev -- serve --webhook-url http://localhost:8787/webhook
```

By default, development mode uses:

| Option | Default |
| ------ | ------- |
| `--port` | `3000` |
| `--origin` | `http://localhost:3000` |
| `--data-dir` | `./.data` |

`--webhook-url` is required because the MDM service delegates management decisions to your backend.

## CLI

The CLI command is `mattrax-server` and supports these subcommands:

| Command | Purpose |
| ------- | ------- |
| `version` | Prints the package version. |
| `serve` | Starts the HTTP server. |

`serve` accepts:

| Flag | Required | Description |
| ---- | -------- | ----------- |
| `--port` | No | HTTP port. Defaults to `3000`. |
| `--origin` | No | Public origin used when generating enrollment and asset URLs. Defaults to `http://localhost:3000`. |
| `--webhook-url` | Yes | Base URL for your management webhook backend. |
| `--data-dir` | No | Directory for filesystem-backed server state. |
| `--apple-vendor-cert` | No | Path to an Apple vendor certificate PEM file used to derive the MDM topic. |

Example:

```sh
pnpm --filter @mattrax/server dev -- serve \
  --port 3000 \
  --origin https://mdm.example.com \
  --webhook-url https://api.example.com/webhook \
  --data-dir ./data \
  --apple-vendor-cert ./certs/apple-vendor.pem
```

## Building

Build the standalone server binary with:

```sh
pnpm --filter @mattrax/server build
```

The build script bundles the TypeScript server with esbuild, creates a Node single executable application blob, injects it into a copied Node binary, and writes the result to:

```text
apps/server/dist/mattrax-server
```

For bundled production builds, the default data directory changes to `/opt/mattrax-server`.
