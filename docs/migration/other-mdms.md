# Kandji, Mosyle and Addigy

Kandji, Mosyle and Addigy are Apple-focused MDMs. Their migration shape is similar to
Jamf: reassign ABM devices, re-upload profiles, rebuild groups and policies, and re-enroll.

## Common plan

1. Export the device inventory (serial, name, asset tag, model, group).
2. Export configuration profiles as `.mobileconfig`.
3. Record VPP/Apps & Books location tokens.
4. Record which devices have FileVault keys escrowed.
5. Create the Mattrax tenant, APNs certificate and baseline policy.
6. Import pre-registrations.
7. Move a pilot ring in ABM.
8. Re-enroll and validate.
9. Move the rest in batches.

## Device inventory

Map the vendor export to:

```csv
serial,name,asset_tag,group,notes
C02XXXXXXX,Reception Mac,AST-1042,Macs,Front desk
```

Import limits: 1,000 rows. Group names are matched case-insensitively; use ids for
automation.

## Profiles

Re-upload profiles as `mttx.apple.custom.<id>`:

- Remove `com.apple.mdm`.
- Keep `PayloadType: Configuration`.
- Ensure a non-empty identifier and display name.
- Ensure at least one payload.
- Replace vendor variables and scripts with static values.

If a vendor profile contains a payload Mattrax does not understand, it is still served
verbatim. The device decides whether it applies.

## Groups

| Vendor concept                      | Mattrax                                |
| ----------------------------------- | -------------------------------------- |
| Static group / blueprint assignment | Manual group                           |
| Smart group / rule-based group      | Dynamic group                          |
| Exclusion                           | Direct device exclude or group exclude |
| Priority                            | Policy `priority`                      |

Vendor-specific rules do not translate automatically. Rebuild the rules that matter and
verify with the group preview.

## Apps

- Upload the same VPP location token to reuse the licence pool.
- Create manifest or store entries for non-VPP apps.
- Uploaded packages are stored but need your own manifest URL to install.
- Vendor scripts and custom app installers are not supported.

## FileVault

There is no bulk key import. After re-enrollment, run `collect-security-info` on each
device and confirm escrow. Keep the old MDM's key access until every device is green.

## Vendor notes

### Kandji

- Blueprints map to groups plus policies. Create one policy per blueprint area and assign
  it to the matching group.
- Kandji custom scripts and parameters do not migrate.
- Kandji's auto-apps can be recreated as VPP assignments or manifest entries.
- Kandji Passport/end-user flows have no equivalent; plan a user communication.

### Mosyle

- Mosyle profiles export as `.mobileconfig`; re-upload after removing the MDM payload.
- Mosyle's "Profiles" and "Security" groups map to Mattrax groups and policies.
- Mosyle app catalogue entries need VPP or manifest re-creation.
- Mosyle's remote commands may not map one-to-one; use the Mattrax action matrix.

### Addigy

- Addigy policies map to Mattrax groups and policies.
- Addigy's custom facts, scripts and maintenance items do not migrate.
- Addigy software deployments need VPP or a manifest.
- Addigy monitoring alerts have no equivalent; use Mattrax health and your own monitoring.

## Cutover checklist

- [ ] Inventory exported and mapped.
- [ ] Profiles exported and cleaned.
- [ ] VPP token recorded.
- [ ] FileVault escrow status recorded.
- [ ] Mattrax tenant, APNs and baseline policy ready.
- [ ] Pre-registrations imported.
- [ ] Groups and rules rebuilt.
- [ ] Apps recreated.
- [ ] Pilot ring moved in ABM and re-enrolled.
- [ ] Policy and inventory verified.
- [ ] FileVault escrow confirmed.
- [ ] Remaining devices moved in batches.
- [ ] Old MDM decommissioned.

## Next

- [Migration overview](/migration/)
- [Apple](/platforms/apple/)
- [ABM](/platforms/apple/abm)
