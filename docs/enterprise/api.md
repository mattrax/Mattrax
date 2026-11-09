# API and OpenAPI

The Enterprise API is defined by `packages/enterprise-domain` and served by the Cloud API
Worker under `/api`.

| Resource        | URL                                        |
| --------------- | ------------------------------------------ |
| Interactive API | `https://mdm.example.com/api/docs`         |
| OpenAPI JSON    | `https://mdm.example.com/api/openapi.json` |
| Health          | `https://mdm.example.com/api/health`       |

The interactive reference is also linked from the docs sidebar as **OpenAPI**.

::: info Whitelabel
The whitelabel gateway has a different surface: `/health`, `/api/openapi.json` for its own
Apple protocol API, and `/mdm/apple/*`. It does not serve the Enterprise API. See
[HTTP surface](../whitelabel/endpoints).
:::

## Authentication

Two mechanisms are accepted:

| Mechanism      | How                             |
| -------------- | ------------------------------- |
| Session cookie | Sign in through the dashboard.  |
| API token      | `Authorization: Bearer mtx_...` |

Create a token from **Account → API tokens** or with `POST /api/v1/account/api-tokens`.
Tokens are account-scoped; tenant membership checks still apply to every tenant route.

```bash
export MATTRAX_URL=https://mdm.example.com
export MATTRAX_TOKEN=mtx_...

curl -s "$MATTRAX_URL/api/v1/me" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

## Common reads

```bash
# Tenants the token's user belongs to
curl -s "$MATTRAX_URL/api/v1/tenants" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"

# Devices, groups, policies
curl -s "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
curl -s "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
curl -s "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

The policy detail endpoint returns the policy's `configurations` map.

## Create and assign a policy

```bash
# Create
curl -s -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Baseline"}'

# Add a configuration (or replace it)
curl -s -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"configurations":{"mttx.apple.device":{"camera":true}}}'

# Delete a configuration
curl -s -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"configurations":{"mttx.apple.device":null}}'
```

Assign it to a group with explicit `assign` / `unassign` lists:

```bash
curl -s -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups/$GROUP_ID/members" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"assign":{"policies":["'"$POLICY_ID"'"]}}'
```

Then wake the affected devices:

```bash
curl -s -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/sync" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H 'content-type: application/json' \
  -d '["'"$POLICY_ID"'"]'

curl -s -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups/sync" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H 'content-type: application/json' \
  -d '["'"$GROUP_ID"'"]'
```

Sync accepts an array of ids and sends APNs pushes to the affected Apple devices when a
push transport is configured. Declarations themselves are computed on demand when a
device asks for declaration items; devices also converge at their next check-in.

## Errors

The API uses typed errors with a `_tag` field, for example `EnterpriseUnauthorized`,
`EnterpriseNotFound`, `EnterpriseTenantHasMembers`, and `EnterpriseLastTenantUser`.
Handle them by tag rather than by HTTP status text.

## OpenAPI

OpenAPI is generated from the same Effect HTTP contract that serves requests. To inspect
it:

```bash
curl -s "$MATTRAX_URL/api/openapi.json" | jq '.info'
```

The interactive Scalar UI is served at `/api/docs`. If you self-host Cloud on a different
origin, update the docs `origin` in `docs/.vitepress/config.ts` or use the `/api/docs`
path on your own deployment directly.
