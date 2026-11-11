# Windows policies

Windows policy is delivered as SyncML `Replace` commands generated from OMA-URI nodes.

## Configuration shape

A policy configuration uses the kind `mttx.windows.custom.<id>` and one of two shapes:

```json
{
  "mttx.windows.custom.bitlocker": {
    "omaUri": "./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption",
    "value": 1,
    "format": "int"
  }
}
```

or a group of nodes:

```json
{
  "mttx.windows.custom.security": {
    "nodes": [
      {
        "omaUri": "./Device/Vendor/MSFT/Defender/AllowRealtimeMonitoring",
        "value": 1,
        "format": "int"
      },
      {
        "omaUri": "./Device/Vendor/MSFT/Policy/Config/DeviceGuard/EnableVirtualizationBasedSecurity",
        "value": 1,
        "format": "int"
      }
    ]
  }
}
```

### Fields

| Field    | Required | Notes                                         |
| -------- | -------- | --------------------------------------------- |
| `omaUri` | Yes      | Must start with `./`                          |
| `value`  | Yes      | String, number or boolean matching the format |
| `format` | Yes      | `int`, `chr`, `bool`, `xml`, `b64` or `node`  |

The `<id>` suffix is up to 20 alphanumeric characters.

## Delivery

On each SyncML management check-in, Mattrax resolves the device's effective policy and
builds a `Replace` command for every node. The device returns a status per command:

- `200` — applied
- `418` — queued
- Anything else — failed

Statuses update `device_command` and are visible on the device activity timeline.

## Merge and precedence

- Multiple policies can contribute nodes.
- Duplicate OMA-URIs are resolved deterministically by lexicographic policy id; the first
  policy wins.
- Standard policy resolution still applies: direct excludes, direct includes, group
  excludes, then priority and recency.

Use the effective-policy endpoint to see which policy won:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/effective-policy" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

## Commands

Two remote actions map to OMA-DM:

| Action    | URI                                               |
| --------- | ------------------------------------------------- |
| `wipe`    | `./Device/Vendor/MSFT/RemoteWipe/doWipeProtected` |
| `restart` | `./Device/Vendor/MSFT/Reboot/RebootNow`           |

Everything else is rejected. There is no push; commands wait for the next poll.

## Authoring tips

- Use the Microsoft OMA-URI reference for the exact node path and value type.
- Prefer one configuration per feature area (`bitlocker`, `defender`, `edge`) so rollback
  is granular.
- Keep ids short and stable; the id appears in declaration identifiers and logs.
- Do not put secrets in OMA-URI values. Policy data is stored in the database and returned
  by the API.

## Limitations

- Only OMA-URI `Replace` is generated. There is no `Add`, `Delete`, `Exec` or custom
  SyncML authoring.
- No Windows inventory, compliance, app install or BitLocker key escrow.
- No per-device policy push; devices poll.
- The policy designer's Windows catalogue is large; see
  [Policy catalogue](/reference/policy-catalogue).

## Next

- [Windows enrollment](/platforms/windows/)
- [Policies](/manage/policies)
