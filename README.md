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

Mattrax's Cloud deployment consists of two Cloudflare Workers.

```bash
# Deploys web and docs
pnpm web deploy:prod

# Deploys API
pnpm api deploy:prod
```

To deploy both hosted surfaces:

```bash
pnpm deploy:prod:all
```

## Technologies

Mattrax is built on:

- [Cloudflare Workers](https://cloudflare.com) + R2, Email Sending, Hyperdrive
- [Effect](https://effect.website)
- [Drizzle ORM](https://orm.drizzle.team)
- [Stripe](https://stripe.com)
- [Vite Plus](https://viteplus.dev)
- [SolidJS](https://solidjs.com)
- [TailwindCSS](https://tailwindcss.com)
