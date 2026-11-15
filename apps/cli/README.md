# @mattrax/cli

The `mattrax` command-line client for Mattrax Cloud and self-hosted deployments. It talks to
the same versioned Enterprise API (`/api/v1`) as the dashboard and uses scoped `mtx_...`
bearer tokens.

## Development

```bash
# Run the CLI from source
pnpm --filter @mattrax/cli start -- --help

# Type-check / build declarations
pnpm --filter @mattrax/cli typecheck
pnpm --filter @mattrax/cli build
```

The package exposes `src/index.ts` as the `mattrax` bin, so a workspace install can invoke
`mattrax` directly. Node.js 22.12 or newer is required.

## Quick start

```bash
export MATTRAX_URL=https://e.mattrax.app
export MATTRAX_TOKEN=mtx_...

mattrax auth status
mattrax devices list --status enrolled --health attention
mattrax policies export -o policies.yaml
mattrax policies apply --dry-run policies.yaml
```

Or persist credentials with `mattrax auth login`. The config is written to
`~/.config/mattrax/config.json` with mode `0600`; `MATTRAX_CONFIG` and `XDG_CONFIG_HOME` are
honoured. Flags override environment variables, which override the file.

## Commands

| Command                                       | Purpose                                        |
| --------------------------------------------- | ---------------------------------------------- |
| `auth login\|logout\|status`                  | Store, remove or inspect the token and origin  |
| `devices list\|get\|action\|unenroll`         | Search, inspect and act on devices             |
| `policies list\|get\|export\|apply\|validate` | Portable policy documents and idempotent apply |
| `groups list\|get\|create\|apply`             | Group metadata and membership                  |
| `enrollment show`                             | Enrollment link and platform status            |
| `version`                                     | CLI version                                    |

Global flags: `--url`, `--token`, `--tenant`, `--json`, `--yes` (accepted before or after the
subcommand). `--json` is stable and scriptable. Failures exit non-zero; tokens are redacted in
all output.

## Tests

```bash
pnpm exec vitest run apps/cli
```

The suite covers argument parsing, configuration precedence, document validation and
idempotent policy apply against a fake API client.

See [`docs/api/cli.md`](../../docs/api/cli.md) for full usage and a GitHub Actions example.
