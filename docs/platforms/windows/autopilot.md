# Autopilot

Windows Autopilot registers devices with Entra ID and applies a deployment profile at
first boot. Mattrax imports hardware hashes, syncs Autopilot devices from Graph and creates
deployment profiles assigned to Entra groups.

## Prerequisites

- A Microsoft Entra app registration with:
  - `DeviceManagementServiceConfig.ReadWrite.All`
  - `DeviceManagementManagedDevices.Read.All`
  - `Group.Read.All`
  - `Directory.Read.All`
- Admin consent granted.
- The devices' hardware hashes, or devices already registered in Intune/Autopilot.
- An Entra group for assignment.

## Import hardware hashes

Export the Autopilot CSV from Intune or your OEM, then import it:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/autopilot/import" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Device Serial Number,Hardware Hash,Group Tag\nC02XXXXXXX,base64hash...,Finance",
    "format": "csv"
  }'
```

Accepted headers:

| Field     | Header aliases                                                                           |
| --------- | ---------------------------------------------------------------------------------------- |
| Serial    | `serial`, `serialnumber`, `deviceserialnumber`, `hardwareserialnumber`, `hardwareserial` |
| Hash      | `hardwarehash`, `hardwareidentifier`, `hash`, `devicehardwarehash`                       |
| Group tag | `grouptag`, `group`, `devicegrouptag`                                                    |

Headerless `serial,hash[,groupTag]` is also accepted. Comments (`#`) are ignored.
Limits: 500 rows and 1 MB per request. Serials are uppercased; duplicates are skipped.

Graph is called first; local rows are written only after Graph accepts the import. If
Graph fails, nothing is stored locally.

## Sync from Graph

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/autopilot/sync" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Sync pages up to 100 pages of `windowsAutopilotDeviceIdentities`, links devices to local
rows by normalized serial and stores the Graph id, Entra device id, group tag, model,
manufacturer, profile and enrollment state.

## Create a deployment profile

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/autopilot/profiles" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Standard Windows",
    "description": "Corporate laptop",
    "deploymentMode": "userDriven",
    "joinType": "azureADJoin",
    "deviceNameTemplate": "MTX-%SERIAL%",
    "locale": "en-US",
    "timezone": "Australia/Sydney",
    "enableDevicePreparation": false
  }'
```

### Validation rules

| Field                | Rule                                                               |
| -------------------- | ------------------------------------------------------------------ |
| `deploymentMode`     | `userDriven`, `selfDeploying` or `preProvisioned`                  |
| `joinType`           | `azureADJoin`, `azureADJoinUsingDeviceAuth` or `hybridAzureADJoin` |
| Hybrid join          | Only with `userDriven`                                             |
| Pre-provisioned      | Requires device preparation                                        |
| `name`               | ≤ 255 characters                                                   |
| `description`        | ≤ 2000 characters                                                  |
| `deviceNameTemplate` | ≤ 60 characters; letters, numbers, spaces, `%SERIAL%`, `-`         |
| `locale`             | `en-US` style                                                      |
| `timezone`           | IANA name                                                          |
| Assigned group       | Entra group UUID                                                   |

## Assign to a group

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/autopilot/profiles/$PROFILE_ID/assign" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "groupId": "00000000-0000-0000-0000-000000000000" }'
```

Assignment is group-based only. Mattrax calls Graph's `assign` with a
`groupAssignmentTarget`. It does not enumerate group membership or assign individual
devices.

## Delete an Autopilot identity

```bash
curl -X DELETE "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/autopilot/devices/$SERIAL" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

This deletes the identity in Graph and the local row. It does not unenroll or wipe a
device that is already deployed.

## Known gaps

- `timezone` is validated and stored locally but is **not sent to Graph**. Set it in the
  Intune portal if it matters.
- `enableDevicePreparation` is mapped to Graph's legacy `enableWhiteGlove`. The newer
  `windowsAutopilotDevicePreparationPolicy` resource is not modelled.
- Imports are sequential 500-row batches; very large imports are slow.
- There is no per-device assignment, group membership enumeration or profile deletion API.
- Autopilot OOBE has not been validated on real hardware in this repository.

## API endpoints

| Method   | Path                                                             | Purpose                  |
| -------- | ---------------------------------------------------------------- | ------------------------ |
| `GET`    | `/api/v1/tenants/:tenantId/autopilot`                            | Settings and Graph state |
| `GET`    | `/api/v1/tenants/:tenantId/autopilot/devices`                    | Cached Autopilot devices |
| `POST`   | `/api/v1/tenants/:tenantId/autopilot/import`                     | Import hardware hashes   |
| `POST`   | `/api/v1/tenants/:tenantId/autopilot/sync`                       | Sync from Graph          |
| `DELETE` | `/api/v1/tenants/:tenantId/autopilot/devices/:serial`            | Delete identity          |
| `GET`    | `/api/v1/tenants/:tenantId/autopilot/profiles`                   | List profiles            |
| `POST`   | `/api/v1/tenants/:tenantId/autopilot/profiles`                   | Create profile           |
| `PATCH`  | `/api/v1/tenants/:tenantId/autopilot/profiles/:profileId`        | Update profile           |
| `POST`   | `/api/v1/tenants/:tenantId/autopilot/profiles/:profileId/assign` | Assign group             |

## Next

- [Windows policies](/platforms/windows/policies)
- [Entra ID](/platforms/windows/entra-id)
