# Policies

A policy is a named container with a priority and one or more configurations. Assignments
decide which devices receive it; resolution decides which configuration wins when several
policies apply.

## Create a policy

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Baseline",
    "notes": "Company defaults",
    "priority": 100,
    "configurations": {
      "mttx.apple.device": { "camera": false }
    }
  }'
```

Patching a configuration with `null` deletes that kind. Every configuration is validated
before any write.

## Import a policy

**Policies → Import** creates a policy, or adds configurations to an existing policy when
you open Import from that policy's page. Supported sources:

- a `.mobileconfig` profile, uploaded or pasted as text;
- a policy document exported from Mattrax, YAML or JSON;
- a bare policy object with a `name`, pasted as JSON.

### The document format

An import contains exactly one policy, in the same versioned document that
`mattrax policies export` writes:

```json
{
  "version": 1,
  "policies": [
    {
      "name": "Baseline",
      "notes": "Company defaults",
      "priority": 100,
      "enabled": true,
      "configurations": {
        "mttx.apple.device": { "camera": false }
      },
      "configurationScopes": {
        "mttx.apple.custom.wifi": "user"
      }
    }
  ]
}
```

`name` is required; `notes`, `priority` and `enabled` are optional. Each key in
`configurations` is a [configuration kind](#configuration-kinds) and its value is the same
payload the editor saves. `configurationScopes` is optional and an omitted kind is
device-scoped. A document with several policies is refused: export the one you need.

```bash
mattrax policies export --id "$POLICY_ID" --format json -o policy.json
```

The same import is available over the API: `POST /policies` accepts `configurations` and
`configurationScopes` alongside the metadata, and `PATCH /policies/:id` adds or replaces
them on an existing policy. A configuration rejected by validation aborts the whole
request.

### Preview and conflicts

The preview lists every imported kind as **Added**, **Replaced**, **Unchanged** or
**Skipped** before anything is saved. Importing into an existing policy:

- changes only configurations: its name, notes, priority, assignments and enabled state
  stay as they are;
- keeps a kind it already has unless you choose **Replace existing kinds**;
- keeps the stored delivery scope of an existing kind when the document does not name one;
- reports an identical configuration as unchanged, so re-importing is a no-op.

### Mobileconfig

A profile is stored as `mttx.apple.custom.imported` (or the next free `imported2`, …) with
its bytes base64-encoded. A signed profile keeps its signature and deploys byte-for-byte.
A top-level `PayloadScope` of `User` selects the Apple user channel; anything else is
device-scoped.

### Validation

Saving validates every imported configuration through the same rules as the editor:
unknown kinds, a malformed profile, an escrow certificate the tenant does not hold, a
policy variable that does not resolve, or an application that does not exist in the tenant
reject the request and nothing is written. The import requires `policies.write` and only
touches the current tenant.

## Configuration kinds

| Kind                           | Platform | Payload                                              |
| ------------------------------ | -------- | ---------------------------------------------------- |
| `mttx.apple.device`            | Apple    | Built-in settings; currently `{ "camera": boolean }` |
| `mttx.apple.custom.<id>`       | Apple    | Base64 `.mobileconfig`                               |
| `mttx.apple.certificate.<id>`  | Apple    | PEM certificate for DDM                              |
| `mttx.apple.declaration.<id>`  | Apple    | Raw DDM declaration                                  |
| `mttx.apple.application.<id>`  | Apple    | App install: catalogue reference or inline app       |
| `mttx.apple.lockScreenMessage` | Apple    | Lock screen default: message and include-asset-tag   |
| `mttx.windows.custom.<id>`     | Windows  | OMA-URI node or `{ nodes: [...] }`                   |
| `mttx.android.policy.<id>`     | Android  | AMAPI policy fragment                                |

An Apple application configuration installs on every device in the policy's scope. It
references a catalogue row (`{ "applicationId": "…" }`) or carries its own manifest, store
id or uploaded `.pkg` metadata. See [Applications](/manage/applications#applications-in-a-policy),
[Apple DDM](/platforms/apple/ddm), [Windows policies](/platforms/windows/policies) and
[Android policies](/platforms/android/policies).

### Lock screen message default

`mttx.apple.lockScreenMessage` is a group-level default for the
[lock screen message](/manage/devices#lock-screen-message) shown on supervised iPhone and
iPad devices:

```json
{
  "mttx.apple.lockScreenMessage": {
    "message": "If found, return to the IT desk",
    "includeAssetTag": true
  }
}
```

Unlike the other Apple kinds it is not a declaration. Mattrax resolves the winning config
for each device on check-in and installs the `com.apple.shareddeviceconfiguration`
profile with `LockScreenFootnote` and, when `includeAssetTag` is on, the device's
asset tag as `AssetTagInformation`. Devices without an asset tag skip delivery and the
device page explains why. A per-device override on the device page wins over this
default; removing the default removes the profile when no override remains. Policy
delivery state only tracks declarative kinds, so follow the `InstallProfile` command
under the device's Command history.

## The designer

The dashboard policy designer and the public `/designer` page read the same catalogue:

- Apple and Android from one file each.
- Windows split into a browse index, per-collection files and a search index.

Selections are stored as `mttx.apple.custom.designer` or
`mttx.apple.declaration.d<hash>`. The designer is optional; you can upload a profile or
write a declaration directly.

The designer and the policy creation form can start from a reviewed CIS benchmark. The
picker shows coverage and every control, and applies only the controls you select without
removing unrelated settings. See [CIS benchmark templates](/reference/cis-templates).

See [Policy catalogue](/reference/policy-catalogue) for file sizes and regeneration.

## Assign

### To a group

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups/$GROUP_ID/members" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assign": { "policies": [{ "id": "policy_id", "mode": "include" }] },
    "unassign": { "policies": [] }
  }'
```

### To a device

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID/assignments" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assign": [{ "id": "device_id", "mode": "include" }],
    "unassign": []
  }'
```

## Precedence

Resolution is evaluated per policy:

1. Direct device **exclude** removes it entirely.
2. Direct device **include** beats group includes and excludes.
3. Group **exclude** vetoes group delivery. A direct include can still add it.
4. Highest `priority` wins. Ties: newest `updatedAt`, then ascending policy id.

Inspect the trace:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/effective-policy" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

## Sync

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/sync" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "ids": ["policy_id"] }'
```

Apple devices receive an APNs wake-up. Windows waits for polling. Android pushes the
policy directly.

## Disable a policy

Disabling stops delivery without deleting the policy. Its configuration and assignments
stay in place, so you can enable it again later.

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

A disabled policy contributes nothing to resolution: its settings are withdrawn from
scoped devices and it cannot override or exclude another policy. Apple devices and Android
are updated immediately; Windows converges on its next check-in, where settings that are
no longer desired are deleted. Deployment history records the state change, and rolling
back to an older deployment restores its enabled state.

## Deployment history

Every save creates a snapshot:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID/deployments" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Roll back:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID/deployments/$DEPLOYMENT_ID/rollback" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

## Preview a mobileconfig

Upload a profile and inspect the parsed payloads before creating a policy:

```bash
curl -X POST "$MATTRAX_URL/api/v1/policy/preview-mobileconfig" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "content": "<base64>" }'
```

## Duplicate and delete

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID/duplicate" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"

curl -X DELETE "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "ids": ["policy_id"] }'
```

## Editing safely

The policy metadata form, the configuration editor and the designer all guard unsaved
changes. Navigating away, closing the tab or leaving the editor asks **Discard** or
**Keep editing** instead of dropping the work silently. Password fields (for example a
Wi-Fi payload's password) have a reveal button so a long value can be checked before
saving.

## Policy variables

Configuration payloads can interpolate per-device values. The supported contexts are:

| Variable             | Value                                                       |
| -------------------- | ----------------------------------------------------------- |
| `${device.name}`     | The device's display name in this tenant.                   |
| `${device.serial}`   | The hardware serial reported at enrollment.                 |
| `${device.model}`    | The model name reported by the device.                      |
| `${tenant.name}`     | The tenant (organisation) name.                             |
| `${attribute.<key>}` | A device attribute registered in **Settings → Attributes**. |

Variables are resolved when a policy is compiled for delivery, per device, before the
platform compiler runs. Apple declarations, legacy `.mobileconfig` profiles, Windows
SyncML nodes and the effective-policy preview all see the resolved text.

- An unknown variable fails validation with the field path and the offending name, so a
  typo cannot ship as literal text.
- A registered attribute with no value on a particular device resolves to an empty
  string.
- `$${...}` is an escape and renders the literal text `${...}`; `$${device.name}` is sent
  unchanged (without the extra `$`).
- Secrets are never available. Only the contexts above resolve, so
  `${device.recoveryKey}` or `${secret.apiKey}` is rejected.
- Object keys are not interpolated; only string values.

The editor's **Policy variables** hint lists every built-in name plus the tenant's
registered attribute keys. `GET /api/v1/tenants/:tenantId/policy-variables` returns the
same list for tooling.

## Application payloads

Policies can store application files in R2:

```text
POST /api/v1/tenants/:tenantId/policies/:id/applications
GET  /api/v1/tenants/:tenantId/policies/:id/applications/:sha256
```

The download returns JSON with base64 `content`, not binary bytes. Reference the upload from
a `mttx.apple.application.<id>` configuration (with `sha256`, `fileName`, `bundleId` and
`version`) to serve it to Macs through a signed, expiring URL. See
[Applications](/manage/applications#applications-in-a-policy).

## Limitations

- The built-in Apple device configuration is limited to the camera restriction.
- `mttx.apple.application.<id>` installs a catalogue, manifest, store or uploaded app.
  A catalogue `.pkg` targets macOS and a catalogue `.ipa` targets iOS/iPadOS; a package
  uploaded against the policy itself is `.pkg`-only.
- Policy resolution is application-side; very large fleets may see slower syncs.
- Windows only supports OMA-URI `Replace`.
- Android merge rules concatenate arrays; plan fragments accordingly.

## Next

- [Groups](/manage/groups)
- [Applications](/manage/applications)
- [Apple DDM](/platforms/apple/ddm)
