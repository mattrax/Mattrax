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

## Serve the ADE profile

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/abm/devices/$SERIAL/profile-url" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

The response contains a signed URL valid for seven days:

```json
{
  "serial": "C02XXXXXXXXX",
  "profileUuid": "…",
  "url": "https://e.mattrax.app/api/v1/abm/ade/<token>",
  "expiresAt": "2026-11-19T10:00:00.000Z"
}
```

The token binds tenant, serial and profile UUID. The public endpoint re-checks that the ABM
device is still assigned, not `REMOVED`, and that the profile revision matches before
serving the `.mobileconfig`.

## Zero-touch caveat

Apple's ADE flow normally returns the enrollment profile inside the `Authenticate`
response. Mattrax does **not** do that yet. A device that starts at the Setup Assistant
will contact the MDM server and then need the signed profile installed. Until this is
implemented, treat ADE as "assignment and profile delivery", not full zero-touch.

The gap is tracked in [Production readiness](/reference/production-readiness).

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
| `GET`    | `/api/v1/tenants/:tenantId/abm/devices/:serial/profile-url` | Signed ADE profile URL                 |
| `GET`    | `/api/v1/abm/ade/:token`                                    | Public profile download                |

## Troubleshooting

| Symptom                                   | Check                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| Upload rejected                           | Key is PKCS#8 EC P-256, Client/Key/Team IDs match, scope matches the org type |
| Sync says migration required              | You uploaded a legacy DEP `.p7m`; create a Business API key                   |
| Sync fails at 5,000 devices               | Apple's page cap; reduce the org scope                                        |
| Assignment fails                          | Tenant APNs certificate must be valid; the MDM server is created with it      |
| Profile URL 404s                          | Device is `REMOVED`, unassigned, or the profile revision changed              |
| Device does not enroll at Setup Assistant | The ADE profile is not yet returned by `Authenticate`; install the signed URL |

## Next

- [Apps & Books](/platforms/apple/vpp)
- [DDM and profiles](/platforms/apple/ddm)
