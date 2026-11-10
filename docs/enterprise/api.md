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
Tokens can be read-only and/or bound to a single tenant; tenant membership and role
checks still apply to every tenant route. Tokens created before scoping existed behave as
read/write tokens for all the owner's tenants.

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

## Device security and software inventory

Apple devices can escrow FileVault recovery keys and report their installed applications.
Both are populated from MDM command results and are tenant-scoped.

```bash
# Queue the Apple SecurityInfo command on the device's next check-in
curl -s -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/action" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"action":"collect-security-info"}'

# Queue a full InstalledApplicationList refresh
curl -s -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/action" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"action":"refresh-applications"}'

# Device software inventory
curl -s "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/applications" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"

# Tenant-wide software inventory, grouped by bundle identifier
curl -s "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/inventory?q=safari&managed=managed" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Device detail responses expose `recoveryKeyEscrowed`, `fileVaultStatus` and
`bootstrapTokenEscrowed` as presence metadata only. Reading the decrypted FileVault key is a
privileged, audited action (`owner`/`admin` only) and is never included in list responses:

```bash
curl -s "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/recovery-key" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Escrowed values are sealed with the deployment `AUTH_SECRET` before storage. The recovery-key
response includes the raw escrowed payload; when the device returns a CMS-wrapped personal
recovery key, decrypting it with the FileVault escrow certificate remains an operator step.

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

## Tenant export and import

Tenant owners can download a versioned JSON bundle and import it as a new tenant.
The bundle contains profile/branding, groups, policies and configuration,
application metadata, enrollment settings and pre-registrations. It never contains
APNs/SCEP private keys, token hashes, passwords/sessions or R2 object bytes.

```bash
# Export (owner only). Add ?includeAudit=true to include recent audit entries.
curl -s "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/export" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -o tenant-bundle.json

# Import as a new tenant owned by the token's user.
curl -s -X POST "$MATTRAX_URL/api/v1/tenants/import" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H 'content-type: application/json' \
  --data-binary @tenant-bundle.json
```

The import response reports the new `tenantId`, the derived `slug` and counts for
groups, policies, applications and pre-registrations. Members, devices, audit
history and SCEP certificates are not imported. Bundles are capped at 8 MB; if the
exported slug is taken the server appends `-2`, `-3`, and so on. See
[Self-hosting → Backups](../self-hosting#backups) for the full database/R2 backup
and restore checklist.

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
