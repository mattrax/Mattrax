# CLI

`mattrax` is a command-line client for Mattrax Cloud and self-hosted deployments. It uses the
same scoped API tokens as the REST API, so a token can be limited to `read`, bound to one
tenant and given an expiry.

The CLI lives in `apps/cli` and shares its request and response schemas with
`@mattrax/enterprise-domain`. It does not import the dashboard or its database layer.

## Install

From this repository:

```bash
pnpm --filter @mattrax/cli start -- --help
```

The package exposes `apps/cli/src/index.ts` as its `mattrax` bin. If you build or install the
workspace, invoke the bin directly; during development use the `start`/`dev` scripts, which
run the TypeScript entrypoint with `tsx`.

Requirements: Node.js 22.12 or newer.

## Authenticate

Create a token under **Account → API tokens**, then:

```bash
mattrax auth login --url https://e.mattrax.app
# Paste or pass the token:
mattrax auth login --token "$MATTRAX_TOKEN"
```

`auth login` verifies the token with `GET /api/v1/me` before saving anything. `auth status`
shows the deployment, the redacted token, its source, the account and the tenants it can
reach. `auth logout` deletes the stored credentials.

Credentials are stored at `~/.config/mattrax/config.json` with mode `0600` (the directory is
created as `0700`). `XDG_CONFIG_HOME` and `MATTRAX_CONFIG` are honoured. The file contains the
origin and token; treat it like an SSH private key.

For CI, do not write a config file. Use environment variables:

```bash
export MATTRAX_URL=https://e.mattrax.app
export MATTRAX_TOKEN=mtx_...
```

### Precedence

| Setting | Flag       | Environment      | Config file | Default                 |
| ------- | ---------- | ---------------- | ----------- | ----------------------- |
| Origin  | `--url`    | `MATTRAX_URL`    | `url`       | `https://e.mattrax.app` |
| Token   | `--token`  | `MATTRAX_TOKEN`  | `token`     | —                       |
| Tenant  | `--tenant` | `MATTRAX_TENANT` | `tenant`    | the token's only tenant |

Flags win over the environment, which wins over the config file. More specific sources win
per setting, so `--tenant` can select a tenant while the token still comes from the file.

`--tenant` accepts a tenant id, slug or exact name. With no selection, a token that can reach
exactly one tenant uses it; several tenants require a selection and the error lists them.

## Global flags

| Flag              | Purpose                                                   |
| ----------------- | --------------------------------------------------------- |
| `--url <origin>`  | Deployment origin; `/api/v1` is appended automatically    |
| `--token <token>` | API token; prefer `MATTRAX_TOKEN` or `auth login`         |
| `--tenant <ref>`  | Tenant id, slug or name                                   |
| `--json`          | Stable JSON output for scripts; every command supports it |
| `--yes`, `-y`     | Confirm destructive actions without a prompt              |

Global flags are accepted before or after the subcommand:

```bash
mattrax --json devices list
mattrax devices list --json
```

Exit codes: `0` success and `1` for request, validation, authentication or argument errors.
Tokens are always redacted in errors and diagnostics.

## Devices

```bash
# Search the fleet
mattrax devices list --q macbook --status enrolled --health attention
mattrax devices list --proto apple --group "Design" --limit 100

# Detail and derived health
mattrax devices get <device-id>

# Queue a command
mattrax devices action <device-id> sync
mattrax devices action <device-id> install-app --itunes-store-id 123456789
mattrax devices action <device-id> lock --yes

# Remove management
mattrax devices unenroll <device-id> --yes
```

Filters are server-side (`q`, `status`, `proto`, `group`, `health`, `limit`, `offset`).
`--group` accepts an id or exact group name. `--json` returns
`{ devices, total, limit, offset }` from `/devices/search`.

`lock`, `wipe`, `shutdown`, `clear-passcode`, `set-recovery-lock`,
`rotate-filevault-key` and `unenroll` require `--yes`. The lock response's unlock PIN is
printed once; store it before dismissing the terminal.

## Policies

```bash
mattrax policies list
mattrax policies get <policy-id>

# Portable documents (YAML by default; --format json or --json for JSON)
mattrax policies export -o policies.yaml
mattrax policies export --include-ids --format json -o policies.json

# Shape checks without network access
mattrax policies validate policies.yaml more-policies.json

# Preview, then apply
mattrax policies apply --dry-run policies.yaml
mattrax policies apply policies.yaml more-policies.json
mattrax policies apply --id <policy-id> replacement.yaml
```

An exported document is versioned and portable between deployments:

```yaml
version: 1
policies:
  - name: Baseline security
    notes: Applies to every Mac
    priority: 10
    configurations:
      passcode:
        required: true
      filevault:
        enabled: true
```

Server ids are omitted by default so a document can be applied to another tenant.
`--include-ids` adds them for same-deployment round trips.

`apply` matches existing policies by exact name, or by `--id` when supplied. If the document
has an `id` field that id is used instead. The command compares the fetched configuration map
with the document, patches only changed fields, deletes configuration kinds that are absent
from the document, and reports every policy as `created`, `updated` or `unchanged`. A second
run with the same document is a no-op, which makes it safe in automation.

`validate` checks the envelope, types, priorities, duplicate names and duplicate ids across
every file. It never contacts the API, so it can run in a pre-commit hook or pull request.

## Groups

```bash
mattrax groups list
mattrax groups get "Design"
mattrax groups create "Design" --kind manual --devices serial-1,serial-2 --policies Baseline
mattrax groups create "Stale devices" --kind dynamic --rules '{"version":1,"all":[]}'

mattrax groups apply --dry-run groups.yaml
mattrax groups apply groups.yaml
```

A group document uses device ids, serials or exact names, and policy ids or names:

```yaml
version: 1
groups:
  - name: Design
    notes: Macs used by the design team
    kind: manual
    devices:
      - C02EXAMPLE01
    policies:
      - Baseline security
```

`groups apply` matches by name or `--id`, patches changed metadata, then assigns and
unassigns only the difference in manual device membership and included policies. A membership
list that is absent from the document is left untouched; use `devices: []` or `policies: []`
to clear it. Policies excluded from a group are left untouched. Dynamic group membership stays
rule-driven; supplying `devices` for a dynamic group is rejected during validation.

## Enrollment

```bash
mattrax enrollment show
mattrax enrollment show --json
```

Shows the enrollment id and link (`<origin>/enroll/<id>`), whether Apple, Windows and Android
enrollment are enabled, the device limit and the Windows discovery URL. The discovery URL
contains a signed tenant token; treat it as a secret.

## Automation

```yaml
name: Mattrax drift check
on:
  schedule:
    - cron: "0 7 * * *"
  workflow_dispatch:

jobs:
  policies:
    runs-on: ubuntu-latest
    env:
      MATTRAX_URL: https://e.mattrax.app
      MATTRAX_TOKEN: ${{ secrets.MATTRAX_TOKEN }}
      MATTRAX_TENANT: ${{ vars.MATTRAX_TENANT }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @mattrax/cli typecheck
      - name: Validate policy documents
        run: pnpm --filter @mattrax/cli start -- policies validate policies/*.yaml
      - name: Check for drift
        run: pnpm --filter @mattrax/cli start -- policies apply --dry-run policies/*.yaml --json
```

Store a write-scoped token as an encrypted secret. A read-only workflow only needs `read`;
`policies apply` without `--dry-run` requires `write`.

## Self-hosted

Point `--url` or `MATTRAX_URL` at the deployment origin. A dashboard mounted below a path
(for example `https://mdm.example.com/mattrax`) keeps that prefix and appends `/api/v1`:

```bash
MATTRAX_URL=https://mdm.example.com/mattrax \
MATTRAX_TOKEN=mtx_... \
  mattrax devices list
```

The origin must use `http` or `https`; credentials embedded in the URL are rejected.
