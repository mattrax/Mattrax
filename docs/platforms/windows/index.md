# Windows

Mattrax manages Windows through the native MDM protocols: WSTEP for enrollment and
certificate identity, and SyncML (OMA-DM) for policy and commands. Entra ID adds federated
authentication, SSO for the dashboard and Autopilot deployment profiles.

## What is supported

| Area       | Support                                                   |
| ---------- | --------------------------------------------------------- |
| Enrollment | Tenant-scoped discovery URL, WSTEP policy and certificate |
| Identity   | Device certificate, 365-day validity, 180-day renewal     |
| Policy     | OMA-URI nodes delivered as SyncML `Replace` commands      |
| Commands   | Remote wipe and restart                                   |
| Zero-touch | Autopilot hardware-hash import and deployment profiles    |
| Directory  | Entra ID SSO, directory sync, SCIM                        |
| Push       | None; devices poll on their SyncML schedule               |
| Inventory  | Minimal; Autopilot metadata only                          |

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
`TokenUpdate` step. The device has no serial, model or OS version at enrollment.

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

See [Windows policies](/platforms/windows/policies) for the node schema, formats and merge
rules.

## Commands

| Action    | OMA-DM command                                    |
| --------- | ------------------------------------------------- |
| `wipe`    | `./Device/Vendor/MSFT/RemoteWipe/doWipeProtected` |
| `restart` | `./Device/Vendor/MSFT/Reboot/RebootNow`           |

Other actions return an error: Windows supports remote erase and restart only.

There is no push channel. A command is delivered the next time the device polls. Policy
changes also wait for the next SyncML session.

## Device identity

- The identity certificate is valid for 365 days and renews after 180 days.
- The certificate CN must match the Windows DeviceID.
- Revoked certificate serials are rejected on management check-in.
- The tenant is resolved from the signed tenant token, then the certificate OU, then the
  optional legacy `WINDOWS_ORGANIZATION_ID` pin.

`WINDOWS_ORGANIZATION_ID` is only for a single-tenant deployment that still uses the old
unscoped discovery URL. New deployments should use the tenant-scoped link.

## Limitations

- No Windows inventory, BitLocker key escrow, Defender or OS-build compliance.
- No remote lock, shutdown, app install or per-device policy push.
- No Windows unenroll command; deleting the device removes the local row only.
- Pre-registrations are not consumed: enrollment has no hardware serial to match.
- Federated Entra enrollment and Autopilot OOBE are fixture-tested, not validated on real
  hardware.
- There is no compliance engine; device health is derived from enrollment and staleness.

## API endpoints

| Method      | Path                                           |
| ----------- | ---------------------------------------------- |
| `POST`      | `/mdm/windows/discovery`                       |
| `POST`      | `/mdm/windows/policy`                          |
| `POST`      | `/mdm/windows/enroll`                          |
| `POST`      | `/mdm/windows/management`                      |
| `GET/PATCH` | `/api/v1/tenants/:tenantId/enrollment`         |
| `POST`      | `/api/v1/tenants/:tenantId/devices/:id/action` |
| `GET/POST`  | `/api/v1/tenants/:tenantId/autopilot`          |
| `POST`      | `/api/v1/tenants/:tenantId/autopilot/import`   |
| `POST`      | `/api/v1/tenants/:tenantId/autopilot/sync`     |
| `GET/POST`  | `/api/v1/tenants/:tenantId/autopilot/profiles` |

## Next

- [Entra ID](/platforms/windows/entra-id)
- [Autopilot](/platforms/windows/autopilot)
- [Windows policies](/platforms/windows/policies)
