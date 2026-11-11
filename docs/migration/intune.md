# Migrating from Microsoft Intune

Intune migration is mostly Autopilot, Entra ID and OMA-URI policy. Mattrax does not
implement Intune compliance or app deployment, so plan around those gaps.

## Before you start

- Entra app registration with the Graph permissions listed in
  [Entra ID](/platforms/windows/entra-id).
- Admin consent.
- An export of Autopilot devices (serial + hardware hash) or access to the Intune portal.
- A list of configuration profiles and the OMA-URI settings that matter.
- A decision about compliance: Mattrax has derived health, not Intune compliance.

## Autopilot

1. Export the Autopilot CSV from Intune.
2. Import it into Mattrax:
   ```bash
   curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/autopilot/import" \
     -H "Authorization: Bearer $MATTRAX_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"content":"<csv>","format":"csv"}'
   ```
3. Sync from Graph.
4. Create a deployment profile with the desired `deploymentMode` and `joinType`.
5. Assign it to an Entra group.

Graph is the source of truth. If the import fails, no local rows are written.

### Known gaps

- `timezone` is stored but not sent to Graph.
- `enableDevicePreparation` maps to legacy `enableWhiteGlove`.
- Assignment is group-based only.
- Autopilot OOBE has not been validated on real hardware in this repository.

## Entra ID

Mattrax can use Entra for:

- Dashboard SSO (OIDC).
- Federated Windows enrollment (preview).
- Autopilot and directory sync (Graph).

For Windows join, the Autopilot profile's `joinType` controls `azureADJoin`,
`azureADJoinUsingDeviceAuth` or `hybridAzureADJoin`. Mattrax does not perform the join.

## Configuration profiles

Intune settings split into two groups:

### OMA-URI settings

Recreate as `mttx.windows.custom.<id>`:

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

Only `Replace` is generated. There is no `Add`, `Delete` or custom SyncML.

### Settings catalog / ADMX

There is no automatic translation. Find the equivalent OMA-URI in Microsoft's policy CSP
reference or use a custom SyncML tool. Mattrax does not support ADMX ingestion.

## Compliance

Intune compliance policies have no direct equivalent. Mattrax provides:

- Enrollment and last-seen state.
- DDM/declaration failures.
- FileVault and disk pressure (Apple).
- Battery condition (Apple).
- A derived health level.

There is no conditional access integration, no pass/fail compliance state and no
remediation engine. If you rely on Intune compliance for Conditional Access, keep Intune or
use a third-party signal.

## Apps

- Intune Win32/MSI deployment is not implemented.
- Store apps can be catalogued but not installed on Windows.
- Use your existing software distribution tool for Windows apps.

## BitLocker

Mattrax does not escrow BitLocker keys. Keep Intune or another escrow system for Windows
recovery keys.

## Coexistence and cutover

1. Pilot a group of Autopilot devices.
2. Import only the pilot hashes first.
3. Keep Intune compliance and app policies for the rest of the fleet.
4. Do not enroll a device in both MDMs.
5. Move devices in batches by Autopilot group tag or Entra group.
6. Validate policy application in the SyncML command history.
7. Decommission Intune only after compliance and app needs are covered elsewhere.

## Cutover checklist

- [ ] Graph app created and consented.
- [ ] Autopilot pilot hashes imported.
- [ ] Deployment profile created and assigned.
- [ ] OMA-URI policies recreated and assigned.
- [ ] Entra SSO configured (optional).
- [ ] Pilot devices reset and enrolled.
- [ ] Policy convergence verified.
- [ ] Compliance/app gaps accepted or covered.
- [ ] Remaining devices moved in batches.
- [ ] Intune decommissioned.

## Next

- [Windows](/platforms/windows/)
- [Autopilot](/platforms/windows/autopilot)
- [Windows policies](/platforms/windows/policies)
