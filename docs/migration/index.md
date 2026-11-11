# Migration

Migrating to Mattrax is a re-enrollment project, not a data import. MDM identities are
bound to the previous vendor; devices must enroll again.

This page explains what can be preserved, how to run coexistence and a cutover that does
not strand users.

## What can be preserved

| Data                                             | Support                                              |
| ------------------------------------------------ | ---------------------------------------------------- |
| Device serials, names, asset tags, notes, groups | CSV pre-registration                                 |
| Windows Autopilot hardware hashes                | CSV/paste import                                     |
| Tenant branding and profile                      | Tenant export/import                                 |
| Groups and policy assignments                    | Tenant export/import (manual groups only)            |
| Policy configurations                            | Recreate as Mattrax kinds; re-upload `.mobileconfig` |
| Application metadata                             | Tenant export/import (no binaries)                   |
| Enrollment settings and pre-registrations        | Tenant export/import                                 |
| SCEP certificate metadata                        | Exported, not imported                               |
| Users and groups                                 | SCIM or Entra directory sync                         |
| VPP licences                                     | Reuse the same Apps & Books location token           |

## What cannot be preserved

- Device management history, inventory snapshots, commands and audit history.
- Existing MDM enrollment or identity certificates.
- Vendor policy objects, smart-group rules, scripts, packages and profiles, unless you
  re-upload a `.mobileconfig`.
- Windows Intune compliance and configuration policies. Only OMA-URI nodes are delivered.
- Android Enterprise bindings. A new AMAPI enterprise and re-enrollment are required.
- FileVault recovery keys in bulk. There is no bulk import; escrow is per device after
  re-enrollment.
- Members other than the importing owner, devices, audit history and SCEP certificates in
  a tenant import.

## Coexistence

You can run Mattrax beside the incumbent MDM, but a device should have one MDM authority.

Recommended pattern:

1. Pilot a small ring of devices that are not business-critical.
2. Keep the incumbent MDM for the rest of the fleet.
3. Do not enroll the same device in both systems. Two MDM profiles conflict.
4. For Apple, use ABM to move pilot serials to the Mattrax MDM server. Moving a serial
   removes it from the old server.
5. For Windows, import pilot Autopilot hashes and assign a pilot group.
6. For Android, run a separate AMAPI enterprise for the pilot.

## Cutover sequence

1. **Prepare the tenant** — branding, APNs, groups and a baseline policy.
2. **Apple** — upload the ABM API key, sync, assign pilot serials, confirm ADE profile
   delivery.
3. **Windows** — connect Entra, grant Graph permissions, import Autopilot hashes, create a
   deployment profile.
4. **Android** — configure the service account and Pub/Sub, complete signup.
5. **Pre-register** — import `serial,name,asset_tag,group,notes` so names and groups are
   ready before enrollment.
6. **Recreate policies** — start with the settings that matter for security, then add the
   long tail.
7. **Recreate apps** — manifest/store entries and VPP licences.
8. **Re-enroll** — use ABM reassignment, Autopilot, or a manual enrollment link.
9. **Validate** — policy convergence, inventory, FileVault escrow, app installs, commands.
10. **Decommission** — remove the old MDM profile/server only after the new fleet is green.

## Migration primitives

### Pre-registration CSV

```csv
serial,name,asset_tag,group,notes
C02XXXXXXX,Reception Mac,AST-1042,Macs,Front desk
```

Limits: 1,000 rows per import. Group names are matched case-insensitively; prefer ids for
automation.

### Autopilot CSV

```csv
Device Serial Number,Hardware Hash,Group Tag
C02XXXXXXX,base64hash...,Pilot
```

Limits: 500 rows and 1 MB per request. Graph is called before local rows are written.

### Tenant export/import

Use this to clone a Mattrax tenant's configuration, not to import a competitor's data.
Version 1, 8 MB, 10,000 rows per class. Dynamic group rules are not carried; the imported
group becomes manual.

### SCIM and directory sync

Users and groups come from your IdP, not from the old MDM. Use SCIM 2.0 or Entra Graph
sync.

## Risks

| Risk                                               | Mitigation                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| Devices lose management during cutover             | Pilot first; keep the old MDM until the new fleet is green                 |
| ABM assignment removes devices from the old server | Move serials in small batches                                              |
| FileVault keys are not migrated                    | Escrow after re-enrollment; keep old keys accessible during the transition |
| Apps are not installed automatically               | Recreate VPP licences and manifest entries before cutover                  |
| Windows compliance is not equivalent               | Use OMA-URI policy; do not promise Intune compliance parity                |
| Android requires factory reset                     | Plan a user communication and a re-enrollment window                       |
| Shared serials across platforms                    | Mattrax enforces one serial per tenant across protocols                    |

## Next

- [Jamf](/migration/jamf)
- [Microsoft Intune](/migration/intune)
- [Kandji, Mosyle and Addigy](/migration/other-mdms)
