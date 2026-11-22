# Deployment

Hosted deployments are driven by `.github/workflows/deploy.yml`, modelled on the
setup in `oscartbeaumont/shell.build` and the [`cf` CLI](https://github.com/cloudflare/cf).

- Every push to `main` applies production Drizzle migrations and then deploys the
  API Worker and the dashboard Worker (`pnpm deploy:prod:all`).
- Every pull request from this repository gets a Worker Preview of both Workers,
  posted as a sticky comment and deleted when the PR closes. Fork PRs and
  Dependabot PRs skip the preview jobs (they cannot read the deployment
  secrets, or do not need an environment per upgrade); the normal CI checks
  still run.
- A newer commit on the same branch/PR cancels the previous deployment.

The workflow is separate from `ci.yml`, which runs typecheck, unit tests, e2e,
docs and bundle builds on every change. A red CI run does not block a deploy if
`main` was pushed anyway, so keep `main` protected with the CI checks as
required statuses.

## Required GitHub configuration

Repository secrets (Settings → Secrets and variables → Actions → Secrets):

| Secret                  | Purpose                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | Token with Workers Scripts:Edit, Workers R2 Storage:Edit, Workers Routes:Edit and Account Settings:Read on the account.                          |
| `CLOUDFLARE_ACCOUNT_ID` | Account that owns both Workers.                                                                                                                  |
| `DATABASE_URL`          | Production MySQL connection string used by `pnpm cloud db:migrate`.                                                                              |
| `AUTH_SECRET`           | Optional copy of the dashboard's SSR signing secret. The Worker's existing secret is used when this is absent.                                   |
| `PREVIEW_DATABASE_URL`  | Optional. Shared preview MySQL connection string. When absent (together with the preview Hyperdrive/bucket), PR Preview deployments are skipped. |

Repository variables (Settings → Secrets and variables → Actions → Variables):

| Variable                 | Purpose                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `PREVIEW_HYPERDRIVE_ID`  | Hyperdrive config for the preview database.                                            |
| `PREVIEW_STORAGE_BUCKET` | R2 bucket for preview uploads and backups. Must exist before the first preview deploy. |
| `PRODUCTION_ORIGIN`      | Optional. Defaults to `https://e.mattrax.app`.                                         |
| `SERVICES_TOKEN`         | Shared token for the hosted services deployment (billing and entitlements).            |

The Workers' own secrets are shared by production and every Preview of that
Worker, so they only need to be set once (for example with `cf secrets put`):

- `ORIGIN` is not a Worker secret: it is a build-time text binding. Production
  deploys pass `ORIGIN=https://e.mattrax.app` (the workflow uses
  `PRODUCTION_ORIGIN`), each Preview passes its own host, and local development
  defaults to `http://localhost:9050`.
- `AUTH_SECRET`, `TRUSTED_ORIGINS`, the Stripe keys, Apple/Android/Entra
  credentials and `POSTHOG_*` as used by production.
- `DEV_MAILBOX_SECRET` on **both** Workers. Previews opt into
  `DEV_MAILBOX=true` + `DEV_MAILBOX_ALLOW_REMOTE=true`, which requires this
  secret; it lets a tester read sign-up codes from `/api/debug/emails` without
  sending real mail. Do not publish the secret with a preview link.

## Cloudflare resources

1. **Preview database + Hyperdrive.** Optional. Create a MySQL database for
   previews and a Hyperdrive configuration pointing at it, then set
   `PREVIEW_DATABASE_URL`, `PREVIEW_HYPERDRIVE_ID` and
   `PREVIEW_STORAGE_BUCKET`. Migrations from every PR are applied to it before
   the preview Workers are uploaded, so keep it disposable rather than pointing
   it at production. Without all three, the workflow skips Preview deployments
   instead of falling back to production.
2. **Preview R2 bucket.** Create the bucket named by `PREVIEW_STORAGE_BUCKET`.
3. **Backup bucket.** Create `mattrax-backups` once — the `cf` commands and its
   lifecycle rules are in [Backups](/operations/backups). The workflow only
   uploads to it and fails with a clear message if it is missing.
4. **Preview URLs.** The deploy expects each Worker Preview to have a generated
   URL. In the Cloudflare dashboard open each Worker → Settings → Domains and
   enable the Worker URL (preview) toggle, or attach a preview-only custom
   domain. The API Preview URL is what the dashboard Preview proxies `/api`,
   `/mdm` and `/scim` to.
5. **Secrets.** Add the Worker secrets listed above to `mattrax` and
   `mattrax-api`. `cf` refuses a declared secret with no value.

No production route, cron trigger or queue consumer is created for a Preview:
the API config strips its cron triggers when `isPreview` is true.

## How a preview is assembled

Cloudflare service bindings from a Preview always resolve to the bound Worker's
**production** deployment, so a Preview cannot call another Preview over the
`API` binding. The workflow therefore:

1. deploys the dashboard Preview once to learn its generated URL;
2. deploys the API Preview with `ORIGIN` set to that URL (cookies, passkey RP
   id and email links must match the host the person uses);
3. redeploys the dashboard Preview with `API_URL` set to the API Preview URL.
   `apps/web/src/server/api.ts` uses `API_URL` in preference to the service
   binding, preserving path, query, headers, cookies and body.

The second dashboard build is deliberate: it keeps the preview origin
authoritative without guessing Cloudflare's generated hostnames. Passkeys are
scoped to the preview host, so a preview account/passkey is separate from
production (the RP id is the preview host, not `e.mattrax.app`).

Limitations worth knowing:

- The debug mailbox is in-memory per isolate and is not shared between preview
  isolates. A verification email usually lands on the isolate that sent it; if
  a code cannot be found, retry the request.
- Previews share one preview database, so schema changes from different PRs can
  interleave. Run destructive experiments on a local database instead.
- Previews are public URLs. Do not register real customer data in them.

## Agent releases

`mattraxd` (the on-device agent) is released independently of the Workers by
`.github/workflows/release-agent.yml`. The workflow is the only producer of
agent binaries; `ci.yml` does not build them.

- A pull request touching `apps/mattraxd/**` runs fmt, clippy, unit tests and the
  macOS/Windows builds. Artifacts are unsigned and are not published.
- Pushing a tag `mattraxd-v<version>` builds the universal macOS pkg, the
  signed bare macOS binary, the Windows executable/zip and a signed update
  manifest, then uploads them to the GitHub release.
- The nightly schedule publishes `<next patch>-nightly.<date>` as a prerelease and
  advances the rolling channel pointers in the `agent-channels` release:
  `latest.json` (newest build) and `nightly.json` (informational pointer). A
  stable tag advances `stable.json` and `latest.json`.
- `workflow_dispatch` with `channel=nightly` publishes a nightly by hand;
  `channel=stable` only builds and tests, so stable releases always go through a
  tag.

Devices update themselves from those pointers:

```sh
sudo mattraxd update --channel stable --check
sudo mattraxd update --channel stable --restart
```

Verification is fail-closed: HTTPS-only URLs, a manifest version/channel check,
the Ed25519 manifest signature, the artifact SHA-256 and a downgrade guard. See
[`apps/mattraxd/README.md`](https://github.com/mattrax/Mattrax/tree/main/apps/mattraxd)
for the manifest format, the `MATTRAXD_UPDATE_PUBLIC_KEY` variable and the full
secret list (`DEVELOPER_ID_*`, `NOTARY_*`, `WINDOWS_CERTIFICATE`,
`MATTRAXD_UPDATE_SIGNING_KEY`). Until those secrets exist the workflow still
produces unsigned artifacts and warns in the run summary; it does not fail a
fork or a pull request.

Rolling an agent release back is a `mattraxd update --channel stable --force`
after re-pointing `stable.json` at the older manifest (or restoring the previous
release asset). Keep the per-release `mattraxd-manifest.json`: it records the
exact artifact URLs and checksums that shipped.

## Rolling back production

`cf` deploys immutable Worker versions. If a production deploy is bad:

1. Roll the Worker back to the previous version in the Cloudflare dashboard
   (Workers → the Worker → Deployments → Rollback), for both `mattrax` and
   `mattrax-api` if the bad change spans them.
2. Fix forward on `main`. Migrations are forward-only; a rollback does not undo
   a schema change, so only roll back code that is compatible with the current
   schema.
