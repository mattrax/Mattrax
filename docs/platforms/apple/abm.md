# Apple Business Manager (ABM/ADE)

Apple Business Manager assigns devices to an MDM server. Mattrax uses the ABM Business API
to list devices, create or reuse an MDM server, assign devices and serve a signed ADE
enrollment profile.

## What you need

- An Apple Business Manager account with the **Device Enrollment** role.
- Devices purchased through Apple, an authorized reseller or Apple Configurator, assigned
  to your ABM organization.
- APNs configured for the tenant. The ABM MDM server registration uses the tenant APNs
  certificate.
- An ABM API key with access to the Business API.

## Create the ABM API key

1. In Apple Business Manager, open **Settings → API keys** (or **Access Management →
   Integrations** depending on your ABM version).
2. Create a key with device and MDM server access.
3. Download the private key once. It is an unencrypted PKCS#8 EC P-256 key.
4. Record the **Client ID**, **Key ID** and **Team ID**.

Mattrax also accepts a JSON bundle containing the same fields. A legacy DEP `.p7m` server
token can be uploaded and is stored and displayed, but it cannot sync: the current Apple
API is OAuth-only. Uploading a legacy token produces a migration message.

## Upload the credential

**Settings → Management → Apple Business Manager → Connect**, or:

```bash
curl -X PUT "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/abm/token" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "BUSINESSAPI....",
    "keyId": "....",
    "teamId": "....",
    "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
    "scope": "business.api"
  }'
```

Mattrax exchanges an ES256 client assertion for a one-hour bearer token and validates the
credential immediately. Tokens are never persisted. A rejected credential stores
`status: error` and `lastError` on the tenant.

For school organizations use `scope: "school.api"`; the API base becomes
`https://api-school.apple.com/v1`.

## Sync devices

**Sync** pages `orgDevices`, upserts each device by `(organization, serial)`, links an
already-enrolled Mattrax device by serial and marks devices missing from Apple as
`REMOVED`.

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/abm/sync" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

:::warning 5,000 device cap
A single sync fails if Apple returns more than 5,000 devices. Split the ABM organization
or sync a narrower scope before retrying.
:::

## Assign devices to Mattrax

Assignment makes a device eligible for ADE. Mattrax ensures an MDM server exists (reusing
one with the same name, otherwise creating one with the tenant APNs certificate), then
calls `orgDeviceActivities` with `ASSIGN_DEVICES`.

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/abm/devices/$SERIAL/assign" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

You can also assign devices manually in Apple Business Manager. Keep the MDM server name
stable: renaming it creates a second server in Apple's records.

## Serve the ADE profile automatically

Apple's ADE flow normally fetches the enrollment profile from the `url` of
the **ADE profile** (the JSON cloud configuration Apple stores for the device
management service) while the device is in Setup Assistant.

:::warning Inline Authenticate profile is best-effort and unverified
Mattrax also includes the tenant-signed profile in the first `Authenticate`
response for an ABM-assigned serial, under the `EnrollmentProfile` key. Apple's
published MDM protocol says the body of an `Authenticate` response is ignored,
so this is not a tested zero-touch mechanism and real hardware may discard it.
Do not rely on it: register the ADE profile `url` below.
:::

The stable ADE endpoint below is the supported path and is what Apple's
cloud configuration must point at:

```
POST https://<your-mattrax-origin>/api/v1/abm/ade/enroll
```

The device POSTs a CMS-signed `MachineInfo` plist. Mattrax verifies the signature
against Apple's device CA, looks up the serial in the tenant's ABM inventory and
returns the signed `.mobileconfig`. The URL is the same for every device in the
tenant: there is no per-device token to mint or install.

Register this URL, with `await_device_configured: true`, in the ADE profile for
the tenant. Apple's Business API currently exposes device-management-service
creation and assignment but not ADE cloud-configuration registration, so this is
the one step an ABM administrator performs in Apple Business Manager / Apple
Configurator (or through a legacy DEP profile). The profile document looks like:

```json
{
  "profile_name": "Acme Automated Device Enrollment",
  "url": "https://<your-mattrax-origin>/api/v1/abm/ade/enroll",
  "is_supervised": true,
  "is_mdm_removable": false,
  "is_mandatory": true,
  "await_device_configured": true,
  "is_return_to_service": true
}
```

`await_device_configured` is a cloud-configuration key, not a key in
`com.apple.mdm`. A `.mobileconfig` cannot set it. When it is true, the device
reports `AwaitingConfiguration` in `TokenUpdate`, and Setup Assistant waits for
the `DeviceConfigured` command. Mattrax queues the setup payload (managed local
administrator on macOS, initial declarations or legacy profiles) and sends
`DeviceConfigured` only after the DDM `management.declarations` report is valid.
Until then the device is shown as **Awaiting setup**, not healthy or enrolled.
The MDM payload advertises `com.apple.mdm.bootstraptoken`, so the device escrows
its bootstrap token itself with `SetBootstrapToken`; there is no bootstrap-token
profile to install.

### Manual profile link

`GET /api/v1/tenants/:tenantId/abm/devices/:serial/profile-url` remains available
for Apple Configurator or a manual install. The returned URL is bound to the
tenant, serial and profile revision, and now expires after one hour. It is not
needed for the automatic path above.

## Setup states

| State             | Meaning                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Awaiting setup    | ADE device is held in Setup Assistant; `configured` is false                                                |
| Enrolled          | `DeviceConfigured` was acknowledged (or the device never awaited setup)                                     |
| Return to Service | An erase was queued for iOS 17+, tvOS 18+ or visionOS 26+ with an assigned Wi-Fi profile; macOS is rejected |

## Device states

| State        | Meaning                                             |
| ------------ | --------------------------------------------------- |
| `ASSIGNED`   | Assigned to the Mattrax MDM server                  |
| `UNASSIGNED` | In ABM but not assigned to an MDM server            |
| `REMOVED`    | No longer returned by Apple; hidden from assignment |
| `error`      | The last sync or assignment failed; see `lastError` |

## API endpoints

| Method   | Path                                                        | Purpose                                |
| -------- | ----------------------------------------------------------- | -------------------------------------- |
| `GET`    | `/api/v1/tenants/:tenantId/abm`                             | Credential, org, MDM server and counts |
| `PUT`    | `/api/v1/tenants/:tenantId/abm/token`                       | Upload and validate a credential       |
| `DELETE` | `/api/v1/tenants/:tenantId/abm/token`                       | Remove the credential and ABM rows     |
| `POST`   | `/api/v1/tenants/:tenantId/abm/sync`                        | Sync devices from Apple                |
| `GET`    | `/api/v1/tenants/:tenantId/abm/devices`                     | List ABM devices                       |
| `GET`    | `/api/v1/tenants/:tenantId/abm/devices/:serial`             | One ABM device                         |
| `POST`   | `/api/v1/tenants/:tenantId/abm/devices/:serial/assign`      | Assign to the Mattrax MDM server       |
| `GET`    | `/api/v1/tenants/:tenantId/abm/devices/:serial/profile-url` | Signed ADE profile URL (one hour)      |
| `GET`    | `/api/v1/abm/ade/:token`                                    | Public profile download (manual path)  |
| `POST`   | `/api/v1/abm/ade/enroll`                                    | Setup Assistant ADE enrollment         |

## Troubleshooting

| Symptom                                   | Check                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Upload rejected                           | Key is PKCS#8 EC P-256, Client/Key/Team IDs match, scope matches the org type                                                 |
| Sync says migration required              | You uploaded a legacy DEP `.p7m`; create a Business API key                                                                   |
| Sync fails at 5,000 devices               | Apple's page cap; reduce the org scope                                                                                        |
| Assignment fails                          | Tenant APNs certificate must be valid; the MDM server is created with it                                                      |
| Profile URL fails                         | Unassigned/`REMOVED` devices and changed revisions return 400; an absent inventory serial returns 404                         |
| Device sits at Remote Management          | The ADE profile has `await_device_configured`; the device page shows **Awaiting setup** until the declaration report is valid |
| Device does not enroll at Setup Assistant | The ADE profile `url` must be `/api/v1/abm/ade/enroll`, and the device must be `ASSIGNED` in ABM                              |
| `enroll` returns 403                      | The CMS MachineInfo did not verify against Apple's device CA, or the serial is unassigned                                     |

## Next

- [Apps & Books](/platforms/apple/vpp)
- [DDM and profiles](/platforms/apple/ddm)
