# Administration

Tenant administration covers identity, access, audit, webhooks, billing and backups. Most
of it lives under **Settings**.

## Tenant profile and branding

**Settings → General** controls:

- Tenant name and slug.
- Display name, support email and brand colour.
- Logo.
- Metadata.

Branding is used by the public enrollment page, Apple enrollment profiles, the DDM
organization declaration and invitation emails.

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Acme Device Management",
    "supportEmail": "it@acme.example",
    "brandColor": "#1c1917"
  }'
```

## Members and invitations

List members:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/users" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Invite:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/invitations" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "email": "admin@acme.example", "role": "admin" }'
```

Pending invitations can be listed and cancelled. Acceptance is authenticated:

```text
POST /api/v1/invitations/accept
```

Change a role or remove a member:

```text
PATCH  /api/v1/tenants/:tenantId/users/:memberId
DELETE /api/v1/tenants/:tenantId/users/:memberId
```

The last tenant user cannot be removed. Removing a member does not delete their account.

## Roles

| Role      | Read | Write | Delete |
| --------- | ---- | ----- | ------ |
| `owner`   | Yes  | Yes   | Yes    |
| `admin`   | Yes  | Yes   | No     |
| `member`  | Yes  | No    | No     |
| `auditor` | Yes  | No    | No     |

Only owners can delete a tenant, manage billing and download backups. See
[Security](/manage/security).

## Account API tokens

Tokens are created on the account, not the tenant, and can be bound to one tenant:

```text
GET    /api/v1/account/api-tokens
POST   /api/v1/account/api-tokens
DELETE /api/v1/account/api-tokens/:tokenId
```

Scopes are `read` and `write`. Tokens are shown once and stored as a SHA-256 hash.

## Tenant export and import

Export a versioned JSON bundle:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/export?includeAudit=true" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -o tenant.json
```

Import as a new tenant:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/import" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @tenant.json
```

Limits and exclusions are covered in [Audit, webhooks and billing](/admin/operations).

## Where to go next

- [Identity and access](/admin/identity) — Entra SSO, SCIM and directory sync.
- [Audit, webhooks and billing](/admin/operations) — audit export, webhook signing,
  Stripe and backups.
- [Security](/manage/security) — MFA, passkeys and step-up.
