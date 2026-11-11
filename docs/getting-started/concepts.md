# Core concepts

Mattrax has a small number of nouns. Understanding how they relate is enough to predict
what a policy change will do to a fleet.

## Accounts and tenants

- **Account** — a person who signs in. An account has a name, email, password, optional
  authenticator app and optional passkeys.
- **Tenant** — an isolated workspace with its own devices, groups, policies, enrollment
  settings, branding, audit log, webhooks and billing subscription. Tenant ids are opaque
  and are never reused.
- **Member** — the link between an account and a tenant, with a role.

A single account can belong to many tenants. The dashboard switches between them without
signing out.

| Role      | Read | Write | Delete | Typical use                              |
| --------- | ---- | ----- | ------ | ---------------------------------------- |
| `owner`   | Yes  | Yes   | Yes    | Tenant owner; billing, backups, deletion |
| `admin`   | Yes  | Yes   | No     | Day-to-day device administration         |
| `member`  | Yes  | No    | No     | Read-only dashboard access               |
| `auditor` | Yes  | No    | No     | Read-only access for compliance review   |

API tokens carry a separate `read` or `write` scope. A token can also be bound to one
tenant. Effective permission is the intersection of the token scope and the member role.

## Devices

A **device** is a row with a protocol (`apple`, `win` or `android`), a lifecycle status
(`enrolling`, `enrolled`, `unenrolling`, `unenrolled`), inventory fields and timestamps.
Serials are unique per tenant across protocols.

Devices are never created directly through the API. They appear when a device enrolls, or
when a pre-registration matches an enrollment.

## Enrollment

**Enrollment** is the process that gives a device an identity and a management channel.

- Apple devices install a signed profile containing a SCEP payload and an MDM payload.
- Windows devices discover the tenant, receive a WSTEP policy, submit a CSR and receive an
  identity certificate.
- Android devices receive an AMAPI enrollment token or QR code.

Each tenant has one enrollment link with optional password, per-platform toggles, an asset
tag toggle and a device cap. Resetting the link invalidates the old link without touching
already-enrolled devices.

## Groups

Groups decide _who_ receives a policy or application.

- **Manual groups** contain devices you add explicitly.
- **Dynamic groups** materialise devices that match a versioned rule set: platform, OS
  version, model, serial, asset tag, staleness and health.

Dynamic membership is recomputed on group changes, on device inventory updates, in daily
maintenance and on demand. Manual rows inside a dynamic group are preserved as explicit
exceptions.

## Policies and configurations

A **policy** is a named container with a priority and one or more **configurations**. The
configuration kind determines the platform and payload:

| Kind                          | Platform | Payload                                                 |
| ----------------------------- | -------- | ------------------------------------------------------- |
| `mttx.apple.device`           | Apple    | Built-in device settings (currently camera restriction) |
| `mttx.apple.custom.<id>`      | Apple    | A complete `.mobileconfig` profile                      |
| `mttx.apple.certificate.<id>` | Apple    | A certificate asset referenced by DDM                   |
| `mttx.apple.declaration.<id>` | Apple    | A raw Apple DDM declaration                             |
| `mttx.windows.custom.<id>`    | Windows  | One or more OMA-URI nodes                               |
| `mttx.android.policy.<id>`    | Android  | An AMAPI policy fragment                                |

`mttx.apple.application.<id>` is rejected today; app installation uses the application
catalogue or a direct `install-app` command instead.

## Assignments and precedence

Policies reach devices through group assignments and direct device assignments. Each link
can be an **include** or an **exclude**.

Resolution order, from strongest to weakest:

1. Direct device **exclude** removes the policy, even if a group includes it.
2. Direct device **include** wins over every group include or exclude.
3. Group **exclude** vetoes group delivery. Another group cannot re-add it, but a direct
   include can.
4. Among remaining policies, the highest `priority` wins. Ties go to the most recently
   updated policy, then the lowest id.

Use `GET /api/v1/tenants/:tenantId/devices/:id/effective-policy` to see the resolved
trace for one device.

## Applications

The **application catalogue** stores metadata for apps: name, platform, bundle id,
version and a source (`manifest`, `store` or `upload`). Catalogue entries can be assigned
to groups or devices.

- Apple can queue `InstallApplication` when the entry has a manifest URL or iTunes Store id.
- VPP/Apps & Books licences can be assigned by device serial and installed from the
  licence pool.
- Windows and Android app installation is not implemented yet.
- Uploaded packages are stored in R2 but do not automatically become installable; you
  still need a manifest URL or a VPP licence.

## Commands and health

Remote actions create **commands** with a lifecycle: `queued → sent → succeeded`,
`failed` or `not-now`. Apple commands are delivered on check-in and can be woken with
APNs. Windows commands are delivered in the next SyncML session. Android commands are
issued through AMAPI.

**Device health** is a derived rollup, not a compliance engine. It combines enrollment
state, last-seen age, declaration failures, FileVault state, disk pressure and battery
condition into `healthy`, `attention`, `critical` or `unknown`.

## Audit and webhooks

Every meaningful mutation writes an **audit event** with an actor, action, target and
metadata. Audit events can be searched, exported and streamed to **webhook endpoints**
with HMAC signatures and retries.

## Next

- [Quick start](/getting-started/quick-start)
- [Manage devices](/manage/devices)
- [Policies](/manage/policies)
- [Groups](/manage/groups)
