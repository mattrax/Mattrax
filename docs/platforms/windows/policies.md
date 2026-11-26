# Windows policies

Windows policy is delivered as SyncML `Replace` commands generated from OMA-URI nodes.

## Configuration shape

A policy configuration uses the kind `mttx.windows.custom.<id>` and one of two shapes:

```json
{
  "mttx.windows.custom.bitlocker": {
    "omaUri": "./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption",
    "value": 1,
    "format": "int"
  }
}
```

or a group of nodes:

```json
{
  "mttx.windows.custom.security": {
    "nodes": [
      {
        "omaUri": "./Device/Vendor/MSFT/Defender/AllowRealtimeMonitoring",
        "value": 1,
        "format": "int"
      },
      {
        "omaUri": "./Device/Vendor/MSFT/Policy/Config/DeviceGuard/EnableVirtualizationBasedSecurity",
        "value": 1,
        "format": "int"
      }
    ]
  }
}
```

### Fields

| Field    | Required | Notes                                         |
| -------- | -------- | --------------------------------------------- |
| `omaUri` | Yes      | Must start with `./`                          |
| `value`  | Yes      | String, number or boolean matching the format |
| `format` | Yes      | `int`, `chr`, `bool`, `xml`, `b64` or `node`  |

The `<id>` suffix is up to 20 alphanumeric characters.

## Certificate profiles

Windows certificate deployment uses dedicated kinds rather than hand-written OMA-URI:

| Kind                            | CSP                                                                 |
| ------------------------------- | ------------------------------------------------------------------- |
| `mttx.windows.certificate.<id>` | `RootCATrustedCertificates/Root/{sha1}/EncodedCertificate`          |
| `mttx.windows.pfx.<id>`         | `ClientCertificateInstall/PFXCertInstall/{id}`                      |
| `mttx.windows.pkcs.<id>`        | Same PFXCertInstall path; the PKCS#12 was issued by an enterprise CA |

The trusted root takes a PEM. Mattrax decodes it, computes the SHA-1 node name and sends
the base64 DER. It is always device-scoped: Windows does not support
`./User/.../RootCATrustedCertificates/Root`.

PFX and PKCS profiles store these nodes:

```text
./{Device|User}/Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/{id}/KeyLocation
./{Device|User}/Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/{id}/PFXKeyExportable
./{Device|User}/Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/{id}/PFXCertPasswordEncryptionType
./{Device|User}/Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/{id}/PFXCertPassword
./{Device|User}/Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/{id}/PFXCertBlob
```

`KeyLocation` maps to the CSP's 1–4 values (TPM required, TPM preferred, software,
Windows Hello). `PFXKeyExportable` defaults to false and is only true for software storage;
`windows-hello` also gets the required `ContainerName`. The CSP requires `Add` for the first
`PFXCertBlob` and `Replace` only when a blob was previously delivered, so the delivery path
chooses the operation from acknowledged state. Removing a profile sends `Delete` on the
parent `PFXCertInstall/{id}` node, which removes the certificate and private key together.

The password is sealed at rest with `AUTH_SECRET`; `PFXCertPasswordEncryptionType` is 0
because encrypting it for the device requires an MDM certificate encryption key Mattrax
does not provision. The PFX itself still has its own password, and the whole exchange is
inside the authenticated SyncML channel. The stored `device_command` payload for the
password and blob nodes is sealed too, so command history and logical backups do not
retain the private key in plaintext.

Windows has no native PKCS/NDES client in OMA-DM, so `mttx.windows.pkcs` documents the
enterprise CA, template, subject format, key usage and renewal, then delivers the PKCS#12
that the operator issued externally. It is not automatic issuance. Use the user channel
for a per-user certificate: the profile stores that choice and emits `./User/` paths.

The PKCS#12 is the same for every device/user in scope. Per-device unique issuance
requires an external CA connector. A PFX node set is not wrapped in an OMA-DM atomic
command, so a device can observe a partial install and retry; the blob is sent last.

## Delivery

On each SyncML management check-in, Mattrax resolves the device's effective policy and
diffs it against the OMA-URIs already delivered:

- a new or changed node is sent as a `Replace` command;
- a node that is no longer provided by any policy is sent as a `Delete` command, which
  removes the CSP node (and its subtree) instead of leaving the last value on the device;
- the device returns a status per command:
  - `200` — applied
  - `418` — queued
  - anything else — failed, with the failing OMA-URI and status recorded on the device

Each `Replace`/`Delete` has a stable `device_command` row derived from the device and
OMA-URI, so its result updates the same row and the policy delivery state. The device
payload exposes:

- `windows.policy.appliedUris` — acknowledged settings;
- `windows.policy.pendingUris` — delivered but not acknowledged;
- `windows.policy.pendingRevertUris` — deletes in flight;
- `windows.policy.failed` — last rejection per OMA-URI, including status and detail;
- `windows.policy.revertedAt` — when the last removal was acknowledged.

A rejected node is retried after 30 minutes (or immediately if its value changes).

## Merge and precedence

- Multiple policies can contribute nodes.
- Duplicate OMA-URIs are resolved deterministically by lexicographic policy id; the first
  policy wins.
- Standard policy resolution still applies: direct excludes, direct includes, group
  excludes, then priority and recency.

Use the effective-policy endpoint to see which policy won:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/effective-policy" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

## Windows LAPS policy

LAPS is a structured policy kind that compiles to the documented CSP nodes:

```json
{
  "mttx.windows.laps": {
    "backupDirectory": "entra-id",
    "accountName": "MattraxAdmin",
    "passwordAgeDays": 30,
    "passwordLength": 20,
    "passwordComplexity": 4,
    "passphraseLength": 6,
    "postAuthenticationActions": 3,
    "postAuthenticationResetDelayHours": 24,
    "passwordExpirationProtection": true
  }
}
```

`backupDirectory` is `entra-id`, `active-directory` or `disabled`. Only `entra-id` allows
Mattrax to retrieve the password; AD-only policies are delivered and rotated but cannot be
read. `disabled` policies cannot be rotated because the new password would be stored
nowhere. Passphrase complexity (6-8) is Windows 11 24H2+ only and is rejected on the 22H2
baseline; `passwordExpirationProtection` is only emitted for an AD backup. See
[Windows LAPS](/platforms/windows/#windows-laps) for the platform baseline, Graph permission
and reveal contract.

A raw `mttx.windows.custom.*` configuration with
`./Device/Vendor/MSFT/LAPS/Policies/...` nodes is also accepted, which keeps an existing
hand-authored policy working. The structured kind validates Microsoft's ranges before
delivery.

## Commands

| Action                        | URI                                                                    |
| ----------------------------- | ---------------------------------------------------------------------- |
| `wipe`                        | `./Device/Vendor/MSFT/RemoteWipe/doWipeProtected`                      |
| `restart`                     | `./Device/Vendor/MSFT/Reboot/RebootNow`                                |
| `fresh-start`                 | `./Device/Vendor/MSFT/CleanPC/CleanPCRetainingUserData` or `CleanPCWithoutRetainingUserData` |
| `collect-diagnostics`         | `./Vendor/MSFT/DiagnosticLog/DiagnosticArchive/ArchiveDefinition`      |
| `rotate-bitlocker-key`        | `./Device/Vendor/MSFT/BitLocker/RotateRecoveryPasswords`              |
| `rotate-local-admin-password` | `./Device/Vendor/MSFT/LAPS/Actions/ResetPassword`                      |

Everything else is rejected. There is no push; commands wait for the next poll. The
per-device `actions` array is the authority; it omits an action when the OS build,
edition, join state or LAPS policy makes it impossible, and the API returns that reason.

## Authoring tips

- Use the Microsoft OMA-URI reference for the exact node path and value type.
- Prefer one configuration per feature area (`bitlocker`, `defender`, `edge`) so rollback
  is granular.
- Keep ids short and stable; the id appears in declaration identifiers and logs.
- Do not put secrets in OMA-URI values. Policy data is stored in the database and returned
  by the API.

## Limitations

- The server generates `Replace` and `Delete` commands for OMA-URI settings. There is no
  `Add`, arbitrary `Exec` or custom SyncML authoring, and inventory `Get` requests are
  server-generated.
- No app install or per-device policy push; devices poll. BitLocker escrow is delivered
  through the agent channel, not policy (Windows has no recovery-key upload CSP node).
- LAPS policy delivery is subject to the CSP's own dependencies; for example Entra-backed
  password age must be at least 7 days.
- ADMX templates can be imported in the designer: Microsoft in-box policies map to their
  existing `ADMX_*` catalogue URI, and vendor templates are ingested with
  `ConfigOperations/ADMXInstall`. The designer is device-scoped, so user-scoped templates
  must be added through the policy editor. See
  [Policy catalogue](/reference/policy-catalogue#admx-imports) for the URI scheme and limits.
- The policy designer's Windows catalogue is large; see
  [Policy catalogue](/reference/policy-catalogue).

## Next

- [Windows enrollment](/platforms/windows/)
- [Policies](/manage/policies)
- [CIS benchmark templates](/reference/cis-templates)
