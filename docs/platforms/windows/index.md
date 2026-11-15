# Windows

Mattrax manages Windows through the native MDM protocols: WSTEP for enrollment and
certificate identity, and SyncML (OMA-DM) for policy and commands. Entra ID adds federated
authentication, SSO for the dashboard and Autopilot deployment profiles.

## What is supported

| Area       | Support                                                           |
| ---------- | ----------------------------------------------------------------- |
| Enrollment | Tenant-scoped discovery URL, WSTEP policy and certificate         |
| Identity   | Device certificate, 365-day validity, 180-day renewal             |
| Policy     | OMA-URI `Replace`/`Delete` SyncML commands with applied state     |
| Commands   | Remote wipe, restart and unenroll                                 |
| Zero-touch | Autopilot hardware-hash import and deployment profiles            |
| Directory  | Entra ID SSO, directory sync, SCIM                                |
| Push       | None; devices poll on their SyncML schedule                       |
| Inventory  | Identity, OS, storage, BitLocker, TPM, Secure Boot and join state |

## Prerequisites

- A trusted HTTPS origin.
- A Windows device that can reach the discovery URL.
- For Entra join or Autopilot: a Microsoft Entra tenant and an app registration with the
  required Graph permissions. See [Entra ID](/platforms/windows/entra-id).
- For policy: at least one `mttx.windows.custom.<id>` configuration.

## Enrollment

### 1. Enable Windows

Open **Devices → Enrollment** and enable **Windows**. The page shows a tenant-scoped
discovery URL of the form:

```text
https://e.mattrax.app/mdm/windows/discovery?tenant=<signed-token>
```

The tenant token is HMAC-signed with `AUTH_SECRET` and expires after seven days. Reload the
enrollment page to mint a fresh one. Do not cache or share old links.

### 2. Run discovery

The Windows device posts a SOAP discovery request to the URL. Mattrax returns:

- `enrollmentVersion: "4.0"`
- The policy and enrollment service URLs, preserving the tenant token
- An auth policy: `OnPremise` by default, `Federated` when the device offers it and the
  tenant has Entra configured

### 3. Policy and certificate

The device requests a WSTEP policy, then submits a CSR. Mattrax signs it with the global
SCEP CA, sets the certificate OU to the tenant id, and returns:

- `signedCertificate`
- `identityCertificate` (the CA chain)
- `username` = Windows DeviceID
- A random `secret`
- `providerId: "Mattrax"`

The provisioning document configures WSTEP renewal, root/My certificate stores, the
management provider (`w7`), the management URL and DM client polling.

### 4. Status

A Windows device is created with status `enrolled` immediately. There is no separate
`TokenUpdate` step. Model, serial and OS details arrive with the first inventory report
after enrollment (see [Inventory](#inventory)).

## Inventory

The first management check-in after enrollment asks the device for a snapshot with OMA-DM
`Get` commands:

| OMA-URI                                                      | Stored in                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `./DevDetail/SwV`                                            | `osVersion`, `osBuild`                                       |
| `./DevInfo/Mod`                                              | `model`                                                      |
| `./DevDetail/DevTyp`                                         | `model` fallback                                             |
| `./DevDetail/Ext/Microsoft/SystemSKU`                        | `modelIdentifier`                                            |
| `./DevDetail/Ext/Microsoft/SMBIOSSerialNumber`               | `serial`                                                     |
| `./DevDetail/Ext/Microsoft/DeviceName`                       | `physicalName`, and `name` while that is still a placeholder |
| `./DevDetail/Ext/Microsoft/OSPlatform`                       | `osEdition`                                                  |
| `./DevDetail/Ext/Microsoft/TotalStorage`                     | `diskTotal`                                                  |
| `./DevDetail/Ext/Microsoft/FreeStorage`                      | `diskUsed`                                                   |
| `./Vendor/MSFT/DeviceStatus/Compliance/EncryptionCompliance` | `bitLockerEnabled`                                           |
| `./Vendor/MSFT/BitLocker/Status/DeviceEncryptionStatus`      | `bitLockerStatus` (raw bitmask)                              |
| `./Vendor/MSFT/DeviceStatus/TPM/SpecificationVersion`        | `tpmVersion` (absent when no TPM)                            |
| `./Vendor/MSFT/DeviceStatus/SecureBootState`                 | `secureBootState` (0 unsupported, 1 enabled, 2 disabled)     |
| `./Vendor/MSFT/DeviceStatus/DomainName`                      | `domainName`                                                 |
| `./Vendor/MSFT/DMClient/Provider/Mattrax/AADDeviceID`        | `entraDeviceId` (present when Entra joined)                  |

The `{ProviderID}` in the `DMClient` path is the provider id written into the provisioning
document (`Mattrax` unless the deployment overrides it).

The device returns the values in a SyncML `<Results>` block on a later session. They are
written to the same `device` columns Apple inventory uses, so search, filters, dashboards
and the health rollup work unchanged.

- **Cadence**: a snapshot is requested at most once every six hours, tracked separately
  from `inventoryUpdatedAt`. An unanswered request is retried after the same interval, so
  a device that rejects a node does not receive the `Get` set on every check-in.
- **Name**: the reported device name is always stored as the device's physical name. It
  only becomes the management name while that is still blank or one of the auto-derived
  placeholders (enrollment DeviceID, serial, model, or the previous reported name), so an
  administrator-edited name is never overwritten and an OS-level rename still follows
  through.
- **Serial**: vendor placeholders (`To be filled by O.E.M.`, `Default string`, and similar)
  are ignored, and a serial already owned by another device in the tenant is not applied.
- **Storage**: Windows reports both figures in MB and Mattrax stores bytes. If the free
  value exceeds the total, neither figure is written. `TotalStorage` is documented as
  mobile-only; desktop devices may report no total, in which case only the model, serial
  and OS fields are populated.
- **Security**: BitLocker (`EncryptionCompliance`), the BitLocker status bitmask, TPM
  specification version, Secure Boot state, AD domain name and the Entra device id are read
  in the same snapshot. The device health rollup uses them on Windows: BitLocker off, no
  TPM, a TPM older than 2.0, Secure Boot disabled, and neither domain nor Entra joined are
  compliance reasons. They are returned by `GET /devices/:id` under `windows.security` and
  by `GET /devices/:id/health`.
- **Security rules**: the security reasons only run after the device has returned at least
  one security snapshot, so a device that rejects the nodes is not reported as having no
  TPM forever. A node the device answers with an empty value clears the stored value (for
  example after leaving a domain); a node it does not answer leaves the previous value.

## Installed applications

A second `Get` set collects installed applications once a day, tracked by
`applicationsRequestedAt` and `applicationsUpdatedAt` independent of the six-hour device
inventory:

| OMA-URI                                                                                  | Purpose                                   |
| ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| `./Vendor/MSFT/Win32AppInventory/Win32InstalledProgram/InstalledProgram?list=StructData` | Win32/MSI programs in Add/Remove Programs |
| `./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI?list=StructData`                | MSI packages deployed by Mattrax          |

`?list=StructData` returns one `Results` item per node, so the whole inventory arrives in
a single response. Each application is normalised into `device_application`:

- `bundleId` is the MSI product code when the CSP reports one, otherwise the registry key
  of the Add/Remove Programs entry. MSI packages deployed through
  `EnterpriseDesktopAppManagement` use their AMAPI-style product id.
- `name`, `version` and `publisher` come from the CSP.
- `isManaged` is true only for packages this server deployed, and a package whose
  enforcement status is not `70` (completed) is not listed as installed.
- `hasUpdateAvailable` is always false: OMA-DM reports no update metadata for Win32 apps.

The full list replaces the previous rows and `applicationsUpdatedAt` is stamped in the
same transaction. `Win32AppInventory` is available on Windows 10/11 Pro, Enterprise and
Education; a device that rejects the node reports no applications and keeps its previous
inventory. Store/modern apps are not inventoried because the `EnterpriseModernAppManagement`
inventory is unbounded and expensive on fleets with many packages.

The two sources are tracked independently. A device can answer the MSI block and reject
`Win32AppInventory` (or the reverse); a partial report only replaces the rows belonging to
the source that answered. The other source's applications survive, and the failed `Get` is
recorded in the command history with its status. A successful empty `Results` block is a
complete report for that source and does remove its previous rows.

The device page marks the list stale after seven days without a report.

Autopilot metadata is separate and still available from the Autopilot pages.

## Policy delivery

Every effective `mttx.windows.custom.<id>` configuration becomes SyncML `Replace`
commands on the next management check-in.

```json
{
  "mttx.windows.custom.bitlocker": {
    "nodes": [
      {
        "omaUri": "./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption",
        "value": 1,
        "format": "int"
      }
    ]
  }
}
```

Each `Replace` is stored as a `device_command` row with a stable id derived from the device
and OMA-URI, so the device's status is matched to the command that caused it. The applied
OMA-URIs are persisted on the device (`windows.policy.appliedUris`). On every check-in the
resolved policy is diffed against what was delivered:

- a new or changed node is sent with `Replace`;
- a node that is no longer in any policy is sent with `Delete`, which removes the CSP value
  instead of leaving the last setting on the device;
- a node the device rejected keeps its failure (`windows.policy.failed`) visible for 30
  minutes before it is retried;
- deleting a policy, removing a Wi-Fi/restriction profile, or removing a node from a
  configuration therefore reverts the setting. `windows.policy.pendingRevertUris` shows a
  delete that has not been acknowledged yet and `revertedAt` the last completed revert.

See [Windows policies](/platforms/windows/policies) for the node schema, formats and merge
rules.

## Commands

| Action     | OMA-DM command                                                              |
| ---------- | --------------------------------------------------------------------------- |
| `wipe`     | `./Device/Vendor/MSFT/RemoteWipe/doWipeProtected`                           |
| `restart`  | `./Device/Vendor/MSFT/Reboot/RebootNow`                                     |
| `unenroll` | `./Vendor/MSFT/DMClient/Provider/Mattrax/Unenroll` (Exec, provider id data) |

Other actions are rejected. In particular `sync` is not offered for Windows: there is no
push channel, so a command or policy change is delivered the next time the device polls.
The API's per-device `actions` array is the authoritative list of supported actions.

Every delivered command (policy, inventory and imperative) is recorded in the device command
history with its `locURI`, status, and result. A rejected policy command records the exact
OMA-URI and SyncML status on the device.

## Device identity

- The identity certificate is valid for 365 days and renews after 180 days.
- The certificate CN must match the Windows DeviceID.
- Revoked certificate serials are rejected on management check-in.
- The tenant is resolved from the signed tenant token, then the certificate OU, then the
  optional legacy `WINDOWS_ORGANIZATION_ID` pin.

`WINDOWS_ORGANIZATION_ID` is only for a single-tenant deployment that still uses the old
unscoped discovery URL. New deployments should use the tenant-scoped link.

## Limitations

- No BitLocker key escrow, Defender or OS-build compliance checks. Windows activation
  status is not collected: the `WindowsLicensing` CSP reports edition-upgrade state, not
  whether Windows is activated.
- Desktop Windows does not expose total disk size through OMA-DM (`TotalStorage` is
  documented as mobile-only), so storage health may be unavailable for some laptops.
- Inventory depends on the device answering `Get`; no push channel wakes it early.
- No remote lock, shutdown, app install or per-device policy push.
- Device-initiated unenroll is recognised from the OMA-DM `1226` Generic Alert. A device
  that is wiped or removed from management without sending it stays `enrolled` until an
  operator deletes or unenrolls it.
- Pre-registrations are not consumed: enrollment has no hardware serial to match.
- Federated Entra enrollment and Autopilot OOBE are fixture-tested, not validated on real
  hardware.
- There is no compliance engine; device health is derived from enrollment and staleness.

## API endpoints

| Method      | Path                                             |
| ----------- | ------------------------------------------------ |
| `POST`      | `/mdm/windows/discovery`                         |
| `POST`      | `/mdm/windows/policy`                            |
| `POST`      | `/mdm/windows/enroll`                            |
| `POST`      | `/mdm/windows/management`                        |
| `GET/PATCH` | `/api/v1/tenants/:tenantId/enrollment`           |
| `POST`      | `/api/v1/tenants/:tenantId/devices/:id/action`   |
| `POST`      | `/api/v1/tenants/:tenantId/devices/:id/unenroll` |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/commands` |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/health`   |
| `GET/POST`  | `/api/v1/tenants/:tenantId/autopilot`            |
| `POST`      | `/api/v1/tenants/:tenantId/autopilot/import`     |
| `POST`      | `/api/v1/tenants/:tenantId/autopilot/sync`       |
| `GET/POST`  | `/api/v1/tenants/:tenantId/autopilot/profiles`   |

## Next

- [Entra ID](/platforms/windows/entra-id)
- [Autopilot](/platforms/windows/autopilot)
- [Windows policies](/platforms/windows/policies)
