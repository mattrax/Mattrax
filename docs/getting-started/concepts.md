# Core concepts

Mattrax has a small number of nouns. Understanding how they relate is enough to predict
what a policy change will do to a fleet.

## Accounts, users and tenants

- **Account** — a dashboard administrator. An account has a name, email, one or more
  passkeys, and optionally an authenticator app as a second factor. Accounts authenticate,
  belong to tenants and carry roles.
- **User** — a person from a tenant's directory. A user has a name, email, optional
  provider object id and a source (Entra, SCIM or manual), but no credentials or dashboard
  access. Users scope policies, directory groups and device links to a person.
- **Tenant** — an isolated environment with its own devices, groups, policies, enrollment
  settings, branding, audit log, webhooks and billing subscription. Tenant ids are opaque
  and are never reused. Dashboard URLs use the tenant's editable **slug**
  (`/t/<slug>/devices`); links that still carry the id redirect to the slug, and renaming
  the slug changes every shareable tenant link.
- **Member** — the link between an account and a tenant, with a role.

A single account can belong to many tenants. The dashboard switches between them without
signing out. Directory sync provisions users, not accounts: importing staff does not grant
dashboard access. See [Accounts and users](/reference/identity-model) for the full
lifecycle, API and invariants.

### Dashboard navigation

The sidebar has one **Tenant** group with the daily sections (Overview, Dashboards,
Devices, Users, Groups, Policies, Applications and Scripts), plus any pinned dashboards.
**Settings** lives at the bottom of the sidebar, directly above the account row, because it
is a configuration surface rather than daily work. Both areas are permission-aware: a
section only appears when the tenant membership grants its read permission, and Settings
only appears when at least one settings tab is readable.

The tenant switcher at the top of the sidebar changes the tenant without signing out. The
account menu at the bottom opens **Account** (profile, security, API tokens and sessions)
and **Support**. The help button in the header opens the same in-app documentation and the
deployment's configured support destination.

Tenant URLs use `/t/<slug>`. Visiting `/t` (or `/t/`) redirects to the account's default
tenant — the same resolution `/dashboard` uses — and keeps the query string or anchor.

| Role      | Read | Write | Delete | Typical use                              |
| --------- | ---- | ----- | ------ | ---------------------------------------- |
| `owner`   | Yes  | Yes   | Yes    | Tenant owner; billing, backups, deletion |
| `admin`   | Yes  | Yes   | No     | Day-to-day device administration         |
| `member`  | Yes  | No    | No     | Read-only dashboard access               |
| `auditor` | Yes  | No    | No     | Read-only access for compliance review   |

API tokens can be narrowed to specific tenant permissions (for example
`devices.read` and `policies.write`), and can be bound to one tenant. Effective
permission is the intersection of the token grant and the member role. Custom
roles and tokens read from the same permission catalogue.

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

The link is server-rendered: the password form (or the platform instructions) is in the
first HTML response, so a link preview or a device with JavaScript disabled still shows a
usable form. The password field has a reveal toggle, and submitting it uses a plain form
GET.

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

Policies reach devices through device group assignments, direct device assignments, and
directory users or user groups. Each link can be an **include** or an **exclude**.

Every configuration is **device-scoped** or **user-scoped**. Device-scoped settings apply to
every user of a device. User-scoped settings are delivered only on Apple's native user channel
to a login whose identity is bound to a directory person; see
[User-scoped policies](/reference/user-scoped-policies/).

User-assigned policies still contribute their device-scoped settings on the device channel,
so a user policy's device restrictions affect every user of a linked device. Windows and
Android have no per-login channel; Windows delivers `./User/` settings to every user, and
Android rejects user scope. Directory sync (Entra or SCIM) keeps user groups current and
triggers a refresh for linked devices.

Apple devices additionally have a native **user channel** per macOS or Shared iPad login.
That channel carries its own push token, declarations, profile inventory and per-user
commands, and is visible on the device page. See
[Apple](/platforms/apple/#user-channel).

Resolution order, from strongest to weakest:

1. Direct device **exclude** removes the policy, even if a group or user includes it.
2. Direct device **include** wins over every group include or exclude.
3. A device assignment (direct or group) beats a user assignment for the same
   configuration kind. On the user channel, device-assigned user-scoped settings beat
   user-assigned ones for the same kind.
4. Group **exclude** vetoes group delivery. Another group cannot re-add it, but a direct
   include can.
5. Among remaining policies, the highest `priority` wins. Ties go to the most recently
   updated policy, then the lowest id.

User assignments follow Intune-style targeting:

- A direct user include beats that user's directory group assignments.
- A user exclusion removes only that user's contribution. It never removes a policy that
  another linked user includes. A policy disappears when no linked user includes it.
- A device group exclude also removes a policy a linked user includes, matching the
  device-scope precedence above.
- Windows devices converge on their next scheduled OMA-DM check-in; Apple and Android are
  notified when assignments or directory membership change.

Use `GET /api/v1/tenants/:tenantId/devices/:id/effective-policy` to see the resolved
trace for one device.

## Applications

The **application catalogue** stores a logical app and one or more installers. An
installer carries its own platform (`apple`, `win`, `android`), source (`manifest`,
`store` or `upload`), version, identifiers and delivery details. Catalogue entries can
be assigned to groups or devices.

- The MDM layer selects one installer per device from its platform, OS version and
  reported capabilities. `priority` breaks ties, then the highest version; `minOsVersion`
  and `requiredCapability` let a newer installer target only devices that support it.
- Apple installs from an uploaded `.pkg` (macOS) or `.ipa` (iOS/iPadOS), an OTA
  manifest, or an iTunes Store id; Mattrax hosts the OTA manifest for an uploaded `.ipa`.
  VPP/Apps & Books licences are assigned from the licence pool when configured.
- Windows installs an MSI through OMA-DM; Android pushes the selected Managed Google
  Play package in the device policy.
- Installer uploads are stored in R2 per installer, so several versions can be uploaded
  to the same app. A missing file is reported instead of queueing an install that cannot
  succeed.

## Commands and health

Remote actions create **commands** with a lifecycle: `queued → sent → deferred`
(Apple answered `NotNow`) and then a terminal `succeeded`, `failed`, `expired`,
`superseded` or `cancelled`. Every command has a delivery deadline, so a lock queued for
a device that stays offline expires instead of firing weeks later. Identical requests are
de-duplicated while a command is queued or in flight. Apple commands are delivered on
check-in and can be woken with APNs. Windows commands are delivered in the next SyncML
session. Android commands are issued through AMAPI. See
[Devices](/manage/devices#actions) for the lifecycle table.

**Device health** is a derived rollup, not a compliance engine. It combines enrollment
state, last-seen age, declaration failures, FileVault state, disk pressure and battery
condition into `healthy`, `attention`, `missing` (MIA), `critical` or `unknown`. Stale
(7 days) is an attention warning; a still-enrolled device that has not checked in for 14
days is MIA, and daily maintenance unenrols it after the configured window (30 days by
default).

## Audit and webhooks

Every meaningful mutation writes an **audit event** with an actor, action, target and
metadata. Audit events can be searched, exported and streamed to **webhook endpoints**
with HMAC signatures and retries.

## Next

- [Quick start](/getting-started/quick-start)
- [Manage devices](/manage/devices)
- [Policies](/manage/policies)
- [Groups](/manage/groups)
