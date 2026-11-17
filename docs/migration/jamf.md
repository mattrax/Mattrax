# Migrating from Jamf

Jamf Pro is Apple-focused. The migration is mostly ABM reassignment, profile re-upload and
group/policy reconstruction.

## Before you start

- Confirm you have the ABM role needed to move devices between MDM servers.
- Export a device inventory with serial, name, asset tag, model and group.
- Export the configuration profiles you want to keep as `.mobileconfig`.
- Export smart group definitions for reference.
- Record VPP/Apps & Books location tokens.
- Decide how FileVault recovery keys will remain accessible during the transition.

## Device inventory

Jamf can export a CSV. Map it to Mattrax's pre-registration format:

```csv
serial,name,asset_tag,group,notes
C02XXXXXXX,Reception Mac,AST-1042,Macs,Front desk
```

Import in **Devices → Import CSV**. Apple `Authenticate` consumes the row by serial and
applies the name, asset tag, notes and group.

If a device already exists in Mattrax with the same serial, the pre-registration updates
it.

## ABM reassignment

1. In Apple Business Manager, find the Jamf MDM server.
2. Create or reuse the Mattrax MDM server (Mattrax does this when you assign a device).
3. Move pilot serials to the Mattrax server.
4. Sync ABM in Mattrax and confirm the devices appear as `ASSIGNED`.
5. Serve the signed ADE profile URL.

Moving a serial removes it from the Jamf server. Do this in batches, not all at once.

:::warning Zero-touch
Apple's documented protocol ignores the body of an `Authenticate` response, so Mattrax's
inline ADE profile is unverified and must not be relied on for zero-touch. Register the
tenant's signed ADE profile `url` in Apple Business Manager / Apple Configurator, or install
the signed profile URL during the pilot. See [ABM](/platforms/apple/abm).
:::

## Profiles

Jamf profiles can often be re-uploaded:

1. Open the profile in Jamf and export the `.mobileconfig`.
2. Remove any `com.apple.mdm` payload. Mattrax rejects enrollment payloads in a custom
   profile.
3. Confirm `PayloadType: Configuration`, an identifier, a display name and at least one
   payload.
4. Create a Mattrax policy with `mttx.apple.custom.<id>` and paste the base64 content.

Use the **Preview mobileconfig** API or the dashboard preview to catch parse errors before
assigning.

Jamf payloads that reference Jamf-specific variables or scripts will not resolve. Replace
them with static values or a DDM declaration.

## Smart groups

Jamf smart groups map to dynamic groups:

| Jamf criterion           | Mattrax rule              |
| ------------------------ | ------------------------- |
| Model contains `MacBook` | `model contains MacBook`  |
| OS version ≥ 14          | `osVersion gte 14.0`      |
| Serial prefix `FIN`      | `serial prefix FIN`       |
| Asset tag prefix         | `assetTag prefix`         |
| Last inventory > 30 days | `staleDays gt 30`         |
| Smart group membership   | Not supported; use a rule |

The dashboard editor only edits `all` conditions. Use the API for `any`/`none`.

## Policies and assignments

1. Create one Mattrax policy per Jamf policy or logical area.
2. Assign to the corresponding manual or dynamic group.
3. Use direct device includes for exceptions and direct excludes for opt-outs.
4. Check the effective-policy trace on a pilot device.

Mattrax does not import Jamf policy objects. Rebuild the settings you need; do not attempt
to translate every payload.

## Apps

- **VPP** — upload the same Apps & Books location token. Mattrax syncs the existing asset
  pool. Licences are device-based; user-based licences are not supported.
- **Manifest apps** — create catalogue entries with the manifest URL.
- **Store apps** — create entries with the iTunes Store id.
- **Uploaded packages** — Mattrax stores the package but does not generate an OTA
  manifest. Host your own manifest or use VPP.
- **Scripts** — not supported. Use a custom profile or an external tool.

## FileVault

Mattrax escrows recovery keys after re-enrollment with
`collect-security-info`. There is no bulk import from Jamf.

During the transition:

- Keep Jamf access to old recovery keys until every device has re-enrolled.
- Record which devices have escrowed in Mattrax.
- Do not rotate FileVault keys until the new escrow is confirmed.

## Cutover checklist

- [ ] Pilot group selected and communicated.
- [ ] APNs configured in Mattrax.
- [ ] ABM credential uploaded and devices synced.
- [ ] Pre-registration CSV imported.
- [ ] Profiles exported, cleaned and re-uploaded.
- [ ] Dynamic groups created.
- [ ] Policies assigned and verified on a pilot.
- [ ] VPP token uploaded and licences synced.
- [ ] Pilot devices re-enrolled and green.
- [ ] FileVault escrow confirmed.
- [ ] Remaining serials moved in batches.
- [ ] Jamf decommissioned after the last device.

## Next

- [Apple Business Manager](/platforms/apple/abm)
- [Apple DDM and profiles](/platforms/apple/ddm)
- [Migration overview](/migration/)
