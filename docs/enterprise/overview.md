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

| Role     | Read | Write (devices, groups, policies, settings) | Delete tenant |
| -------- | ---- | ------------------------------------------- | ------------- |
| `owner`  | Yes  | Yes                                         | Yes           |
| `admin`  | Yes  | Yes                                         | No            |
| `member` | Yes  | No                                          | No            |

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

| Field             | Meaning                                     |
| ----------------- | ------------------------------------------- |
| `plan`            | Subscription plan identifier, when present. |
| `status`          | Stripe subscription status.                 |
| `subscriptionId`  | Stripe subscription id.                     |
| `billableDevices` | Devices currently in the `enrolled` state.  |

`POST /api/v1/tenants/:tenantId/billing/portal` returns a Stripe billing-portal URL so an
owner or admin can manage payment details.

Billing requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
`STRIPE_DEVICE_MONTHLY_PRICE_ID` in the Cloud API environment. Self-hosted whitelabel does
not include billing.

## API tokens

API tokens are **account-scoped**, not tenant-scoped. A request authenticated with a token
still goes through the normal tenant-membership checks.

| Operation | Endpoint                                     |
| --------- | -------------------------------------------- |
| List      | `GET /api/v1/account/api-tokens`             |
| Create    | `POST /api/v1/account/api-tokens`            |
| Revoke    | `DELETE /api/v1/account/api-tokens/:tokenId` |

Create a token:

```bash
curl -X POST https://mdm.example.com/api/v1/account/api-tokens \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer mtx_...' \
  -d '{"name":"ci","expiresAt":"2027-01-01T00:00:00.000Z"}'
```

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

| Setting           | Meaning                                                       |
| ----------------- | ------------------------------------------------------------- |
| `code`            | Optional password required before platform options are shown. |
| `enabledApple`    | Enables Apple enrolment. Requires a configured APNs topic.    |
| `enabledWindows`  | Enables the Windows tab. Preview only; no mounted routes.     |
| `enabledAndroid`  | Enables the Android tab. No working backend.                  |
| `enabledAssetTag` | Returns an asset-tag flag in the enrollment response.         |
| `maxDevices`      | Device cap. Use a high value for a large fleet.               |

The public data endpoint is:

```text
GET /api/v1/enrollment/:id?code=<optional-password>
```

The dashboard enrollment page is `/enroll/:id`. The response returns per-platform state:
a profile, `"available"`, or an error explaining why the platform is disabled or missing
APNs.

Resetting the enrolment id invalidates the old link. Existing devices remain enrolled.

## Groups and policies

Groups connect devices and policies. Membership updates use explicit `assign` and
`unassign` lists, and the backend verifies that every referenced device and policy belongs
to the same tenant.

Policies do not target devices directly. A device receives the union of configurations
from every policy assigned to every group it belongs to.

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
