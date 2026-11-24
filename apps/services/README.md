# Mattrax services

Hosted services shared by Mattrax Cloud and self-hosted deployments. The
service owns two things a customer deployment should not hold credentials for:
APNs delivery and Stripe billing.

| Endpoint                            | Auth                                               | Purpose                                                            |
| ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /`                             | none                                               | Redirects people to `https://mattrax.app`.                         |
| `GET /health`                       | none                                               | Liveness and feature flags.                                        |
| `GET /health/db`                    | none                                               | Database connectivity probe.                                       |
| `POST /v1/apns/push` (also `/apns`) | `SERVICES_TOKEN` HMAC or deployment licence bearer | Relay a certificate-based MDM push to Apple.                       |
| `POST /api/platform/billing/*`      | Deployment licence bearer                          | Self-hosted licence summary, portal, checkout, invoices and usage. |
| `POST /v1/billing/hosted/*`         | `SERVICES_TOKEN` bearer                            | Hosted tenant billing, usage reports, renames and teardown.        |
| `POST /api/v1/billing/webhook`      | Stripe signature                                   | Stripe subscription lifecycle for licences and hosted tenants.     |

The APNs relay keeps Apple connectivity and the Stripe secret out of customer
deployments. Cloud authenticates relay calls with `SERVICES_TOKEN`, the same
shared token it uses for hosted billing. A self-hosted install uses its
`MATTRAX_LICENSE_KEY` for both the relay and billing, so no second shared
secret is needed.

## Database

Billing has its own schema, prefixed `services_`, in the dedicated services
MySQL database:

- `services_deployment_license`
- `services_tenant`
- `services_subscription`
- `services_tenant_usage`
- `services_stripe_event`

It contains no foreign keys into the application database. The application
reports usage and caches the plan on its organisation row; the Stripe customer
and subscription live only here.

Migrations are generated from `packages/enterprise-billing/src/schema.ts` and
applied automatically at startup by `src/migrate.ts`:

```bash
pnpm --filter @mattrax/services db:generate
DATABASE_URL=mysql://... pnpm --filter @mattrax/services db:migrate
```

To move rows from a pre-split application database, run the one-off importer
before the application migration drops the legacy tables:

```bash
SOURCE_DATABASE_URL=mysql://... DATABASE_URL=mysql://... pnpm --filter @mattrax/services db:import-legacy
```

## Deployment

Railway builds `apps/services/Dockerfile` from the repository root. Set
`RAILWAY_DOCKERFILE_PATH=apps/services/Dockerfile` on the service and bind
`DATABASE_URL` to the Railway MySQL service.

Required environment:

- `DATABASE_URL` — MySQL for the `services_` schema.
- `STRIPE_SECRET_KEY` — Stripe API key.
- `STRIPE_WEBHOOK_SECRET` — endpoint secret for `/api/v1/billing/webhook`.
- `STRIPE_DEVICE_MONTHLY_PRICE_ID` — hosted tenant device price.
- `STRIPE_LICENSE_PRICE_ID` — optional price for self-hosted licence checkout.
- `SERVICES_TOKEN` — shared machine-to-machine token used by the application
  for hosted billing and as the APNs relay HMAC key.
- `MATTRAX_CLOUD_URL` — application origin that receives entitlement updates.
- `MATTRAX_PLAN_LIMITS` — the same plan catalogue the application enforces.
- `POSTHOG_KEY` — optional PostHog project key. Unset disables analytics and the
  relay never creates a client.
- `POSTHOG_HOST`, `POSTHOG_ENVIRONMENT`, `MATTRAX_RELEASE` — optional PostHog
  host, environment tag and release label for those events.

With `POSTHOG_KEY` set, the relay captures one `apns_relay_push` event per
push with `deployment_kind` (`licensed` or `shared-secret`), the outcome and a
SHA-256 hash of the deployment licence id as both the distinct id and
`deployment_id`. The raw licence id, push token, certificates, tenant data and
request body are never sent.

### Relay authentication rollout

`SERVICES_TOKEN` must match the API Worker byte-for-byte, because it both
authorises hosted billing and signs APNs relay requests. Deploy this service
and Cloud together, or first stage a services release that accepts both the
old relay secret and `SERVICES_TOKEN`, then deploy Cloud and remove the old
secret. Add `SERVICES_TOKEN` wherever only the former relay secret was
configured. Self-hosted installs are unaffected and continue to use their
deployment licence.

The public origin is `https://services.mattrax.app`.
