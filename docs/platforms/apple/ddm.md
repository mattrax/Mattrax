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

Every tenant gets three declarations:

| Type          | Identifier                             | Purpose                                                                        |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| Activation    | `DAAF574F-36D4-4089-B2E3-D2008B65D5BE` | Activates the status subscription configuration                                |
| Configuration | `13DE3EE0-D5A8-46E9-B967-27E56A4D918F` | `com.apple.configuration.management.status-subscriptions` with 18 status items |
| Management    | `F8C4C3A1-…`                           | `com.apple.management.organization-info` from tenant branding                  |

Status items include serial number, model, OS version/build, FileVault state, battery
health, disk capacity, client capabilities and declaration state. They populate device
inventory without a separate command.

Each policy scope gets one activation: the group id, or `direct:<policyId>` for a direct
device assignment.

## Configuration kinds

| Kind                          | Delivered as                                                      | Notes                                                                |
| ----------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| `mttx.apple.device`           | Legacy profile via DDM                                            | Currently only `{ "camera": boolean }`                               |
| `mttx.apple.custom.<id>`      | Legacy profile via DDM                                            | Your uploaded `.mobileconfig`, served verbatim                       |
| `mttx.apple.certificate.<id>` | `com.apple.configuration.security.certificate` + credential asset | Certificate is a PEM asset with SHA-256 and size                     |
| `mttx.apple.declaration.<id>` | Raw Apple declaration                                             | You supply `kind` and `configuration`                                |
| `mttx.apple.application.<id>` | —                                                                 | Rejected: application deployment is not implemented through policies |

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

The token is HMAC-signed with `AUTH_SECRET` and binds the policy, kind and (for profiles)
the device token. Asset identifiers use `<policyId>.<kind>.asset`. An mTLS identity
certificate whose OU matches the tenant is also accepted for assets.

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
- `mttx.apple.application.<id>` is rejected.
- There is no automatic profile install command; profiles are pulled through DDM.
- There is no CRL/OCSP endpoint for certificates.
- DDM status reports persist declaration state and inventory but do not implement a
  compliance engine.

## Next

- [Apple security and inventory](/platforms/apple/security)
- [Policies](/manage/policies)
