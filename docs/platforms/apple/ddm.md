# DDM and profiles

Mattrax uses Apple's declarative device management (DDM) as the primary policy channel and
legacy configuration profiles where DDM does not yet cover the setting.

## How DDM works

A managed device asks for declarations at check-in:

1. `DeclarativeManagement` with `Endpoint: tokens` — Mattrax returns a declarations token.
2. `declaration-items` — Mattrax returns activations, configurations, assets and
   management declarations with per-item server tokens.
3. `declaration/<type>/<identifier>` — the device fetches the declaration body.
4. `status` — the device reports active/valid state and reasons.

The sync token is a hash of every `(identifier, serverToken)` pair. It is persisted only
after the device fetches the items, so a failed sync retries from the previous state.

## Built-in declarations

Every tenant gets three declarations, plus a fourth pair when an Apple OS
policy is enforcing:

| Type          | Identifier                             | Purpose                                                                         |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| Activation    | `DAAF574F-36D4-4089-B2E3-D2008B65D5BE` | Activates the status subscription configuration                                 |
| Configuration | `13DE3EE0-D5A8-46E9-B967-27E56A4D918F` | `com.apple.configuration.management.status-subscriptions`, item list per device |
| Management    | `F8C4C3A1-…`                           | `com.apple.management.organization-info` from tenant branding                   |
| Activation    | `2E0D4D7C-…`                           | Activates the tenant software-update enforcement configuration                  |
| Configuration | `C6A1E9D4-…`                           | `com.apple.configuration.softwareupdate.enforcement.specific`                   |

### Tenant software-update enforcement

The software-update pair is generated from the tenant OS policy rather than
stored as a policy configuration. When the macOS, iOS or iPadOS rule is set to
`enforce`, every supervised device that can apply declarations receives:

- an activation whose `StandardConfigurations` names the enforcement
  configuration, and
- the declaration itself, with `TargetOSVersion` set to the rule minimum and
  `TargetLocalDateTime` set to the deferral deadline (or the time the rule was
  saved when there is no deferral).

The declaration is only emitted for DDM devices on macOS 14+, iOS 17+ or
iPadOS 17+; Apple documents the declaration as system-scoped and supervised
only. User-enrolled devices, legacy-delivery devices and older releases are
left on the explicit `ScheduleOSUpdate` fallback. A `warn` or `off` rule emits
nothing. The configuration `ServerToken` is derived from the rule, its
platform and its `updatedAt`, so an edit rotates the token and the device
fetches the declaration again.

Apple only installs a target version its servers still publish, and Mattrax
does not query Apple GDMF for iOS/iPadOS, so an exact version that Apple has
withdrawn leaves the declaration active without an update. `TargetLocalDateTime`
is sent as the UTC wall clock because the device time zone is not reported.
These are documented gaps, not silently retargeted versions.

Status items include serial number, model, OS version/build, FileVault state, battery
health, disk capacity, client capabilities and declaration state. They populate device
inventory without a separate command.

The subscription is built per device. Apple invalidates the whole declaration when it
contains an item the OS does not know, so passcode, `mdm.app`, software-update and
`security.*` items are only added once the device's reported OS version supports them.
See [Apple security and inventory](/platforms/apple/security) for the matrix.

## Declarative or legacy delivery

A device only gets `DdmSync` when it can apply declarations:

- its reported OS is at least macOS 13 / iOS 15 / tvOS 16 / watchOS 10 / visionOS 1.1, and
- `management.client-capabilities` does not explicitly report that it lacks
  `com.apple.configuration.*` support.

Otherwise Mattrax records the decision — `declarationMode = legacy` plus a reason and
timestamp on `device_apple`, exposed on the device detail — and delivers the policy's
legacy kinds as `.mobileconfig` profiles through `InstallProfile` commands. A profile the
policy no longer contains is removed with `RemoveProfile`. Certificates are compiled into
a `com.apple.security.pkcs1` profile on this path, because the certificate declaration
itself needs macOS 14 / iOS 17.

When a device later reports a supported OS and capability, it moves back to DDM, the
leftover profiles are removed and the declaration token is cleared so a full sync runs.
Kinds with no legacy equivalent (raw declarations) are not delivered and are reported in
the recorded reason.

## OS scoping

Apple publishes `supportedOS` for every payload and declaration type. Mattrax carries that
metadata through schema generation and filters delivery with it:

- a declaration is only listed for a device whose OS version meets the type's minimum, and
- a custom `.mobileconfig` is only delivered when every payload type inside it is supported
  by the device's OS.

Configurations that are filtered out are omitted from the device's declarations (and are
listed as undeliverable in the recorded reason when the device is on the legacy path).
The policy designer shows the same per-family range
(`macOS 14+ · iOS 17+`) the delivery path enforces, and refuses to add a collection that
only supports an OS family Mattrax does not manage.

Windows policies use the same mechanism where metadata exists: a designer node carries the
setting's minimum supported build and delivery skips nodes above the device's build.

Each policy scope gets one activation: the group id, or `direct:<policyId>` for a direct
device assignment.

## Configuration kinds

| Kind                          | Delivered as                                                      | Notes                                                   |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| `mttx.apple.device`           | Legacy profile via DDM                                            | Currently only `{ "camera": boolean }`                  |
| `mttx.apple.custom.<id>`      | Legacy profile via DDM                                            | Your uploaded `.mobileconfig`, served verbatim          |
| `mttx.apple.certificate.<id>` | `com.apple.configuration.security.certificate` + credential asset | Certificate is a PEM asset with SHA-256 and size        |
| `mttx.apple.declaration.<id>` | Raw Apple declaration                                             | You supply `kind` and `configuration`                   |
| `mttx.apple.application.<id>` | Imperative install command                                        | Catalogue reference or inline manifest/store/upload app |

The `<id>` suffix is up to 20 alphanumeric characters.

### Custom mobileconfig validation

An uploaded profile must:

- Be valid base64 content that parses as a plist.
- Have top-level `PayloadType: Configuration`.
- Have a non-empty `PayloadIdentifier` and `PayloadDisplayName`.
- Use `PayloadScope` `System` or `User` if present.
- Contain at least one `PayloadContent`.
- Not contain `com.apple.mdm` (enrollment is managed separately).

### Example: raw declaration

```json
{
  "mttx.apple.declaration.passcode": {
    "kind": "com.apple.configuration.passcode.settings",
    "configuration": {
      "MinimumLength": 12,
      "RequireAlphanumeric": true
    }
  }
}
```

Use the Apple declaration reference for the exact `kind` and schema. Mattrax does not
rewrite the configuration.

## Signed profile and asset URLs

Legacy profiles and certificate assets are fetched from public-by-token URLs:

```text
GET /mdm/apple/profiles/:deviceToken/:policyId/:kind?token=...
GET /mdm/apple/assets/:identifier?token=...
```

The token is HMAC-signed with `AUTH_SECRET`.

- **Profile tokens** bind the policy, kind and device token. They do not expire; the
  declaration is re-issued when its content changes.
- **Asset tokens** bind the policy, kind, the internal device id and an expiry. A link is
  valid for 30–60 minutes. The asset declaration's `ServerToken` rotates on the same
  fixed 30-minute window, so on its next DDM sync the device sees the changed token,
  re-fetches the declaration and receives a fresh `DataURL` without re-enrolling. The API
  rejects an expired token, a token for another device, and a token whose device is no
  longer enrolled (or belongs to another tenant), so a leaked link is revocable by
  unenrolling or deleting the device.

An mTLS identity certificate whose OU matches the tenant is also accepted for assets.

These URLs are intentionally accessible without a dashboard session: the device fetches
them during a DDM sync.

## Deployment history and rollback

Every policy save creates a deployment snapshot:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID/deployments" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Rollback restores a snapshot and writes an audit event:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID/deployments/$DEPLOYMENT_ID/rollback" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

## Effective policy

To see exactly what a device should receive:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/effective-policy" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

The response includes the resolution trace: direct excludes, direct includes, group
includes/excludes, priority and the winning configuration per kind. Use it before
debugging a device.

## Applying changes

- Apple changes are delivered on the next check-in. Use **Sync** or
  `POST /api/v1/tenants/:tenantId/policies/sync` to wake affected devices with APNs.
- A policy change fans out to affected groups/devices with bounded concurrency. One failed
  push does not abort the rest.
- If APNs is unavailable, devices converge by polling.

## Limitations

- `mttx.apple.device` is not a general restrictions editor. Use custom profiles or DDM.
- `mttx.apple.application.<id>` is delivered as an install command, not a declaration, so
  it does not appear in DDM declaration lists. Uploaded packages install on macOS only.
- Profiles are pulled through DDM on capable devices; pre-DDM devices receive
  `InstallProfile` commands instead. `mttx.apple.device` and custom profiles have a legacy
  equivalent, raw declarations do not.
- There is no CRL/OCSP endpoint for certificates.
- DDM status reports persist declaration state and inventory. The tenant OS policy is
  the only DDM compliance rule; there is no general declarative compliance engine.
- The software-update declaration requires supervision. Mattrax does not receive a
  supervision flag from Apple, so it treats device enrolment as supervised and user
  enrolment as unsupervised; the fallback command is never offered to user enrolment.

## Next

- [Apple security and inventory](/platforms/apple/security)
- [Policies](/manage/policies)
