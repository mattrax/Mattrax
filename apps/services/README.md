# Mattrax services

Hosted services shared by Mattrax Cloud and self-hosted deployments:

| Endpoint                            | Auth                              | Purpose                                                            |
| ----------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `GET /health`                       | none                              | Liveness and feature flags.                                        |
| `GET /health/db`                    | none                              | Database connectivity probe.                                       |
| `POST /v1/apns/push` (also `/apns`) | HMAC or deployment licence bearer | Relay a certificate-based MDM push to Apple.                       |
| `POST /api/platform/billing/*`      | Deployment licence bearer         | Self-hosted licence summary, portal, checkout, invoices and usage. |
| `POST /api/v1/billing/webhook`      | Stripe signature                  | Stripe subscription lifecycle for licences and hosted tenants.     |

The APNs relay keeps Apple connectivity and the Stripe secret out of customer
deployments. A self-hosted install uses its `MATTRAX_LICENSE_KEY` for both the
relay and billing, so no second shared secret is needed.

## Deployment

Railway builds `apps/services/Dockerfile` from the repository root. Set
`RAILWAY_DOCKERFILE_PATH=apps/services/Dockerfile` on the service.

Required environment:

- `DATABASE_URL` — MySQL with the Mattrax schema (`pnpm db:migrate`).
- `STRIPE_SECRET_KEY` — Stripe API key.
- `STRIPE_WEBHOOK_SECRET` — endpoint secret for `/api/v1/billing/webhook`.
- `STRIPE_DEVICE_MONTHLY_PRICE_ID` — hosted tenant device price.
- `STRIPE_LICENSE_PRICE_ID` — optional price for self-hosted licence checkout.
- `APNS_RELAY_SECRET` — optional shared HMAC secret for trusted callers. Without
  it, the relay accepts a valid deployment licence key.

The public origin is `https://services.mattrax.app`.
