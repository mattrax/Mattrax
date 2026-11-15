# Identity and access

Mattrax supports Entra ID single sign-on, Entra directory sync and SCIM 2.0 provisioning.
They are independent: use SSO for sign-in, and either Graph sync or SCIM for users and
groups.

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
4. Choose whether to create members on first sign-in.

The MFA requirement is not part of this form any more: it is a tenant property under
**Settings → Identity → Multi-factor authentication**, so a tenant that signs in with
passkeys can require it without configuring an IdP.

New accounts verify their address with a six-digit email code before the dashboard or any
tenant API is available, and an address cannot be changed until the current one is verified.
Users sign in from the login page with their work email or the SSO button. The OIDC flow
validates state, issuer and audience; the Entra object id maps to a local user.

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

Mattrax can sync users, groups and domains from Entra on a schedule.

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

Roles accepted on user create are `owner`, `admin` and `member`; anything else becomes
`member`.

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
