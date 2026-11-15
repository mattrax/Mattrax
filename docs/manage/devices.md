# Devices

The device list is the operational home for a fleet. It supports server-side search,
filters, sorting, pagination, CSV export and bulk delete.

## Find devices

**Devices** supports:

- Free text search across management name, device-reported name, serial, model and
  asset tag.
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
- Android management state (management mode, ownership, API level, security patch,
  applied policy, enrollment token, network operator, RAM).
- Groups and effective policy.
- Health and reasons.
- Commands and activity timeline.
- DDM declaration status.
- Installed applications, with the last report time and a stale marker.
- APNs push health.
- Identity certificate counts.
- FileVault recovery-key presence.

### Device names

Every platform reports a name for the device, and Mattrax keeps two:

- `physicalName` — the name the device reports for itself. Apple sends it in a
  `DeviceInformation` query response (`DeviceName`), Windows in
  `DevDetail/Ext/Microsoft/DeviceName`, and Android reports the enterprise `displayName`
  or the hardware model.
- `name` — the management name shown in lists, search and dashboards.

Precedence, highest first:

1. a name an administrator sets with `PATCH /devices/:id`,
2. the name the device reports for itself, while the management name is still empty or a
   placeholder (`serial`, model, UDID/DeviceID, Android resource id, or the previous
   reported name),
3. the enrolment placeholder (`serial ?? model ?? udid`).

A rename on the device therefore follows through to the dashboard, and an
administrator's rename is never overwritten by the next check-in.

### Inventory clocks

`inventoryUpdatedAt` records the last hardware/OS report and `applicationsUpdatedAt` the
last installed-application report. Both are per device, so they always describe one
platform:

| Platform | Inventory source                                               |
| -------- | -------------------------------------------------------------- |
| Apple    | DDM status items on check-in; daily `InstalledApplicationList` |
| Windows  | Six-hourly DevDetail/DevInfo `Get`; daily app inventory `Get`  |
| Android  | Every `ENROLLMENT`/`STATUS_REPORT` notification                |

The device payload returns `applicationsStale: true` when the application inventory is
missing or older than seven days, so the dashboard can show that the software list is out
of date instead of presenting it as current.

Apple devices are refreshed automatically: the daily maintenance run queues an
`InstalledApplicationList` command for every enrolled Mac or iPhone whose inventory is
missing or more than a day old, and skips devices with a refresh already queued or in
flight. `refresh-applications` on the device page stays available for an immediate
collection. Windows asks for `Win32AppInventory` and the deployed MSI state once a day,
and Android ingests `applicationReports` from every status notification, so application
inventory no longer depends on somebody pressing a button.

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

`GET .../activity` accepts `limit` (1–200, default 50) and `offset` and returns
`{ events, hasMore }`. Pages are newest first across every source (audit log,
commands, declarations, certificates and device lifecycle), so walk older
history by adding `limit` to `offset` until `hasMore` is false. The endpoint
serves at most 5,000 events per device; the dashboard exposes the same walk as
"Load older activity".

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
| `refresh-applications`  | Yes (manual refresh) | No            | No          | No      |

Commands are recorded with a lifecycle and a delivery deadline:

| Status       | Meaning                                                                            |
| ------------ | ---------------------------------------------------------------------------------- |
| `queued`     | Waiting for the device's next check-in.                                            |
| `sent`       | Handed to the device; waiting for its result.                                      |
| `deferred`   | The device answered `NotNow` (for example while locked). Retried every 10 minutes. |
| `succeeded`  | Terminal. Reported by the device, or reconciled from the state it reported.        |
| `failed`     | Terminal. Reported by the device, or reconciled from the state it reported.        |
| `expired`    | The deadline passed before the device ran it.                                      |
| `superseded` | A newer command made it obsolete (a wipe supersedes a pending lock).               |
| `cancelled`  | The device left management before delivery.                                        |

| Command                           | Delivery deadline |
| --------------------------------- | ----------------- |
| Lock, clear passcode              | 15 minutes        |
| Restart, shutdown                 | 30 minutes        |
| Security info, device information | 24 hours          |
| App install                       | 24 hours          |
| Installed-application inventory   | 7 days            |
| Erase                             | 7 days            |

An expired command is never delivered and never retried, so a lock queued three weeks ago
on an offline laptop does nothing when the device finally appears. The deadline is returned
as `expiresAt` by `GET /api/v1/tenants/:tenantId/devices/:id/commands`, alongside a
`statusLabel` for the lifecycle.

Queueing is idempotent: a request identical to one already queued or in flight on the same
device returns that command with `deduplicated: true` instead of inserting a second one.
Queueing a wipe supersedes every other pending action - including an earlier wipe, which is
why double-clicking **Erase** leaves exactly one erase queued - and a newer lock replaces
the previous lock PIN.

Command state is reconciled against what the device reports, so a command the device has
already satisfied does not stay `sent` forever. A reported application inventory proves
whether a delivered install landed (when the catalogue entry resolves to a bundle id); an
install that is still assigned to the device and provably missing is queued again, up to
three attempts per day. A device that unenrolls or re-enrolls closes out its old commands.

The same deadline applies on every platform: Windows SyncML delivers every queued command in
one session but expires or retries each row on the same rules, and Android commands are
issued directly and rely on the Pub/Sub result. The daily maintenance run expires anything
still active past its deadline (Android has no other way to close a lost result) and prunes
terminal command history older than 90 days. The audit log keeps the record after the row is
gone.

## Unenroll and delete

These are different operations.

**Unenroll** asks the device to remove management. Apple only:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/unenroll" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

The status becomes `unenrolling`, certificates are revoked and the device completes removal
at its next check-in. A device that checks in after its tenant or device row is gone receives
Apple's `410 Gone`, which tells it to remove the management profile instead of polling a
server that no longer knows it. Windows and Android do not expose remote unenroll yet.

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
