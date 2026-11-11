# Devices

The device list is the operational home for a fleet. It supports server-side search,
filters, sorting, pagination, CSV export and bulk delete.

## Find devices

**Devices** supports:

- Free text search across name, serial, model and asset tag.
- Filters: status, platform, group, health, push state, last seen.
- Sort by name, serial, last seen or enrollment date.
- Pagination up to 200 rows per page.

API:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/search?q=macbook&status=enrolled&proto=apple&limit=50" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Query parameters:

| Parameter            | Values                                               |
| -------------------- | ---------------------------------------------------- |
| `q`                  | Free text                                            |
| `status`             | `enrolling`, `enrolled`, `unenrolling`, `unenrolled` |
| `proto`              | `apple`, `win`, `android`                            |
| `groupId`            | Group id                                             |
| `notSeenSince`       | ISO timestamp                                        |
| `staleDays`          | Integer                                              |
| `health`             | `healthy`, `attention`, `critical`, `unknown`        |
| `push`               | `failing`, `invalid`                                 |
| `limit` / `offset`   | Pagination                                           |
| `sort` / `direction` | Sort field and `asc`/`desc`                          |

`GET /api/v1/tenants/:tenantId/devices` returns every device without pagination. Prefer
`/devices/search` for large fleets.

## Export

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/export?status=enrolled" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -o devices.csv
```

CSV columns: name, serial, model, platform, status, OS version, OS build, last seen,
enrolled at, asset tag, model number, FileVault, battery health, capabilities, inventory
updated and groups. Export is capped at 10,000 rows; a truncated response sets
`X-Export-Truncated`.

## Device detail

The detail page and API expose:

- Identity and inventory (serial, model, OS, disk, FileVault, battery, capabilities).
- Groups and effective policy.
- Health and reasons.
- Commands and activity timeline.
- DDM declaration status.
- Installed applications.
- APNs push health.
- Identity certificate counts.
- FileVault recovery-key presence.

Useful endpoints:

```text
GET  /api/v1/tenants/:tenantId/devices/:id
GET  /api/v1/tenants/:tenantId/devices/:id/health
GET  /api/v1/tenants/:tenantId/devices/:id/activity
GET  /api/v1/tenants/:tenantId/devices/:id/commands
GET  /api/v1/tenants/:tenantId/devices/:id/declarations
GET  /api/v1/tenants/:tenantId/devices/:id/effective-policy
GET  /api/v1/tenants/:tenantId/devices/:id/applications
GET  /api/v1/tenants/:tenantId/devices/:id/recovery-key
```

## Edit a device

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Reception Mac", "assetTag": "AST-1042", "notes": "Front desk" }'
```

Only `name`, `notes` and `assetTag` are editable. Inventory fields come from the device.

## Actions

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/action" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "action": "sync" }'
```

| Action                  | Apple                | Windows       | Android     | Step-up |
| ----------------------- | -------------------- | ------------- | ----------- | ------- |
| `sync`                  | APNs wake-up         | Not supported | Push policy | No      |
| `lock`                  | Yes (PIN)            | No            | Yes         | Yes     |
| `wipe`                  | Yes (PIN)            | Yes           | Yes         | Yes     |
| `restart`               | Yes                  | Yes           | Yes         | Yes     |
| `shutdown`              | Yes                  | No            | No          | Yes     |
| `clear-passcode`        | Yes                  | No            | No          | Yes     |
| `install-app`           | Manifest or Store id | No            | No          | Yes     |
| `collect-security-info` | Yes                  | No            | No          | No      |
| `refresh-applications`  | Yes                  | No            | No          | No      |

Commands are recorded with `queued`, `sent`, `succeeded`, `failed` or `not-now` and appear
in the activity timeline.

## Unenroll and delete

These are different operations.

**Unenroll** asks the device to remove management. Apple only:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/unenroll" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

The status becomes `unenrolling`, certificates are revoked and the device completes removal
at its next check-in. Windows and Android do not expose remote unenroll.

**Delete** removes the local device row and revokes certificates. It does not wipe or
unenroll the physical device.

```bash
curl -X DELETE "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "ids": ["device_id"] }'
```

Bulk delete accepts a JSON body and returns per-device results.

## Pre-registration

Pre-register devices before they enroll to set a name, asset tag, notes and group:

```csv
serial,name,asset_tag,group,notes
C02XXXXXXX,Reception Mac,AST-1042,Macs,Front desk
```

1. Open **Devices → Import CSV**.
2. Map or confirm the columns.
3. Review per-row issues and import.

Limits: 1,000 rows, RFC 4180 parsing. Header aliases are accepted (`serial_number`,
`device_name`, `asset`, `group_name`, `note`). Group names are matched case-insensitively
and must be unambiguous; prefer group ids for API imports.

Pre-registrations are consumed by Apple `Authenticate` using the serial. Windows
enrollment has no serial, and Android does not consume them.

API:

```text
GET    /api/v1/tenants/:tenantId/device-pre-registrations
POST   /api/v1/tenants/:tenantId/device-pre-registrations/import
DELETE /api/v1/tenants/:tenantId/device-pre-registrations/:id
DELETE /api/v1/tenants/:tenantId/device-pre-registrations
```

## Health

`GET /api/v1/tenants/:tenantId/device-health` returns fleet counts. The detail endpoint
returns reasons and a level. Health is derived, not a compliance policy. See
[Apple security](/platforms/apple/security) for the reason list.

## Next

- [Groups](/manage/groups)
- [Policies](/manage/policies)
- [Applications](/manage/applications)
