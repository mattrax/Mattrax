# Identity and access

Mattrax supports Entra ID single sign-on, Entra and Google Workspace directory sync,
and SCIM 2.0 provisioning. They are independent: use SSO for sign-in, and any directory
sync (or SCIM) for users and groups.

Directory sync providers are separate packages attached to a small core registry
(`@mattrax/directory-sync`). The shared pipeline owns lease/leaver semantics — disable,
never delete, and keep device links — while each provider package owns authentication,
discovery, deep links and configuration validation. Today the registry contains
Microsoft Entra ID and Google Workspace. If two providers know the same address, the provider
that already owns the directory row keeps it (a manual or SCIM row may be adopted), so
enabling a second provider does not churn the first provider's people.

## Entra ID SSO

### App registration

1. Create a Microsoft Entra app registration.
2. Add a **Web** redirect URI: `<ORIGIN>/api/v1/sso/azure/callback`.
3. Create a client secret.
4. Set `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` on the API Worker.

### Tenant configuration

1. Open **Settings → Identity → Single sign-on**.
2. Enter the Entra tenant id.
3. Enable SSO.
4. Choose whether to create an account and membership on first sign-in.

Clearing the Entra tenant id (or replacing it with another directory) unlinks the tenant
and, best-effort, revokes this app's delegated admin consent in the old directory. Mattrax
finds its own service principal by app id and deletes only the OAuth2 permission grants
whose client is that service principal; a missing service principal or grant counts as
already revoked. The local unlink succeeds even if Graph rejects the cleanup, and the
dashboard reports whether consent was revoked, skipped (no Graph credentials, or the link
was never verified by a sync or sign-in) or failed. The service-principal lookup uses
`Directory.Read.All` (already required for directory sync) or `Application.Read.All`; the
deletion uses `DelegatedPermissionGrant.ReadWrite.All`. Consent granted to a different
application, application role assignments and tenant-wide policies cannot be revoked this
way and must be removed by an Entra administrator.

The MFA requirement is not part of this form any more: it is a tenant property under
**Settings → Identity → Multi-factor authentication**, so a tenant that signs in with
passkeys can require it without configuring an IdP.

New accounts verify their address with a six-digit email code before the dashboard or any
tenant API is available, and an address cannot be changed until the current one is verified.
Accounts sign in from the login page with their work email or the SSO button. The OIDC flow
validates state, issuer and audience; the Entra object id maps to a local account. SSO
first-sign-in provisioning creates an **account**, never a directory user.

### Verified domains

Domains come from Microsoft Graph:

```text
GET  /api/v1/tenants/:tenantId/identity/domains
POST /api/v1/tenants/:tenantId/identity/domains/refresh
```

They determine which email domains route to the tenant's SSO.

### Require MFA

**Settings → Identity → Multi-factor authentication** turns on `organization.require_mfa`.
It is independent of SSO and applies to **every role** — members and auditors included —
so read access is protected too. A member without a factor gets a 403 on tenant APIs but
keeps access to their own account settings to enrol one, and enabling the requirement is
refused while any member still lacks a factor. Changing it needs a step-up and is audited.
See [Security](/manage/security#tenant-mfa-requirement).

### Approving a co-owner's account recovery

If a co-owner loses every passkey, they can prove control of their verified email address
and ask for approval. Every other owner receives an approval link that opens this page
with an **Approve an account recovery** panel. Approving needs your own step-up, and the
person being recovered cannot approve it themselves. See
[Security](/manage/security#break-glass-account-recovery).

## Directory sync

Mattrax can sync directory users, groups and domains from Entra on a schedule. Sync
provisions tenant-scoped **users** only: it never creates dashboard accounts, memberships,
invitations or SSO identity links.

1. Grant the Graph application permissions:
   - `Directory.Read.All`
   - `Group.Read.All`
2. Open **Settings → Identity → Directory sync**.
3. Choose **Off**, **Hourly**, **Daily** or **Weekly**.
4. Run a sync now to seed the delta cursors.

Behaviour:

- Graph delta queries for users and groups.
- Tenant-scoped lock with a 15-minute stale takeover.
- Each page applied in its own transaction.
- Delta cursor persisted per resource class as soon as it completes.
- Failures record `lastError`, set `status: error` and leave the previous cursor usable.
- The hourly cron sweeps due tenants; the daily maintenance job also runs due syncs.

Endpoints:

```text
GET/PATCH /api/v1/tenants/:tenantId/identity/directory
POST      /api/v1/tenants/:tenantId/identity/directory/sync
```

### Google Workspace

Google sync imports users (including suspended and deleted accounts) and groups with
memberships. It authenticates with a service account and domain-wide delegation; it
never mutates the Workspace directory.

#### Google Cloud and Workspace setup

1. Create a Google Cloud service account and download a JSON key.
2. Enable the **Admin SDK API** for the project.
3. In Google Admin → **Security → API controls → Domain-wide delegation**, authorise the
   service account's client id for:
   - `https://www.googleapis.com/auth/admin.directory.user.readonly`
   - `https://www.googleapis.com/auth/admin.directory.group.readonly`
4. Choose a Workspace super-admin for the service account to impersonate.

The sync calls `users.list` with `showDeleted=true`, so a deleted account is disabled
locally and loses its directory memberships; its device links are kept for correlation
and history. Suspended and archived accounts are disabled the same way.

#### Credentials: tenant or deployment

Both modes are supported. Tenant credentials take precedence.

**Tenant-scoped (recommended for a multi-tenant deployment).** Open **Settings → Identity
→ Directory sync → Google Workspace → Configure credentials** and paste the JSON key plus
the admin email. Saving validates the key with one small directory read, then seals the
JSON with the deployment `AUTH_SECRET` (AES-256-GCM, `@mattrax/crypto`). The API never
returns the JSON or the private key; only the service account's `client_email` is
stored in the clear for display. Removing the key clears it and stops automatic sync
until it is saved again.

**Deployment-wide (self-hosted "configure once").** Set:

```text
GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON   # the full JSON key file
GOOGLE_WORKSPACE_ADMIN_EMAIL            # super-admin to impersonate
GOOGLE_WORKSPACE_CUSTOMER               # optional; defaults to my_customer
```

A tenant without a sealed key uses these. A malformed deployment value disables the
fallback at boot and is logged without echoing the document.

#### Sync behaviour and endpoints

```text
GET/PATCH  /api/v1/tenants/:tenantId/identity/directory/google
PUT/DELETE /api/v1/tenants/:tenantId/identity/directory/google/credentials
POST       /api/v1/tenants/:tenantId/identity/directory/google/sync
```

- The Directory API exposes no delta/sync token, so every run is a **bounded full
  listing**. Rows are compared before writing: an unchanged person does not get a new
  `updated_at`, and a person absent from an authoritative listing is disabled.
- Users paginate with `nextPageToken`; group memberships are fetched per non-empty
  group, two groups at a time. Both are bounded to 100 pages per resource.
- `429`, `403 rateLimitExceeded/userRateLimitExceeded/quotaExceeded` and `5xx` responses
  retry with `Retry-After` or exponential backoff (four attempts by default). Rate-limit
  and upstream failures are recorded in `lastError`; the previous directory state is
  kept.
- The tenant-scoped lock has the same 15-minute stale window as Entra.
- The hourly cron sweeps due tenants; the daily maintenance job runs due syncs too.
  `MAINTENANCE_GOOGLE_SYNC_CONCURRENCY` bounds parallel tenants (default 2).
- The user view links to Google Admin by Workspace id; SCIM and manual people have no
  portable admin URL and show none.

#### Google sign-in

Google Workspace **directory sync does not enable Google SSO**. Dashboard and enrollment
sign-in need a Google OAuth/OIDC client, ID-token verification (issuer, audience,
signature and `hd`/domain checks) and a tenant SSO binding — none of which the
service-account sync provides. The provider therefore exposes the verified directory
profile (`resolveProfile`) for a future link flow but reports `ssoSignIn: false`; the
dashboard refuses to link a Google user for SSO rather than promise a sign-in that
cannot happen. Entra SSO is unchanged.

### Choosing members in bulk

On **Settings → Identity → Directory sync**, the synced user list has checkboxes
once at least one directory group exists. Select users, choose a group and use
**Add to group**. Adding is idempotent: users already in the group count as
successful. Rows the server cannot resolve stay selected and the toast names each
failure.

A synced group is refreshed from provider-reported changes. Graph sync applies
deltas rather than replacing the whole membership, so a manual addition normally
stays until the provider reports a change for that user; SCIM may replace a
group's membership when the IdP sends a full membership replacement. Use a
provider-side group change when the membership must be durable.

The bulk action requires `members.write`, because directory-group membership also
drives user-scoped policy and application reach. Each bulk change wakes the
affected users' linked devices and writes one audit entry with the requested,
updated and failed counts and a bounded list of user ids.

## SCIM 2.0

SCIM is an alternative to Graph sync and works with any compatible IdP.

### Create a token

1. Open **Settings → Identity → SCIM tokens**.
2. Create a token and copy it once.

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/scim-tokens" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Okta" }'
```

Response:

```json
{
  "id": "...",
  "name": "Okta",
  "token": "scim_...",
  "baseUrl": "https://e.mattrax.app/scim/v2/<tenantId>"
}
```

### Surface

| Method             | Path                            |
| ------------------ | ------------------------------- |
| `GET`              | `/scim/v2/:tenantId`            |
| `GET/POST`         | `/scim/v2/:tenantId/Users`      |
| `GET/PATCH/DELETE` | `/scim/v2/:tenantId/Users/:id`  |
| `GET/POST`         | `/scim/v2/:tenantId/Groups`     |
| `GET/PATCH/DELETE` | `/scim/v2/:tenantId/Groups/:id` |

Authentication is `Authorization: Bearer <scim token>`. Tokens are hashed and scoped to
one tenant. Revoked or unknown tokens are rejected.

SCIM provisions tenant-scoped **users** for policy scoping and device links. It cannot
grant dashboard roles: administrator accounts are created by registration, invitation or
the tenant's SSO auto-provision setting.

### Limitations

- Filters, sorting and ETags are not supported.
- `PATCH` is supported; `bulk` is not.
- Group membership maps to directory groups, not tenant roles.
- There is no CSV user import.

## API endpoints

| Method      | Path                                                 |
| ----------- | ---------------------------------------------------- |
| `GET/PATCH` | `/api/v1/tenants/:tenantId/sso`                      |
| `GET/PATCH` | `/api/v1/tenants/:tenantId/identity/directory`       |
| `POST`      | `/api/v1/tenants/:tenantId/identity/directory/sync`  |
| `GET`       | `/api/v1/tenants/:tenantId/identity/domains`         |
| `POST`      | `/api/v1/tenants/:tenantId/identity/domains/refresh` |
| `GET/POST`  | `/api/v1/tenants/:tenantId/scim-tokens`              |
| `DELETE`    | `/api/v1/tenants/:tenantId/scim-tokens/:tokenId`     |

## Next

- [Entra ID for Windows](/platforms/windows/entra-id)
- [Security](/manage/security)
