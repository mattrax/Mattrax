# Android policies

Android policies are AMAPI policy fragments. Mattrax merges every effective
`mttx.android.policy*` configuration into one policy, then applies it to the enterprise and
each device.

## Configuration shape

```json
{
  "mttx.android.policy.passcode": {
    "passwordRequirements": {
      "passwordMinimumLength": 8,
      "passwordQuality": "NUMERIC_COMPLEX"
    }
  },
  "mttx.android.policy.apps": {
    "applications": [
      {
        "packageName": "com.example.app",
        "installType": "FORCE_INSTALLED"
      }
    ]
  }
}
```

The value is an AMAPI `Policy` fragment. Mattrax does not translate settings; use Google's
policy reference for field names and allowed values.

## Merge rules

- Objects are deep-merged.
- Later policies win for scalar values.
- Arrays are concatenated with duplicates removed, preserving first-seen order.
- `null` and `undefined` are skipped.
- `name` and `policyName` are rejected at the top level; Mattrax owns the policy name.

The merged document is canonicalised, hashed with SHA-256 and named
`mattrax-<first 24 lowercase alphanumeric characters>`.

`applications` is special-cased: AMAPI rejects a policy that lists a package twice, and
deep merging concatenates arrays, so entries are collapsed to one per `packageName` with
the later definition winning. This is what lets one fragment mark a package `BLOCKED`
while another force-installs it without producing an invalid policy.

## Delivery

On a policy, group or assignment change, Mattrax:

1. Resolves the effective policies for affected devices.
2. Merges and hashes the policy.
3. `PATCH /v1/enterprises/{enterprise}/policies/{policyId}?updateMask=*`.
4. `PATCH /v1/enterprises/{enterprise}/devices/{deviceId}?updateMask=policyName` per device.

Unchanged hashes are skipped. Fan-out is bounded to concurrency 4. A failure is recorded
per device and audited; it never fails the admin write.

Every distinct hash is a separate Google policy resource. A reconcile (the manual sync, or
any full sync) deletes `mattrax-*` policies that no device references and keeps
`mattrax-default`, each device's assigned policy and any policy a device still reports as
applied, so the enterprise does not accumulate one policy per edit.

You can force a push with:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/android/sync" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

## Targeting

Android policies use the same group and direct-device assignment model as Apple and
Windows. The policy kind is `mttx.android.policy.<id>`; the id is up to 20 alphanumeric
characters.

## Authoring tips

- Keep one fragment per concern (`passcode`, `wifi`, `applications`) so merge conflicts are
  obvious.
- Remember arrays concatenate. Two policies that both define `applications` produce one
  entry per package (the later policy wins for that package); every other array is a
  combined list, not a replacement.
- Do not set `name` or `policyName`.
- Test with a lab enterprise first. Policy errors are returned by AMAPI and recorded on the
  device's `lastError`.

## Limitations

- There is no managed Google Play approval flow: packages must be approved for the
  enterprise in the Play console before Google will install them. The application
  catalogue's Android entries are merged into `applications`, including their managed
  configuration.
- There is no per-device app install command; AMAPI delivers apps through the policy.
- No compliance state ingestion; device health is derived from inventory.
- Fragments are not validated against Google's schema before they are sent. A field name or
  enum AMAPI rejects is surfaced as the sync's `lastError` on the enterprise and the device,
  and audited as `android.policy_sync_failed`.
- Policy delivery has not been validated against a real enterprise and device.

## Next

- [Android setup and enrollment](/platforms/android/)
- [Policies](/manage/policies)
