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
| Commands   | Wipe, restart, unenroll, Fresh Start and diagnostic collection     |
| Zero-touch | Autopilot hardware-hash import and deployment profiles            |
| Directory  | Entra ID SSO, directory sync, SCIM                                |
| Push       | None; devices poll on their SyncML schedule                       |
| Inventory  | Identity, OS, storage, BitLocker, TPM, Secure Boot and join state |
| Secrets    | Windows LAPS password and BitLocker recovery key escrow           |

## Prerequisites

- A trusted HTTPS origin.
- A Windows device that can reach the discovery URL.
- For Entra join or Autopilot: a Microsoft Entra tenant and an app registration with the
  required Graph permissions. See [Entra ID](/platforms/windows/entra-id).
- For policy: at least one `mttx.windows.custom.<id>` or `mttx.windows.laps` configuration.
- For LAPS password retrieval: the Graph application permission
  `DeviceLocalCredential.Read.All` and admin consent. This permission is only used by the
  explicit reveal endpoint.
- For BitLocker recovery keys and rotation: an Entra-joined or hybrid-joined device, a
  BitLocker policy that backs recovery information up to Microsoft Entra ID, and the Graph
  `BitlockerKey.Read.All` application permission with admin consent.

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

The device requests a WSTEP policy, then submits a CSR. Mattrax signs it with the tenant's
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

## Application delivery

A Windows application catalogue entry installs an MSI through the native MDM channel.
`bundleId` must be the MSI ProductCode (GUID) and `manifestUrl` the HTTPS URL of the signed
`.msi`. The install endpoint queues a SyncML `Exec` on:

```text
./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/{ProductCode}/DownloadInstall
```

The `Data` is an `MsiInstallJob` document with the download URL, SHA-256 digest and
`/quiet /norestart` enforcement. The command result carries the msiexec HRESULT; the daily
`EnterpriseDesktopAppManagement/MSI` inventory reports the product, its status and managed
state. An `.exe`/`.intunewin` (Intune Management Extension) or a Store/MSIX package is
reported as unsupported rather than queued. See
[Applications](/manage/applications#windows).

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

| Action                       | OMA-DM command                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `wipe`                       | `./Device/Vendor/MSFT/RemoteWipe/doWipeProtected`                              |
| `restart`                    | `./Device/Vendor/MSFT/Reboot/RebootNow`                                        |
| `fresh-start`                | `./Device/Vendor/MSFT/CleanPC/CleanPCRetainingUserData` or `CleanPCWithoutRetainingUserData` (Exec, `1`) |
| `collect-diagnostics`        | `./Vendor/MSFT/DiagnosticLog/DiagnosticArchive/ArchiveDefinition` (Exec, Collection XML) |
| `rotate-bitlocker-key`       | `./Device/Vendor/MSFT/BitLocker/RotateRecoveryPasswords` (Exec, request id)    |
| `rotate-local-admin-password` | `./Device/Vendor/MSFT/LAPS/Actions/ResetPassword` (Exec)                      |
| `unenroll`                   | `./Vendor/MSFT/DMClient/Provider/Mattrax/Unenroll` (Exec, provider id data)    |

Other actions are rejected. In particular `sync` is not offered for Windows: there is no
push channel, so a command or policy change is delivered the next time the device polls.
The API's per-device `actions` array is the authoritative list of supported actions and is
derived from the platform, OS build/edition, join state and effective LAPS policy. The API
rejects an unsupported action with the reason instead of queueing a command that the device
can never run.

Every delivered command (policy, inventory and imperative) is recorded in the device command
history with its `locURI`, status, and result. A rejected policy command records the exact
OMA-URI and SyncML status on the device. Friendly labels are shown for the Windows actions
above; the raw request type remains in the API.

### Fresh Start

`fresh-start` removes OEM and user-installed applications through the CleanPC CSP. The
caller must send `freshStartRetainUserData` explicitly:

- `true` uses `CleanPCRetainingUserData`; user files stay, applications are removed.
- `false` uses `CleanPCWithoutRetainingUserData`; the device returns to OOBE and must be
  enrolled again.

Both modes are destructive and require a fresh step-up plus the `device.fresh-start`
approval when an approval policy covers that action. CleanPC is only available on Windows
Enterprise and Education (not Pro or Home), on Windows 10 1703 (build 15063) or later.
The dashboard shows the retention choice before queueing and warns about re-enrolment for
the non-retaining mode.

### Diagnostic collection

`collect-diagnostics` queues the DiagnosticArchive CSP with a Collection XML containing only
Microsoft's allow-listed directives: HKLM policies/enrolment registry keys, Application,
System and the DeviceManagement-Enterprise-Diagnostics event channel,
`MdmDiagnosticsTool.exe`, and ETL/log files under `%ProgramData%`. It never enables
arbitrary commands or user document paths.

The CSP uploads one ZIP to a signed, device-scoped URL on this deployment
(`PUT /api/v1/windows-diagnostics/upload`; POST is also accepted for tests and proxies).
The server verifies the token, the ZIP signature,
the 64 MB cap and the archive's pending state, then stores the bytes in R2 under
`diagnostics/<tenant>/<device>/<archive>.zip`. Archives expire 24 hours after the request;
the download link is a short-lived (15 minute) tenant-scoped token and the maintenance sweep
deletes expired rows and objects. The device page lists pending/uploaded/failed archives and
the command history records the CSP result. DiagnosticArchive is available on Windows 10
1903 (build 18362) and later.

### Windows LAPS

A LAPS policy is a structured configuration kind:

```json
{
  "mttx.windows.laps": {
    "backupDirectory": "entra-id",
    "accountName": "MattraxAdmin",
    "passwordAgeDays": 30,
    "passwordLength": 20,
    "passwordComplexity": 4,
    "postAuthenticationActions": 3,
    "postAuthenticationResetDelayHours": 24
  }
}
```

It compiles to the documented `./Device/Vendor/MSFT/LAPS/Policies/...` nodes. A raw
`mttx.windows.custom.*` configuration targeting the same OMA-URIs is also recognised for
compatibility. Supported values and dependencies are the Microsoft LAPS CSP ranges; notably
an Entra-backed password age must be at least 7 days.

The device must be Windows 11 22H2 (build 22621, with the March 2023 update) or later, or
Windows Server 2025. The API advertises `rotate-local-admin-password` only when a LAPS
policy applies.

Password retrieval is available only when `backupDirectory` is `entra-id`, the device is
Entra joined and its inventory has reported `AADDeviceID`. Mattrax reads the password from
Microsoft Entra ID with `GET /v1.0/directory/deviceLocalCredentials/{deviceId}` using the
tenant's Graph app, decodes Graph's Base64 UTF-16LE password, seals it with `AUTH_SECRET`
and records the Entra backup and refresh times. It does not integrate with Active Directory;
an AD-only policy is rejected with that explanation. An expired password (older than the
policy age) is still returned so the help desk can try it, but the response and UI mark it
expired.

`GET /v1/tenants/:tenantId/devices/:id/laps-password?reason=...` requires
`devices.recovery_key`, a fresh step-up and a reason. Every reveal is audited as
`device.windows_laps_password_viewed`; the password never appears in device list, search,
CSV, webhook or MCP payloads. Rotation queues `ResetPassword` and reads
`ResetPasswordStatus`; the next Entra backup is reconciled when the password is next read.

### BitLocker recovery keys and rotation

Mattrax reads BitLocker recovery keys from **Microsoft Entra ID**, not from an on-device
agent. This is the only supported escrow path; Windows OMA-DM has no generic recovery-key
upload node, and the Windows build of `mattraxd` does not collect keys.

Prerequisites:

- The device reports a Microsoft Entra device id (`AADDeviceID`) in inventory, so it is
  Entra joined or hybrid joined. A plain AD domain join is not supported.
- BitLocker backs recovery information up to Microsoft Entra ID.
- The Graph application has `BitlockerKey.Read.All` application permission with admin
  consent. Listing key metadata uses the least-privileged read; fetching the actual key for
  a reveal uses `GET /informationProtection/bitlocker/recoveryKeys/{id}?$select=key`, which
  Microsoft Entra audits.

`GET /devices/:id/windows-security` refreshes the metadata-only list (cached for 10
minutes; a reveal that misses the cache forces a fresh list), retires keys Entra no longer
lists, and returns key id, volume type, capture time,
age, stale health (180 days), sync time/error and rotation state. It never returns key
material. The first list has no key material; an authorised reveal fetches the key from
Graph, seals it with `AUTH_SECRET` and caches it for later reveals.

A reveal requires `devices.recovery_key`, a fresh step-up and a reason via
`GET /devices/:id/bitlocker-keys/:keyId/reveal?reason=...`; every reveal is audited as
`device.bitlocker_key_viewed` and Microsoft Entra separately audits the `$select=key` read.
Rotation uses `RotateRecoveryPasswords` with an opaque request id. The status Get is queued
on the check-in after the Exec is acknowledged and polled on later check-ins until
`Status/RotateRecoveryPasswordsStatus` is terminal (0 pass, 1 pending, 2 not started).
Mattrax does not separately read `Status/RotateRecoveryPasswordsRequestID`: its action
guard rejects a second rotation while the Exec or status command is active, so at most one
Mattrax rotation is in flight. A rotation started outside Mattrax is not reconciled.
Only the documented `DM_S_ACCEPTED_FOR_PROCESSING` value is treated as an acknowledgement;
`202 Accepted` is not a SyncML status and remains a failure. A terminal status closes the
parent Exec so `rotationInProgress` clears; an Exec that never terminates expires through
its 24-hour budget. Microsoft's rotation CSP requires the
recovery information backup to be required (for example "Do not enable BitLocker until
recovery information is stored to AD DS" for an AD-backed policy); the Entra path requires
an Entra device id and the device to be encrypted on Windows 10 1909 or later.

The Graph list/reveal, sealed cache, retirement and rotation-status paths are fixture-tested
server-side. There is no real Windows hardware or Entra tenant in this repository's test
environment, so end-to-end recovery-key retrieval and rotation are not hardware-validated.

## Device identity

- The identity certificate is valid for 365 days and renews after 180 days.
- The certificate CN must match the Windows DeviceID.
- Revoked certificate serials are rejected on management check-in.
- The tenant is resolved from the signed tenant token, then the certificate OU, then the
  optional legacy `WINDOWS_ORGANIZATION_ID` pin.

`WINDOWS_ORGANIZATION_ID` is only for a single-tenant deployment that still uses the old
unscoped discovery URL. New deployments should use the tenant-scoped link.

## Activation and licensing

No OMA-DM CSP reports whether Windows is activated. The `WindowsLicensing` CSP is the only
licensing-related CSP, and it reports the edition, edition-upgrade state and subscription
licensing — not the base activation state. Microsoft exposes that state as
`SoftwareLicensingProduct.LicenseStatus` over WMI, so it needs `mattraxd`.

`mattraxd` samples the active Windows SKU and posts the raw values to
`POST /api/v1/windows-agent/activation` with the same device bearer token as the script
channel:

```powershell
$os = Get-CimInstance Win32_OperatingSystem

Get-CimInstance SoftwareLicensingProduct |
  Where-Object { $_.PartialProductKey -and $_.Name -like 'Windows*' } |
  Select-Object LicenseStatus, Name, ProductKeyChannel, @{ n = 'Edition'; e = { $os.Caption } }
```

The body maps those columns to `licenseStatus`, `licenseName`, `productKeyChannel` and
`edition`; `sampledAt` is optional and defaults to the ingest time. A sample older than the
one already stored is ignored (`applied: false`), and a future clock or a timestamp outside
MySQL's `datetime` range is clamped to the ingest time so a bad clock cannot break reporting.

**Scope in this repository:** Mattrax ships only the ingestion side of this channel. The
release workflow publishes a standalone `mattraxd.exe` zip for the runtime and updater, but
there is no Windows installer or MSI, and no API issues a device token.
The bearer token is the same HMAC-derived token the Windows script channel expects
(`scriptAgentToken(deviceId, AUTH_SECRET)`), so whatever installs `mattraxd` has to provision
it. Until `mattraxd` posts a sample, a Windows device shows "Not reported" and never matches
the unactivated filter; nothing in OMA-DM fills this in.

The server keeps the raw `LicenseStatus` (0-6), licence name, product-key channel and the WMI
edition, and normalises the state: `1` (Licensed) is `activated`; `0` (Unlicensed), the grace
states (`2`-`4`), `5` (Notification) and `6` (Extended grace) are `not-activated`; a missing,
fractional or out-of-range value is stored as `null` and shown as `unknown`. Devices without
`mattraxd`, and every non-Windows platform, have no activation state at all rather than an
invented "not activated".

The device page shows the state, installed edition and channel, and the device list can
filter and sort by activation (including "not activated"). The raw `LicenseStatus` stays in
the API for support rather than being shown as an unexplained integer.

## Limitations

- BitLocker recovery keys come from Microsoft Entra ID only. Plain AD-domain-joined devices,
  devices that do not back up recovery information to Entra, and tenants without
  `BitlockerKey.Read.All` consent have no recoverable keys in Mattrax. The Graph list, reveal
  cache and rotation-status paths are fixture-tested, not validated on real hardware or a
  real Entra tenant. There is no Defender or OS-build compliance engine. Windows activation
  and licensing are collected by `mattraxd` on Windows (see above), not by OMA-DM: the
  `WindowsLicensing` CSP reports edition-upgrade and subscription state, not base activation.
- Windows LAPS retrieval is Entra-only. An Active Directory-backed policy can still rotate
  the password, but Mattrax cannot read it from AD. LAPS is supported only on Windows 11
  22H2+/Server 2025; Windows 10's backport is deliberately rejected.
- Fresh Start is Enterprise/Education only. It removes applications and OEM provisioning;
  it is not a replacement for an Intune compliance policy.
- Diagnostic archives are capped at 64 MB and expire after 24 hours. The CSP can still reject
  an individual directive; the command history shows that rejection. Large log sets should be
  collected in smaller scopes.
- Desktop Windows does not expose total disk size through OMA-DM (`TotalStorage` is
  documented as mobile-only), so storage health may be unavailable for some laptops.
- Inventory depends on the device answering `Get`; no push channel wakes it early.
- No remote lock, shutdown or per-device policy push.
- Only MSI application installs are supported; `.exe`/`.intunewin` and Store apps are not.
- Scripts are not delivered: the Windows build of `mattraxd` does not implement
  `GET /api/v1/script-agent/scripts` yet, so script runs and script-collected device
  attributes are unsupported on Windows. The API reports that instead of queueing a run
  nothing would collect; see [Scripts](/manage/scripts#collect-device-attributes).
- Device-initiated unenroll is recognised from the OMA-DM `1226` Generic Alert. A device
  that is wiped or removed from management without sending it stays `enrolled` until an
  operator deletes or unenrolls it.
- Pre-registrations are not consumed: enrollment has no hardware serial to match.
- Federated Entra enrollment and Autopilot OOBE are fixture-tested, not validated on real
  hardware.
- There is no compliance engine; device health is derived from enrollment and check-in age
  (stale after 7 days, MIA after 14, auto-unenrolled after 30 by default).

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
| `POST`      | `/api/v1/windows-agent/activation`               |
| `PUT/POST`  | `/api/v1/windows-diagnostics/upload`             |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/windows-security` |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/laps-password` |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/bitlocker-keys/:keyId/reveal` |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/diagnostics` |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/diagnostics/:archiveId/download` |
| `GET/POST`  | `/api/v1/tenants/:tenantId/autopilot`            |
| `POST`      | `/api/v1/tenants/:tenantId/autopilot/import`     |
| `POST`      | `/api/v1/tenants/:tenantId/autopilot/sync`       |
| `GET/POST`  | `/api/v1/tenants/:tenantId/autopilot/profiles`   |

## Next

- [Entra ID](/platforms/windows/entra-id)
- [Autopilot](/platforms/windows/autopilot)
- [Windows policies](/platforms/windows/policies)
