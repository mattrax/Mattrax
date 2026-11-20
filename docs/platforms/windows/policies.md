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
diffs it against the OMA-URIs already delivered:

- a new or changed node is sent as a `Replace` command;
- a node that is no longer provided by any policy is sent as a `Delete` command, which
  removes the CSP node (and its subtree) instead of leaving the last value on the device;
- the device returns a status per command:
  - `200` — applied
  - `418` — queued
  - anything else — failed, with the failing OMA-URI and status recorded on the device

Each `Replace`/`Delete` has a stable `device_command` row derived from the device and
OMA-URI, so its result updates the same row and the policy delivery state. The device
payload exposes:

- `windows.policy.appliedUris` — acknowledged settings;
- `windows.policy.pendingUris` — delivered but not acknowledged;
- `windows.policy.pendingRevertUris` — deletes in flight;
- `windows.policy.failed` — last rejection per OMA-URI, including status and detail;
- `windows.policy.revertedAt` — when the last removal was acknowledged.

A rejected node is retried after 30 minutes (or immediately if its value changes).

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

- The server generates `Replace` and `Delete` commands for OMA-URI settings. There is no
  `Add`, arbitrary `Exec` or custom SyncML authoring, and inventory `Get` requests are
  server-generated.
- No BitLocker key escrow, app install or per-device policy push; devices poll.
- ADMX templates can be imported in the designer: Microsoft in-box policies map to their
  existing `ADMX_*` catalogue URI, and vendor templates are ingested with
  `ConfigOperations/ADMXInstall`. The designer is device-scoped, so user-scoped templates
  need a raw user-scoped configuration. See
  [Policy catalogue](/reference/policy-catalogue#admx-imports) for the URI scheme and limits.
- The policy designer's Windows catalogue is large; see
  [Policy catalogue](/reference/policy-catalogue).

## Next

- [Windows enrollment](/platforms/windows/)
- [Policies](/manage/policies)
