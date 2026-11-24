# Administration

Tenant administration covers identity, access, audit, webhooks, billing and backups. Most
of it lives under **Settings**.

## Tenant profile and branding

**Settings → General** controls:

- The tenant ID (read-only): the stable identifier the API and enrollment use.
- Tenant name and slug.
- Display name, support email and brand colour.
- Logo.
- Metadata.

Backups live on their own **Settings → Backups** page, between Administrators
and Approvals in the rail. Exporting and importing a tenant bundle, and moving a
deployment, are under **Settings → Migration → Export / import**.

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

## Accounts and invitations

List the tenant's administrator accounts:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/accounts" \
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

Change a role or remove an administrator:

```text
PATCH  /api/v1/tenants/:tenantId/accounts/:accountId
DELETE /api/v1/tenants/:tenantId/accounts/:accountId
```

The last tenant account cannot be removed. Removing an account does not delete the
account itself, and does not touch the tenant's directory users, their device links or
their user policies.

## Onboarding email

Mattrax sends two transactional onboarding emails from
`hello@mattrax.cloud`, displayed as **"Oscar from Mattrax"**. Replies go to
`MATTRAX_ONBOARDING_REPLY_TO` (default `oscar@otbeaumont.me`), never a
`no-reply` mailbox.

- **Welcome** — one email per manual account, sent after the address is
  verified. It links to the dashboard and the first-device enrollment step.
  Directory-provisioned SCIM/Graph accounts never receive it.
- **One-week follow-up** — one private email per verified tenant owner/admin,
  sent by the daily scheduler once the tenant is at least seven days old (and
  still inside the window, by default up to fourteen days old) and no device has
  enrolled. An enrolled device, an enrollment in progress in the last 24 hours,
  or a successful enrollment attempt suppresses it. Pre-registered
  ABM/Autopilot devices do not count as enrolled. Each message is addressed to
  one person, so admins never see each other's addresses.

Both are claimed atomically before sending and are never repeated, including
when verification is retried or a sweep runs again. A provider failure that
leaves every recipient unsent clears the claim so the next bounded sweep can
retry; a partial delivery keeps the tenant marked. Tenants without a verified
owner/admin stay unmarked, so the email is delivered when an owner is added
later.

Operators can disable the follow-up with `MAINTENANCE_ONBOARDING_EMAILS=false`,
move the eligibility window with `MAINTENANCE_ONBOARDING_FOLLOW_UP_DAYS` and
`MAINTENANCE_ONBOARDING_WINDOW_DAYS`, and prevent historical tenants from being
emailed with `MATTRAX_ONBOARDING_SINCE`. See
[Configuration](/operations/configuration).

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

Tokens can be narrowed to any subset of the tenant permission catalogue (the
same groups used by custom roles), so a monitoring key can hold only
`devices.read` or a deployment key only `devices.write` and `policies.read`.
`read`/`write` remain supported as broad scopes for older clients. Tokens are
shown once and stored as a SHA-256 hash; the effective grant is the
intersection of the token's permissions and the account's role in each tenant.

## Appearance

**Account → Appearance** picks the colour theme: **System** (the default, follows
`prefers-color-scheme` and updates live when the OS changes), **Light** or **Dark**.
The choice applies immediately to the dashboard, the landing page, the auth pages and
the public enrollment page (which keeps its own light card by design).

The preference is stored per account in this browser and mirrored to a device-wide
key so pre-auth pages and the very first paint use the same theme. It is resolved by
an inline script in `<head>` before the stylesheet paints, so there is no flash of the
wrong theme, and `color-scheme` plus the mobile `theme-color` follow it. Changing the
theme in one tab updates the others through the same `storage` event.

Cross-device sync is not implemented yet: the preference lives in this browser's
storage, keyed by account id, so signing in on a second device starts from `system`.
Persisting it on the account uses the account `defaultTenantId` and a `PATCH /v1/me` field; that is
deliberately deferred so this change needs no migration.

The palette is a semantic token layer over [Radix Colors](https://www.radix-ui.com/colors):
components use `bg-card`, `text-muted-foreground` and `bg-brand-solid`, and never a raw
colour. Text contrast is checked at WCAG AA in both themes, `prefers-contrast: more`
re-points borders and secondary text at Radix's stronger steps, and `apps/web/src/styles/theme-literals.test.ts`
fails the build if a component reintroduces a `white/[0.06]`, `#rrggbb` or `rgb()`
literal.

## Tenant export and import

Export a versioned JSON bundle from **Settings → Migration → Export / import**, or
directly from the API:

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
