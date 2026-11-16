<p align="center">
  <img width="150" height="150" src="apps/web/public/assets/brand/logo-rounded.png" alt="Mattrax Logo">
  <br />
  <strong>Mattrax</strong>
  <br />
  Open device management infrastructure for Apple, Windows, Android, and Linux fleets.
  <br />
  <br />
  <a href="https://mattrax.app"><strong>mattrax.app</strong></a>
  ·
  <a href="https://discord.gg/WPBHmDSfAn">Discord</a>
  ·
  <a href="https://twitter.com/mattraxapp">Twitter</a>
</p>

## Overview

Mattrax is a TypeScript monorepo for building and operating our device management products. It includes all product surfaces including Enterprise, Platform and Whitelabel.

## Development

Requirements:

- Node.js `>=22.12.0`
- pnpm `10.33.2`
- MySQL 8 (local development uses `mysql://mattrax:mattrax@localhost:3306/mattraxe`)

Install dependencies, apply migrations and start the dashboard + API Worker:

```bash
pnpm install
cp .dev.vars.example apps/api/.dev.vars
cp .dev.vars.example apps/web/.dev.vars
pnpm api db:migrate
pnpm web dev
```

`ORIGIN` in `.dev.vars` must match the URL you open in the browser
(`http://localhost:9050` by default), because it is the WebAuthn relying party.
To run the dev server over HTTPS instead, run `pnpm dev:cert` and
`DEV_HTTPS=1 pnpm web dev`, then set `ORIGIN=https://localhost:9050`.

| Command              | Description                                      |
| -------------------- | ------------------------------------------------ |
| `pnpm test`          | Run the Vitest suites.                           |
| `pnpm test:e2e`      | Run the Playwright browser tests over CDP.       |
| `pnpm typecheck`     | Typecheck the workspace.                         |
| `pnpm format`        | Run formatting and linting through Vite Plus.    |
| `pnpm doc`           | Start the documentation site locally.            |
| `pnpm doc:build`     | Build the documentation site.                    |
| `pnpm web dev`       | Run only the web app (and its API Worker).       |
| `pnpm api dev`       | Run only the API app.                            |
| `pnpm catalog:split` | Rebuild the split Windows policy catalogue.      |
| `pnpm catalog:check` | Verify the committed catalogue split is current. |

The Windows policy catalogue is served incrementally from
`apps/web/public/catalog/windows/`; the source file stays at
`data/catalog/windows.json`. See [docs/reference/policy-catalogue.md](docs/reference/policy-catalogue.md)
for the file layout and regeneration steps.

The browser suite drives a real Chrome via CDP by default. Set
`E2E_BASE_URL` to test an already-running deployment, or `E2E_CHANNEL=bundled`
to use Playwright's bundled Chromium (as CI does). The suite creates its own
users and tenants, so it is safe to point at a disposable database.

## Architecture

The repository is split into protocol, management and product layers so each
piece can be tested in isolation:

| Layer               | Packages / apps                                   |
| ------------------- | ------------------------------------------------- |
| Protocol            | `dm-apple`, `dm-windows`, `scep`, `soap`, `plist` |
| Management contract | `management-backend`, `management-backend-http`   |
| Hosted management   | `management-backend-enterprise`, `apps/api`       |
| Product contracts   | `enterprise-domain`                               |
| Product backends    | `enterprise-backend`                              |
| Data                | `enterprise-core` (Drizzle/MySQL, R2, secrets)    |
| Surfaces            | `apps/web` (dashboard, landing, docs)             |

## Cloud

Mattrax's Cloud deployment consists of two Cloudflare Workers: a web Worker that serves the
dashboard and documentation at `e.mattrax.app`, and an API Worker that is only reachable
through the web Worker's service binding.

### Self-hosting

The same dashboard and API run as one Node container. It needs MySQL and an HTTPS
reverse proxy, and nothing else:

```bash
export ORIGIN=https://mdm.example.com
export AUTH_SECRET="$(openssl rand -base64 32)"
docker compose -f docker-compose.selfhost.yml up -d --build
```

See [docs/operations/self-hosting.md](docs/operations/self-hosting.md) for configuration,
TLS, storage, backups and upgrade notes.

Configuration lives in each app's `cloudflare.config.ts` and deployments use the
[`cf` CLI](https://github.com/cloudflare/cf). Authenticate once with:

```bash
cf auth login
```

Then deploy:

```bash
# Deploy the web Worker (builds and copies the docs into the assets bundle)
pnpm web deploy:prod

# Deploy the API Worker
pnpm api deploy:prod
```

To deploy both hosted surfaces:

```bash
ORIGIN=https://e.mattrax.app pnpm deploy:prod:all
```

`ORIGIN` is baked into the API Worker as its canonical origin (passkey RP id,
cookies, links); leave it unset during local development and CI previews set
their own. GitHub Actions does this automatically.

GitHub Actions deploys production from `main` and creates a Worker Preview for
each pull request (posted as a sticky comment, deleted when the PR closes).
The required secrets, Cloudflare resources and preview limitations are in
[docs/operations/deployment.md](docs/operations/deployment.md).

Database migrations are managed with Drizzle Kit:

```bash
# Generate a migration after changing the schema
pnpm api db:generate

# Apply pending migrations (MySQL connection fields)
DATABASE_HOST=localhost DATABASE_PORT=3306 DATABASE_USER=mattrax \
  DATABASE_PASSWORD=mattrax DATABASE_NAME=mattraxe pnpm api db:migrate
```

## Bundle size

Both Worker bundles are checked before every production deploy:

```bash
pnpm bundle:check
```

It prints the gzipped size of `mattrax-api` and `mattrax` and exits non-zero above
2.5 MiB, leaving headroom under Cloudflare's script limit. `deploy:prod` runs the
same check automatically.

Client routes are split into per-route chunks (`fileRoutes` `codeSplitting`) and
heavy optional code loads after hydration (PostHog). For a module-level analysis,
run a report build and inspect it with `@rolldown/perf-kit`:

```bash
MATTRAX_PERF_REPORT=1 pnpm web build
cd apps/web && npx perf-kit graph \
  --report node_modules/.rolldown/report/.cloudflare/output/v0/workers/default/assets
```

The Worker uses the same workflow through `apps/api/perf-kit.vite.config.ts`
(generated by `npx perf-kit worker-config --app apps/api`).

## Technologies

Mattrax is built on:

- [Cloudflare Workers](https://cloudflare.com) + R2, Email Sending, Hyperdrive
- [Effect](https://effect.website)
- [Drizzle ORM](https://orm.drizzle.team)
- [Stripe](https://stripe.com)
- [Vite Plus](https://viteplus.dev)
- [cf CLI](https://github.com/cloudflare/cf)
- [SolidJS](https://solidjs.com)
- [TailwindCSS](https://tailwindcss.com)
