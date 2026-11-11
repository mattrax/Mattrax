# Enterprise overview

Mattrax Enterprise is the organisation-scoped product layer: tenants, members, devices,
groups, policies, APNs configuration, billing and API tokens. In this repository it is
implemented by `packages/enterprise-backend`, defined by `packages/enterprise-domain`, and
served by the Cloud API Worker (`apps/api`) at `/api/v1`.

The whitelabel gateway does **not** import or expose Enterprise. If you are building your
own product on the gateway, see [Whitelabel](../whitelabel/).

## Core concepts

| Concept       | Meaning                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| Tenant        | An organisation boundary. Devices, groups, policies, APNs, members, billing and enrolment belong to a tenant. |
| User          | A signed-in person. A user can belong to more than one tenant.                                                |
| Member        | The relationship between a user and a tenant. The member role controls access.                                |
| Invitation    | A pending email invitation to join a tenant.                                                                  |
| Enrollment    | Tenant-owned settings controlling which platforms can enrol, the optional password, and the device cap.       |
| Device        | An enrolled endpoint. Apple is functional; Windows is preview; Android has no backend.                        |
| Group         | A collection of devices and policies. Policies become effective through group assignment.                     |
| Policy        | A named management intent containing configurations.                                                          |
| Configuration | A typed payload inside a policy, stored by `kind`.                                                            |
| APNs          | The Apple push certificate and MDM topic required for Apple management.                                       |
| Billing       | The tenant's plan, subscription status, and billable enrolled-device count.                                   |

## Tenancy and roles

Most API routes are scoped by `tenantId`. The backend checks that the authenticated user
is a member of that tenant before returning data, so knowing a tenant id is not enough to
read it.

| Role      | Read | Write (devices, groups, policies, settings) | Delete tenant |
| --------- | ---- | ------------------------------------------- | ------------- |
| `owner`   | Yes  | Yes                                         | Yes           |
| `admin`   | Yes  | Yes                                         | No            |
| `member`  | Yes  | No                                          | No            |
| `auditor` | Yes  | No                                          | No            |

`auditor` is a read-only role intended for compliance and review access. It is
equivalent to `member` for authorization, but lets tenants label accounts that
must never be granted write access. There is no device-only `operator` role:
write endpoints are not classified by resource, so a safe operator role would
require handler-level resource checks that do not exist today.

Additional rules enforced by the backend:

- Tenant deletion requires `owner` and is rejected while the tenant has more than one
  member. Remove other members first.
- Removing a member is rejected when it would remove the last tenant user.
- Invitations default to the `member` role when no role is supplied.
- Tenant-scoped API routes always carry the tenant in the path (`/api/v1/tenants/:tenantId/...`);
  there is no server-side "active tenant" state. The dashboard stores the chosen tenant in the URL.

## Billing

Billing is tenant-scoped and backed by Stripe. `GET /api/v1/tenants/:tenantId/billing`
returns:

| Field               | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `plan`              | Subscription plan identifier, when present.                    |
| `status`            | Stripe subscription status.                                    |
| `subscriptionId`    | Stripe subscription id.                                        |
| `billableDevices`   | Devices currently in the `enrolled` state.                     |
| `periodEnd`         | End of the current billing period (ISO 8601), when present.    |
| `cancelAtPeriodEnd` | Whether Stripe will cancel the subscription at period end.     |
| `configured`        | `false` when Stripe credentials are absent on this deployment. |

`POST /api/v1/tenants/:tenantId/billing/portal` returns a Stripe billing-portal URL so an
owner or admin can manage payment details. When billing is not configured the summary still
loads with `configured: false`, and the portal returns a `502 EnterpriseStripeError` instead
of an unhandled server error.

### Stripe webhooks

`POST /api/v1/billing/webhook` is unauthenticated but verifies the `Stripe-Signature` header
with `STRIPE_WEBHOOK_SECRET`. Configure Stripe to send at least:

- `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`
- `invoice.paid`, `invoice.payment_failed`

Each event is resolved to exactly one tenant through `metadata.organizationId` or the
organization's `stripeCustomerId`. Unknown or conflicting mappings are rejected. Subscription
events upsert the tenant's `subscription` row; deletions mark it `canceled` and keep history.
Replays are safe.

Stripe provisioning is optional. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
`STRIPE_DEVICE_MONTHLY_PRICE_ID` in the Cloud API environment to enable it. Self-hosted
whitelabel does not include billing.

## API tokens

API tokens authenticate as a user and can be scoped to read-only access and/or a
single tenant. Tenant membership and role checks still apply to every request, so
a token never grants more access than its owner has. A token created before
scoping existed reports `["read", "write"]` and is not bound to a tenant.

| Scope   | Meaning                                                   |
| ------- | --------------------------------------------------------- |
| `read`  | Read tenant data.                                         |
| `write` | Read and mutate tenant data (subject to the user's role). |

| Operation | Endpoint                                     |
| --------- | -------------------------------------------- |
| List      | `GET /api/v1/account/api-tokens`             |
| Create    | `POST /api/v1/account/api-tokens`            |
| Revoke    | `DELETE /api/v1/account/api-tokens/:tokenId` |

Create a read-only token bound to one tenant:

```bash
curl -X POST https://mdm.example.com/api/v1/account/api-tokens \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer mtx_...' \
  -d '{
    "name":"ci",
    "expiresAt":"2027-01-01T00:00:00.000Z",
    "scopes":["read"],
    "tenantId":"'"$TENANT_ID"'"
  }'
```

Omit `scopes` to create a full read/write token and omit `tenantId` to allow all
tenants the user belongs to. `scopes: []` is rejected.

Scoped requests behave as follows:

- A token bound to tenant A receives `404 EnterpriseNotFound` for tenant B, even
  if its owner is a member of B.
- A `read`-only token receives `403 EnterpriseForbidden` for write/delete
  endpoints.
- An API token cannot mint another token with broader scopes or a different
  tenant than its own.

The raw token is returned **once**. Mattrax stores only its SHA-256 hash and a short
prefix (`mtx_...`) for display. Send it as:

```http
Authorization: Bearer mtx_...
```

Tokens can expire and can be revoked. `lastUsedAt` is updated on use. A revoked or expired
token is treated as unauthenticated.

See [API and OpenAPI](./api) for the generated reference and request conventions.

## Devices

A device has a protocol, lifecycle status, inventory fields, and editable operator fields.

| Protocol  | Status                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| `apple`   | Supported: enrolment, SCEP, MDM check-in, DDM configurations, APNs.                          |
| `win`     | Preview: WSTEP enrollment and SyncML check-in; policy management is next.                    |
| `android` | Not implemented. The protocol value exists in the schema but there is no management backend. |

| Status        | Meaning                             |
| ------------- | ----------------------------------- |
| `enrolling`   | Enrolment started but not complete. |
| `enrolled`    | Actively managed and billable.      |
| `unenrolling` | Unenrolment requested.              |
| `unenrolled`  | No longer actively managed.         |

Operators can update `name`, `notes`, and `assetTag`. Unenrolment sets an enrolled device
to `unenrolling`; the protocol-specific removal is completed by the management layer.

::: warning Device actions
`POST /api/v1/tenants/:tenantId/devices/:id/action` exists in the contract but currently
performs no action. Remote lock, wipe and restart are not implemented.
:::

## Enrolment

An enrolment controls how devices join a tenant:

| Setting           | Meaning                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `code`            | Optional password required before platform options are shown.        |
| `enabledApple`    | Enables Apple enrolment. Requires a configured APNs topic.           |
| `enabledWindows`  | Enables Windows enrollment and the tenant-scoped discovery URL.      |
| `enabledAndroid`  | Enables the Android tab. No working backend.                         |
| `enabledAssetTag` | Legacy flag. Asset tags are edited per device or imported by serial. |
| `maxDevices`      | Device cap. Use a high value for a large fleet.                      |

The public data endpoint is:

```text
GET /api/v1/enrollment/:id?code=<optional-password>
```

The dashboard enrollment page is `/enroll/:id`. The response returns per-platform state:
a profile, `"available"`, or an error explaining why the platform is disabled or missing
APNs.

Apple profiles are installed from the public, cache-busted download endpoint rather than
a `data:` URI:

```text
GET /api/v1/enrollment/:id/apple.mobileconfig?code=<optional-password>
```

It returns `application/x-apple-aspen-config` with an attachment filename and performs
the same password, platform, APNs-topic, device-cap and SCEP checks as the data
endpoint. The endpoint is rate-limited per IP. The dashboard renders the enrollment URL
as a QR code; the QR code never contains the enrollment password.

Resetting the enrolment id invalidates the old link. Existing devices remain enrolled.

Windows uses the same public endpoint but returns a separate, tenant-scoped discovery URL:

```text
POST /mdm/windows/discovery?tenant=<signed-tenant-token>
```

The token is HMAC-signed with `AUTH_SECRET`, contains the tenant id plus issue and expiry
times, and is verified in constant time. Discovery returns policy and enrollment URLs that
carry the same token; policy and enrollment resolve the organization from it, and the
WSTEP token is bound to that tenant. Each tenant therefore has a distinct Windows URL, and
a token for one tenant is rejected by another tenant's endpoints. Tokens expire, so a
device that was offline for longer than the link lifetime must be given a fresh URL from
the enrollment page. `WINDOWS_ORGANIZATION_ID` is only a legacy single-tenant fallback.

### Windows Autopilot

When Microsoft Graph credentials (`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`) and a
tenant Entra id are configured, **Settings → Management → Windows Autopilot**
imports hardware hashes, syncs `windowsAutopilotDeviceIdentities`, creates
deployment profiles and assigns a profile to an Entra group. Graph is the source
of truth; `autopilot_device` and `autopilot_profile` are tenant-scoped caches.
Device rows are linked to `device` by normalised serial, so the device detail
page can show Autopilot profile/enrollment state once the device checks in.

| Endpoint                                                              | Access      |
| --------------------------------------------------------------------- | ----------- |
| `GET /api/v1/tenants/:tenantId/autopilot`                             | Read        |
| `GET /api/v1/tenants/:tenantId/autopilot/devices`                     | Read        |
| `POST /api/v1/tenants/:tenantId/autopilot/import`                     | Owner/admin |
| `POST /api/v1/tenants/:tenantId/autopilot/sync`                       | Owner/admin |
| `DELETE /api/v1/tenants/:tenantId/autopilot/devices/:serial`          | Owner/admin |
| `GET /api/v1/tenants/:tenantId/autopilot/profiles`                    | Read        |
| `POST /api/v1/tenants/:tenantId/autopilot/profiles`                   | Owner/admin |
| `PATCH /api/v1/tenants/:tenantId/autopilot/profiles/:profileId`       | Owner/admin |
| `POST /api/v1/tenants/:tenantId/autopilot/profiles/:profileId/assign` | Owner/admin |

Required Graph application permissions are
`DeviceManagementServiceConfig.ReadWrite.All`,
`DeviceManagementManagedDevices.Read.All`, `Group.Read.All` and
`Directory.Read.All`. Imports are capped at 500 rows / 1 MB and fail before any
local write if Graph rejects them. Hardware hashes are never returned by list
APIs. See [Production readiness](../production-readiness#windows-autopilot-and-federated-entra-enrollment)
for the full permission, security and real-device checklist.

### Federated Entra enrollment

Windows discovery chooses `AuthPolicy: Federated` only when the client offered
it, the tenant has an Entra id and `WINDOWS_FEDERATED_AUDIENCE` (or
`AZURE_CLIENT_ID`) is configured. Discovery returns the tenant-specific Entra
STS URL (`https://login.microsoftonline.com/<tenantId>/wsfed`, overrideable) and
mints a federated-mode tenant token (`mttxw2`). Policy and enrollment then
require an Entra JWT and validate its signature against the tenant JWKS, issuer,
`tid`, audience, `exp` and `nbf`. A token for another tenant, an invalid
signature, or an opaque credential in a federated flow fails closed with
`UnknownDevice`.

OnPremise discovery and enrollment are unchanged for the same tenant: a v1
tenant token keeps using the signed WSTEP flow. The federated handshake is
fixture-tested; real Entra/Windows validation remains a preview gap.

## Device pre-registration

Administrators can import devices before they enroll from **Devices → Import CSV**. The
CSV columns are `serial,name,asset_tag,group,notes`; `serial` is required, headers are
case-insensitive, and at most 1000 rows can be imported at once. Rows are validated in a
preview before anything is sent.

| Endpoint                                                         | Access      |
| ---------------------------------------------------------------- | ----------- |
| `GET /api/v1/tenants/:tenantId/device-pre-registrations`         | Read        |
| `POST /api/v1/tenants/:tenantId/device-pre-registrations/import` | Owner/admin |
| `DELETE /api/v1/tenants/:tenantId/device-pre-registrations/:id`  | Owner/admin |
| `DELETE /api/v1/tenants/:tenantId/device-pre-registrations`      | Owner/admin |

Imports upsert by `(tenant, serial)` and resolve groups only within the tenant. When an
Apple device sends its Authenticate check-in, Mattrax looks up the registration by
serial, applies the name, asset tag, notes and group, and records the resulting device
on the registration. Registrations also apply to an already-enrolled device row with the
same serial. A row can never apply across tenants.

Windows enrollment cannot consume pre-registrations yet: the Windows enrollment request
carries no hardware serial, so there is no reliable key to match against.

## Groups and policies

Groups connect devices and policies. Membership updates use explicit `assign` and
`unassign` lists, and the backend verifies that every referenced device and policy belongs
to the same tenant.

### Manual and dynamic groups

A group has a `kind` of `manual` (default) or `dynamic`. Manual groups keep the existing
explicit membership behaviour. Dynamic groups derive membership from a versioned rule set
stored in `rules` and materialise matches into `group_device` rows with
`source = 'dynamic'`.

```json
{
  "version": 1,
  "all": [
    { "field": "platform", "op": "eq", "value": "apple" },
    { "field": "osVersion", "op": "gte", "value": "14.4" },
    { "field": "model", "op": "contains", "value": "MacBook" }
  ],
  "none": [{ "field": "health", "op": "eq", "value": "critical" }]
}
```

`all`, `any` and `none` are optional lists: every `all` condition must match, at least one
`any` condition must match, and no `none` condition may match. Conditions support:

| Field       | Operators                      | Semantics                                                            |
| ----------- | ------------------------------ | -------------------------------------------------------------------- |
| `platform`  | `eq`                           | `apple`, `win` or `android`. `proto` is an alias.                    |
| `osVersion` | `eq`, `lt`, `lte`, `gt`, `gte` | Dotted versions compare numerically (`14.10 > 14.9`).                |
| `model`     | `contains`, `eq`               | Case-insensitive.                                                    |
| `serial`    | `prefix`, `eq`                 | Case-insensitive.                                                    |
| `assetTag`  | `prefix`, `eq`                 | Case-insensitive.                                                    |
| `staleDays` | `eq`, `lt`, `lte`, `gt`, `gte` | Days since `lastSeenAt`; the default operator is `gte`.              |
| `health`    | `eq`                           | Derived health level: `healthy`, `attention`, `critical`, `unknown`. |

Rules with no conditions match **no devices**. A condition whose device value is missing
never matches. String comparisons are case-insensitive; version comparison only treats a
value as a version when it starts with numeric segments (otherwise the comparison fails
closed).

Membership is recomputed:

- when a group is created or updated;
- when a device is created or updated, and when inventory is reported at check-in. The
  check-in path evaluates the tenant's dynamic rules for that one device, so the work is
  bounded by the number of dynamic groups, not by fleet size;
- by daily maintenance, which performs a full tenant-scoped recompute as a backstop for
  devices that never check in again.

Only `source = 'dynamic'` rows are replaced. A manually added row survives a recompute even
when the device no longer matches the rules, which lets administrators keep explicit
exceptions. Device assign/unassign calls are rejected for dynamic groups; policy
assignments remain editable. Switching a group back to `manual` drops its rule-derived
rows and keeps manual rows. `lastEvaluatedAt` records the last materialisation.

The dashboard shows a read-only rule builder, a **Dynamic** badge, and a live match preview.
The preview endpoint evaluates the rules without writing:

```text
GET /api/v1/tenants/:tenantId/groups/:groupId/preview
```

Limitations:

- Evaluation runs in application code, not SQL. A full recompute is `O(devices × dynamic
  groups)` for a tenant; per-device check-in evaluation is `O(dynamic groups)`. Health
  conditions require loading declaration rows for the evaluated devices.
- The dashboard rule builder edits the `all` list. `any`/`none` lists written through the
  API are preserved but can only be edited through the API.
- A preview reflects the last saved rules; unsaved edits are not evaluated until saved.
- Tenant export/import does not carry dynamic rule sets yet; an imported group is
  restored as a manual group.
- Dynamic groups feed the existing policy resolver, so include/exclude precedence is
  unchanged.

Each assignment has a `mode` of `include` or `exclude` (default `include`). Policies also
have an integer `priority` (default `0`, higher wins). A device receives one winning
configuration per configuration kind, resolved with these rules:

1. A direct device `exclude` removes that policy from the device, including group includes.
2. A direct device `include` beats every group include and group exclude for the same policy.
3. A group `exclude` vetoes that policy for all group delivery, so another group cannot
   reintroduce it. A direct include can still deliver it (rule 2).
4. Among included policies in the winning scope, the highest `priority` wins. Ties go to the
   most recently updated policy, then the ascending policy id.

Apple DDM/legacy delivery and Windows SyncML delivery both use this resolver, so an excluded
or overridden policy is never sent twice. Inspect the result for a device with:

```text
GET /api/v1/tenants/:tenantId/devices/:id/effective-policy
```

The response lists the resolved kinds, contributing policies, overridden policies and every
exclusion (including exclusions that removed nothing). The dashboard shows the same data in
the device's **Effective policy** card.

Policy records contain a `configurations` map keyed by configuration kind:

| Kind                             | Purpose                                     |
| -------------------------------- | ------------------------------------------- |
| `mttx.apple.device`              | Device restrictions.                        |
| `mttx.apple.certificate.default` | PEM certificate.                            |
| `mttx.apple.application.default` | Uploaded installer metadata (storage only). |
| `mttx.apple.custom.default`      | Uploaded `.mobileconfig`.                   |

Patch semantics:

| Input                 | Result                                  |
| --------------------- | --------------------------------------- |
| `{ "kind": { ... } }` | Creates or replaces that configuration. |
| `{ "kind": null }`    | Deletes that configuration.             |

For Apple, configurations are converted into declarative device management declarations
and delivered at the next check-in. Application uploads are stored and downloadable from
the editor but are not delivered to devices yet.

## APNs

APNs configuration belongs to a tenant and is required for Apple management. Mattrax
generates an RSA key locally, exposes a CSR plist at
`GET /api/v1/tenants/:tenantId/apns/csr`, validates the uploaded certificate, extracts
the topic, and stores the private key sealed with `AUTH_SECRET`.

Remaining limitations:

- Certificate renewal is manual. The dashboard shows the certificate expiry date.
- Hosted Cloud requires an APNs relay for multi-tenant push (see
  [APNs and push](../self-hosting#apns-and-push)).
- Without a push transport, devices still converge by polling at check-in.

## Apple Business Manager and Apps and Books

Mattrax integrates the current Apple Business/School Manager API (OAuth 2) and
the Apps and Books v2 API. Both are tenant-scoped; credentials are sealed with
`AUTH_SECRET` and are never returned by the API.

| Setting         | Endpoint                                                        | Purpose                                                                          |
| --------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ABM status      | `GET /api/v1/tenants/:tenantId/abm`                             | Status, Apple org, token expiry, MDM server/profile ids, device counts           |
| ABM token       | `PUT /api/v1/tenants/:tenantId/abm/token`                       | Upload the API private key + Client ID/Key ID, a JSON bundle, or a legacy `.p7m` |
| ABM sync        | `POST /api/v1/tenants/:tenantId/abm/sync`                       | Upsert ABM devices and mark removed serials                                      |
| ABM devices     | `GET /api/v1/tenants/:tenantId/abm/devices`                     | Pre-enrollment inventory and assignment state                                    |
| ABM assign      | `POST /api/v1/tenants/:tenantId/abm/devices/:serial/assign`     | Assign a device to the tenant's ABM MDM service                                  |
| ADE profile URL | `GET /api/v1/tenants/:tenantId/abm/devices/:serial/profile-url` | Short-lived signed `.mobileconfig` link                                          |
| VPP status      | `GET /api/v1/tenants/:tenantId/vpp`                             | Token/org/expiry and licence totals                                              |
| VPP token       | `PUT /api/v1/tenants/:tenantId/vpp/token`                       | Upload the `.vpptoken` content token                                             |
| VPP sync        | `POST /api/v1/tenants/:tenantId/vpp/sync`                       | Sync asset/licence counts                                                        |
| VPP assets      | `GET /api/v1/tenants/:tenantId/vpp/assets`                      | Per-asset total/available/assigned counts                                        |
| VPP install     | `POST /api/v1/tenants/:tenantId/vpp/assets/:adamId/install`     | Assign a licence and queue `InstallApplication`                                  |
| VPP release     | `POST /api/v1/tenants/:tenantId/vpp/assets/:adamId/release`     | Return a revocable licence                                                       |

The ABM API account is created in Apple Business Manager → Settings → API. Upload
the downloaded private key (unencrypted PKCS#8 EC P-256) with the Client ID and
Key ID; Mattrax validates the key, exchanges an ES256 client assertion for a
bearer token, and stores only a sealed credential envelope. A legacy `.p7m` DEP
token is accepted and displayed but not used for sync — the current API is
OAuth. See [Production readiness](../production-readiness#apple-business-manager-abm-ade-and-apps-books-vpp)
for the setup, security notes and real-device checklist.

ABM sync pages through `orgDevices`, upserts by `(tenant, serial)`, links a
matching enrolled device, and marks devices Apple no longer returns as
`REMOVED`. Assignment creates or reuses a device management service and posts an
`ASSIGN_DEVICES` activity. The ADE profile endpoint serves the existing
SCEP/MDM payloads with a stable profile UUID; automatic delivery inside the ADE
`Authenticate` response is not wired yet (documented gap).

Apps and Books uses the content token as a bearer token against
`https://vpp.itunes.apple.com/mdm`. Sync records asset counts and enriches names
from the tenant catalogue/ABM app list. Installing a store app consumes a
device licence (`POST /v2/assets/associate`) and queues a VPP
`InstallApplication`; association is asynchronous, so local state records the
Apple event id and never claims installation before the device reports it.
Store-app installs fail closed when a VPP token is present but inactive or has
no available licence, rather than falling back to a user-account App Store
install.

## Related pages

- [API and OpenAPI](./api)
- [Quick start](../quick-start)
- [Self-hosting](../self-hosting)

## Team and invitations

Owners can invite administrators from **Tenant settings → Administrators**. The
invite response contains a one-time link (normally delivered by email). The
recipient must sign in or register with the invited email address before opening
the link; the link then joins them to the tenant with the chosen role. Invites
expire after seven days and can be cancelled from the same page.

## Account sessions

**Account → Active sessions** lists every browser session for the signed-in
account. Other sessions can be revoked individually; revoking the current
session signs the browser out. Account deletion removes solo tenants owned by the
account and leaves shared tenants to their remaining administrators.
