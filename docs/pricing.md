# Pricing and plan limits

Mattrax does not ship a hard-coded price list or plan catalogue. Operators choose their
own Stripe prices and enforce the matching device/tenant limits with the optional
`MATTRAX_PLAN_LIMITS` Worker secret.

## Configuring limits

```json
{
  "free": { "devices": 50, "tenants": 1 },
  "device": { "devices": null, "tenants": null }
}
```

The nested form supports a default plan for tenants that have no subscription:

```json
{
  "defaultPlan": "free",
  "plans": {
    "free": { "devices": 50, "tenants": 1 },
    "device": { "devices": null, "tenants": null }
  }
}
```

- Plan names must match the `plan` written by the Stripe webhook (subscription
  metadata `plan`, or `device` when the configured price id matches).
- A missing limit or `null` means unlimited; `0` means none.
- The tenant's plan is read from its `subscription` row. Missing, `canceled`,
  `incomplete_expired` and `unpaid` subscriptions use `defaultPlan` (`free` by default).
- Unknown plan names are unlimited, so adding a new Stripe price never locks out an
  existing customer before the catalogue is updated.
- Malformed JSON or negative/non-integer limits fail safe to unlimited with a startup
  warning.
- Omitting the secret keeps every plan unlimited.

## What is enforced

| Path                                         | Behaviour when the limit is reached                     |
| -------------------------------------------- | ------------------------------------------------------- |
| Public enrollment readiness                  | The platform panes show a "device limit reached" error. |
| Apple MDM `Authenticate` (new device)        | Rejected (`UnknownDevice`); no device row is created.   |
| Windows enrollment (new device)              | Rejected (`UnknownDevice`); no device row is created.   |
| Android enrollment token                     | Not issued; the enrollment page shows the plan error.   |
| Pre-registration import                      | New serials beyond the remaining capacity are rejected. |
| Tenant creation (`POST /v1/tenants`, import) | `EnterpriseForbidden` with the plan's tenant allowance. |

Re-enrolling an existing device is always allowed, and existing devices are never
deleted when a limit is lowered. The billing page (`Settings → Billing`) shows
`devicesUsed / deviceLimit`, `tenantsUsed / tenantLimit`, the plan/status and an
over-limit warning. The API's `GET /v1/tenants/:tenantId/billing` response carries the
same fields.

See [Self-hosting → Plan and seat limits](./self-hosting#plan-and-seat-limits) for the
deployment command and behaviour.
