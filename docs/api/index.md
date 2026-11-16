# REST API

The Enterprise API is a typed JSON API served by the Cloud API Worker.

## Base URL

| Deployment    | Base                           |
| ------------- | ------------------------------ |
| Mattrax Cloud | `https://e.mattrax.app/api/v1` |
| Self-hosted   | `https://<your-origin>/api/v1` |

The OpenAPI document is at `/api/openapi.json`; the interactive Scalar UI is at `/api/docs`.
See [OpenAPI](/api/openapi).

## Authentication

Two credentials are accepted:

- **Session cookie** — `__Host-mattrax_session`, used by the dashboard.
- **Bearer token** — `Authorization: Bearer mtx_...`, used by automation.

Create tokens under **Account → API tokens**. A token has:

- A `read` or `write` scope (`write` implies `read`).
- An optional tenant binding.
- An optional expiry.

```bash
curl "$MATTRAX_URL/api/v1/me" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

### Tenant authorization

For tenant routes, Mattrax checks:

1. The token's tenant binding (a mismatch returns `EnterpriseNotFound`).
2. The token scope (`read` for reads, `write` for writes and deletes).
3. The user's membership and role.
4. The tenant's MFA requirement for owners/admins.

Effective permission is the intersection of token scope and member role.

### Step-up

Sensitive browser actions require `x-mattrax-step-up: <grant>`. Bearer tokens are exempt.
Missing or expired grants return a 403 `StepUpRequired` with the action and available
factors.

## Conventions

- JSON request and response bodies; `Content-Type: application/json`.
- IDs are opaque strings.
- Timestamps are ISO 8601 UTC.
- Delete endpoints that take multiple ids require a JSON body: `{ "ids": ["..."] }`.
- CSV export endpoints return `text/csv` and set `X-Export-Truncated` when clipped.
- Application and policy file downloads return JSON with base64 `content`, not binary.

## Errors

Errors are tagged objects with an HTTP status:

```json
{
  "_tag": "EnterpriseBadRequest",
  "message": "A VPP adamId must be numeric."
}
```

| Tag                       | Status | Meaning                                    |
| ------------------------- | ------ | ------------------------------------------ |
| `EnterpriseBadRequest`    | 400    | Invalid input                              |
| `EnterpriseUnauthorized`  | 401    | Missing or invalid credential              |
| `EnterpriseForbidden`     | 403    | Role, scope or MFA requirement             |
| `StepUpRequired`          | 403    | Sensitive action needs confirmation        |
| `EnterpriseNotFound`      | 404    | Missing or not visible to this caller      |
| `EnterpriseConflict`      | 409    | Duplicate or state conflict                |
| `EnterpriseNotConfigured` | 503    | Feature not configured for this deployment |
| `EnterpriseStripeError`   | 502    | Stripe failure                             |
| `EnterpriseUpstreamError` | 502    | Vendor/upstream failure                    |
| `EnterpriseDbError`       | 500    | Database failure                           |

Use the `x-request-id` response header when reporting a failure.

## Pagination and limits

- Device search defaults to a page of 50 and caps at 200.
- Audit search uses a cursor or offset.
- CSV exports cap at 10,000 rows.
- Application inventory caps at 500 rows.
- Tenant import caps at 8 MB and 10,000 rows per class.

`GET /api/v1/tenants/:tenantId/devices` is unpaginated. Use `/devices/search` for large
fleets.

## Rate limits

Rate limit buckets: auth, enrollment, MDM, SCIM, billing and SCEP. A 429 has a stable JSON
body and `Retry-After`. Limits are documented in
[Configuration](/operations/configuration).

## Versioning

The path is versioned (`/v1`). Additive fields are not considered breaking. The OpenAPI
document is the source of truth for request and response shapes.

## Quick start

```bash
export MATTRAX_URL=https://e.mattrax.app
export MATTRAX_TOKEN=mtx_...

# Who am I?
curl -s "$MATTRAX_URL/api/v1/me" -H "Authorization: Bearer $MATTRAX_TOKEN"

# Tenants
curl -s "$MATTRAX_URL/api/v1/tenants" -H "Authorization: Bearer $MATTRAX_TOKEN"

# Devices
curl -s "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/search?limit=10" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

TypeScript:

```ts
const response = await fetch(`${process.env.MATTRAX_URL}/api/v1/tenants`, {
  headers: { Authorization: `Bearer ${process.env.MATTRAX_TOKEN}` },
});

if (!response.ok) {
  const error = await response.json();
  throw new Error(`${error._tag}: ${error.message}`);
}

const tenants = await response.json();
```

## Next

- [CLI](/api/cli)
- [API reference](/api/reference/)
- [OpenAPI](/api/openapi)
- [Webhooks](/admin/operations)
