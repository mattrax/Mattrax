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

## Delivery

On a policy, group or assignment change, Mattrax:

1. Resolves the effective policies for affected devices.
2. Merges and hashes the policy.
3. `PATCH /v1/enterprises/{enterprise}/policies/{policyId}?updateMask=*`.
4. `PATCH /v1/enterprises/{enterprise}/devices/{deviceId}?updateMask=policyName` per device.

Unchanged hashes are skipped. Fan-out is bounded to concurrency 4. A failure is recorded
per device and audited; it never fails the admin write.

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
- Remember arrays concatenate. Two policies that both define `applications` produce a
  combined list, not a replacement.
- Do not set `name` or `policyName`.
- Test with a lab enterprise first. Policy errors are returned by AMAPI and recorded on the
  device's `lastError`.

## Limitations

- There is no managed Google Play approval flow or app catalogue integration.
- No Android app install/uninstall commands.
- No compliance state ingestion.
- Policy delivery has not been validated against a real enterprise and device.

## Next

- [Android setup and enrollment](/platforms/android/)
- [Policies](/manage/policies)
