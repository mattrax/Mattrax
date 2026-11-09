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

Install dependencies with:

```bash
pnpm install
```

| Command            | Description                                   |
| ------------------ | --------------------------------------------- |
| `pnpm test`        | Run the Vitest suite.                         |
| `pnpm typecheck`   | Typecheck the workspace.                      |
| `pnpm format`      | Run formatting and linting through Vite Plus. |
| `pnpm doc`         | Start the documentation site locally.         |
| `pnpm doc:build`   | Build the documentation site.                 |
| `pnpm web dev`     | Run only the web app.                         |
| `pnpm api dev`     | Run only the API app.                         |
| `pnpm mserver dev` | Run only the whitelabel server app.           |

## Cloud

Mattrax's Cloud deployment consists of two Cloudflare Workers: a web Worker that serves the
dashboard and documentation at `e.mattrax.app`, and an API Worker that is only reachable
through the web Worker's service binding.

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
pnpm deploy:prod:all
```

Database migrations are managed with Drizzle Kit:

```bash
# Generate a migration after changing the schema
pnpm api db:generate

# Apply pending migrations (requires DATABASE_URL)
DATABASE_URL=postgres://... pnpm api db:migrate
```

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
