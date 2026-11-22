# Mattrax services

Hosted services shared by Mattrax Cloud and self-hosted deployments. The
service owns two things a customer deployment should not hold credentials for:
APNs delivery and Stripe billing.

| Endpoint                            | Auth                              | Purpose                                                            |
| ----------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `GET /`                             | none                              | Redirects people to `https://mattrax.app`.                         |
| `GET /health`                       | none                              | Liveness and feature flags.                                        |
| `GET /health/db`                    | none                              | Database connectivity probe.                                       |
| `POST /v1/apns/push` (also `/apns`) | HMAC or deployment licence bearer | Relay a certificate-based MDM push to Apple.                       |
| `POST /api/platform/billing/*`      | Deployment licence bearer         | Self-hosted licence summary, portal, checkout, invoices and usage. |
| `POST /v1/billing/hosted/*`         | `SERVICES_TOKEN` bearer           | Hosted tenant billing, usage reports, renames and teardown.        |
| `POST /api/v1/billing/webhook`      | Stripe signature                  | Stripe subscription lifecycle for licences and hosted tenants.     |

The APNs relay keeps Apple connectivity and the Stripe secret out of customer
deployments. A self-hosted install uses its `MATTRAX_LICENSE_KEY` for both the
relay and billing, so no second shared secret is needed.

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
- `SERVICES_TOKEN` — shared machine-to-machine token used by the application.
- `MATTRAX_CLOUD_URL` — application origin that receives entitlement updates.
- `MATTRAX_PLAN_LIMITS` — the same plan catalogue the application enforces.
- `APNS_RELAY_SECRET` — optional shared HMAC secret for trusted callers. Without
  it, the relay accepts a valid deployment licence key.

The public origin is `https://services.mattrax.app`.
