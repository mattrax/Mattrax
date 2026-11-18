# Entra ID

Entra ID appears in three places in Mattrax:

1. **Dashboard SSO** — sign in to Mattrax with an Entra account.
2. **Windows federated enrollment** — Windows can use Entra instead of on-premises WSTEP
   authentication.
3. **Autopilot and directory sync** — Graph provides Autopilot devices/profiles, users,
   groups and verified domains.

Each one uses the same app registration but different permissions.

## App registration

Create a Microsoft Entra app registration:

1. **Authentication → Add a platform → Web**.
2. Redirect URI: `<ORIGIN>/api/v1/sso/azure/callback`.
3. Create a client secret.
4. Copy the **Application (client) ID**, **Directory (tenant) ID** and secret.

Set these on the API Worker:

```bash
cf workers secrets update AZURE_CLIENT_ID --worker mattrax-api --type secret_text --text '...'
cf workers secrets update AZURE_CLIENT_SECRET --worker mattrax-api --type secret_text --text '...'
```

### Graph permissions

Grant application permissions and admin consent for the features you use:

| Permission                                    | Used for                            |
| --------------------------------------------- | ----------------------------------- |
| `Directory.Read.All`                          | Users, groups and verified domains  |
| `Group.Read.All`                              | Group assignment and directory sync |
| `DeviceManagementServiceConfig.ReadWrite.All` | Autopilot profiles and imports      |
| `DeviceManagementManagedDevices.Read.All`     | Autopilot device sync               |

A missing permission surfaces as `ConsentRequired` with the Graph error.

## Dashboard SSO

1. Open **Settings → Identity → Single sign-on**.
2. Enter the Entra tenant id.
3. Enable SSO.
4. Optionally enable **Create accounts on first sign-in**.
5. Optionally require MFA for owners and admins.

Administrators sign in from the login page with their work email or the SSO button.
Mattrax validates the OIDC flow and maps the Entra object id to a local account. Accounts
without a local invitation are created only when auto-provisioning is on. Directory sync is
separate and only maintains tenant users for device policy.

Verified domains are shown under **Settings → Identity → Domains**. They come from Graph
and determine which email domains route to the tenant's SSO.

### Require MFA

`requireMfa` blocks owners and admins without an authenticator app or passkey from the
tenant's APIs with a 403. Accounts keep read access. The account page prompts the user to
enroll a factor.

## Directory sync

Mattrax can sync users, groups and domains from Entra on a schedule.

1. Configure the Graph app.
2. Open **Settings → Identity → Directory sync**.
3. Choose **Off**, **Hourly**, **Daily** or **Weekly**.
4. Run a sync now to seed the cursors.

Sync uses Graph delta queries, a tenant-scoped lock with a 15-minute stale takeover, and
per-page transactions. A failure records `lastError`, sets `status: error` and leaves the
previous cursor usable. The hourly cron sweeps due tenants; the daily maintenance job runs
it too, so a single-cron deployment still syncs.

Endpoints:

```text
GET/PATCH /api/v1/tenants/:tenantId/identity/directory
POST      /api/v1/tenants/:tenantId/identity/directory/sync
GET       /api/v1/tenants/:tenantId/identity/domains
POST      /api/v1/tenants/:tenantId/identity/domains/refresh
```

### SCIM instead of Graph

If you do not want Graph directory sync, use SCIM 2.0:

- Create a SCIM token under **Settings → Identity → SCIM tokens**.
- Configure your IdP with the base URL and token.
- Users and groups are provisioned over `/scim/v2/:tenantId/Users` and `/Groups`.

See [Identity and access](/admin/identity) for the full SCIM surface.

## Windows federated enrollment

By default Windows uses `OnPremise` authentication and WSTEP certificates. Federated mode
lets Windows authenticate with an Entra token.

Requirements:

- The tenant has an Entra tenant id in its SSO configuration.
- `WINDOWS_FEDERATED_AUDIENCE` is set (defaults to `AZURE_CLIENT_ID`).
- The Windows client offers `Federated` in its discovery auth policies.

When enabled, the tenant token becomes `mttxw2` and the policy/enroll requests must carry
an Entra JWT. Mattrax validates:

- Signature against the tenant JWKS
  (`https://login.microsoftonline.com/<tid>/discovery/v2.0/keys`, cached one hour)
- Issuer `https://login.microsoftonline.com/<tid>/v2.0`
- `tid`, audience, `exp` and `nbf`

A wrong tenant, issuer, audience or signature fails closed as `UnknownDevice`.

:::warning Preview
The federated handshake is fixture-tested but has not been validated against real Entra
and Windows hardware. Test in a lab tenant before a production rollout.
:::

## Autopilot join types

Autopilot profiles pass a join type to Graph:

| Join type                    | Notes                                  |
| ---------------------------- | -------------------------------------- |
| `azureADJoin`                | Standard Entra join                    |
| `azureADJoinUsingDeviceAuth` | Device-auth join                       |
| `hybridAzureADJoin`          | Only with `userDriven` deployment mode |

Mattrax does not perform the Entra join itself; Windows and Autopilot do. Mattrax creates
the deployment profile and assigns it to an Entra group.

## Limitations

- Dashboard SSO is Entra OIDC only. SAML is not implemented.
- There is no IdP group-to-role mapping; SCIM/Graph groups are for visibility and device
  targeting, not for tenant roles.
- Conditional access, compliance-based access and device registration management are not
  modelled.
- Federated WSTEP and Autopilot OOBE need real-hardware validation.
- Directory sync is application-side; large tenants may take multiple pages and runs.

## Next

- [Autopilot](/platforms/windows/autopilot)
- [Identity and access](/admin/identity)
