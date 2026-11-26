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
organization declaration, invitation emails, ownership-transfer emails and the
one-week onboarding follow-up. Account email sent before a new account belongs
to a tenant (welcome, verification and recovery) uses deployment branding from
`MATTRAX_BRAND_NAME`, `MATTRAX_BRAND_LOGO_URL` and `MATTRAX_BRAND_COLOR`
(Mattrax defaults when unset) plus the account address.

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

The last tenant account cannot be removed. Removing an administrator from a tenant does
not delete their dashboard account, and does not touch the tenant's directory users,
their device links or their user policies. Use **Settings → Administrators** to leave a
shared tenant; account deletion is the separate, self-service flow below.

### Deleting your account

**Account → Delete account** deletes the dashboard account _and_ the tenant it owns.
The button opens an email dialog, then navigates to `/account/delete` as a separate page.
That page lists the tenant, its member and device counts, and every effect of the cascade.
The email is typed again there, then acknowledged, before the destructive button is
enabled.

The API enforces the same rules as the page:

```text
GET    /api/v1/me/deletion   preview: canDelete, blockers, tenant, lastAccount
DELETE /api/v1/me            body: { "confirmEmail": "owner@example.com" }
```

Deletion is allowed only when the account is the **sole member and sole owner of at most
one tenant**, and that tenant has no `tenant.delete` four-eyes policy. An account with
no tenant can always be deleted. Otherwise the account is kept and the response explains
why:

- `multiple_tenants` — leave every other tenant first, so one deletion cannot affect two
  organisations.
- `tenant_has_other_owners` — remove your own administrator access first.
- `tenant_has_other_members` — remove or transfer the other members; the tenant is
  deleted with the account.
- `tenant_owner_required` — transfer ownership before deleting the account.
- `tenant_delete_requires_approval` — use the explicit tenant delete so another
  administrator can approve it.

A successful deletion runs the same teardown as `DELETE /api/v1/tenants/:tenantId`:
devices are sent an unenroll request, the subscription is cancelled, tenant objects are
removed, and the tenant row cascades. An `account.deleted` audit entry records the email
snapshot, the tenant ids and names, and whether this was the deployment's last account.
The audit entry outlives the account. Deleting the last account leaves the deployment with
nobody signed in; registration remains open, and a new account can create a fresh tenant.

### Signed-in visitors on public pages

On marketing pages, a signed-in visitor's main call to action becomes **Open dashboard**
and the sign-in/register links are hidden. The login and registration pages keep their
forms; their cross-link becomes **Open dashboard**, and the sign-up warning explains that
a second account needs a fresh sign-in.

## Scope tags

**Settings → Scope tags** carves a tenant into regions or teams. Tag devices,
groups, policies, applications, scripts and dashboards, then give an
administrator only the tags they should reach. A member with no tags is
unscoped and sees the whole tenant; a resource with no tag is tenant-wide and is
only visible to unscoped administrators. Owners always stay unscoped.

The model, defaults, limits, audit actions and upgrade behaviour are documented
in [Roles and permissions](./rbac.md#scope-tags). Bulk tagging is available from
a list's selection bar, and an invitation can carry the new member's starting
tags.

## Onboarding email

Mattrax sends two transactional onboarding emails from
`hello@mattrax.cloud`, displayed as **"Oscar from Mattrax"**. Replies go to
`MATTRAX_ONBOARDING_REPLY_TO` (default `oscar@otbeaumont.me`), never a
`no-reply` mailbox.

- **Welcome** — one email per manual account, sent after the address is
  verified. It explains what Mattrax is and gives the real order of work for a
  tenantless account: create a tenant, set a policy, then enrol a device. It
  links to tenant creation, the dashboard and the getting-started quick start,
  and includes the account address plus support and unsubscribe details where
  configured. It does not link to an enrollment page before a tenant exists.
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

### Presentation and accessibility

Both emails use the dashboard's visual language: a warm page, a white card,
hairline borders, brand-coloured primary actions whose text is chosen for at
least 4.5:1 contrast, and purple links. The header shows a coloured brand mark
and wordmark, and adds the deployment or tenant logo when one is set. Account
email before a tenant exists uses the deployment brand; invitation,
ownership-transfer and follow-up mail use the tenant brand.

Email logos must resolve to an absolute `https` image. Root-relative paths are
resolved against `ORIGIN`; `data:` URLs are accepted by tenant branding for the
dashboard and enrollment page but are not used in email because clients commonly
block them. The logo is decorative (`alt=""`) because the wordmark carries the
accessible brand name; the header keeps the text mark and wordmark when images
are blocked. A logo sits on a white chip so dark artwork remains visible in dark
mode. Clients that honour CSS keep the original aspect ratio; Outlook falls back
to the fixed 120×28 box so a wide logo cannot overflow the card.

The HTML is table-based with inline styles for Outlook and always ships a
plain-text alternative; the welcome copy is rendered into both bodies from one
definition. It declares `color-scheme: light dark`
with `prefers-color-scheme` and Outlook.com `[data-ogsc]` overrides. Apple Mail
and Outlook.com apply those overrides; Gmail follows its own dark theme and may
not. Long and right-to-left names are isolated and allowed to wrap. Support
addresses, unsubscribe links and optional tenant branding are escaped before
rendering.

### Previewing onboarding email

Enable the development mailbox and register a local account:

```bash
DEV_MAILBOX=true pnpm web dev
```

`GET http://localhost:9050/api/debug/emails` returns the rendered messages,
including `html` and `text`. To re-run the bounded welcome backstop and follow-up
sweep without waiting for the scheduler:

```bash
curl -X POST http://localhost:9050/api/debug/onboarding-emails
```

Both routes are loopback-only unless `DEV_MAILBOX_ALLOW_REMOTE` and
`DEV_MAILBOX_SECRET` are set. Never enable the mailbox in production.

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
