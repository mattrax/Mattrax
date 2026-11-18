# Devices

The device list is the operational home for a fleet. It supports server-side search,
filters, sorting, pagination, CSV export and bulk delete.

## Find devices

**Devices** supports:

- Free text search across the columns the table shows (see
  [What search matches](#what-search-matches)).
- Filters: status, platform, group, health, push state, last seen.
- Sort by name, health, last seen, enrollment date or status.
- API pagination up to 200 rows per page; the dashboard shows 50.

### What search matches

Search is case-insensitive and substring-based (`LIKE '%text%'`), across:

| Column            | Examples                                     |
| ----------------- | -------------------------------------------- |
| Name              | management name and device-reported name     |
| Serial, asset tag | `C02XK1AB`, `ASSET-42`                       |
| Model             | model name, model identifier, `dmIdentifier` |
| Platform          | `Apple`, `Windows`, `Android`                |
| Status            | `enrolled`, `unenrolling`                    |
| OS                | version, edition and build                   |
| Groups            | group names, not only the group filter       |
| Notes             | device notes                                 |
| Attributes        | values of registered attributes              |
| Timestamps        | enrollment and last seen (UTC)               |

Enrollment and last-seen timestamps are stored, searched and shown in **UTC**. A query is
treated as a timestamp only when it is a real four-digit year (`2026`), an ISO-like date
(`2026-11-10`, `2026-11`, `2026-11-10 05:06`), a slash date (`10/11/2026`,
interpreted as both day/month and month/day because the order is ambiguous), a
time (`05:06`) or a month name form (`Nov`, `4 Nov 2026`, `Nov 4 2026`). Other
numbers (`2`, `26`, `4`) are matched as text against the columns above; use the
**Last seen** filter or `notSeenSince`/`staleDays` for relative dates.

### Keyboard

The device table is fully operable without a mouse. The same bindings appear in the
command palette (`Cmd/Ctrl+K`) and in the search and columns tooltips:

| Key                 | Action                                                    |
| ------------------- | --------------------------------------------------------- |
| `/` or `Cmd/Ctrl+F` | Focus the table search                                    |
| `Escape`            | Clear the search (and the selection outside a text field) |
| `↑` / `↓`           | Move between rows                                         |
| `Enter`             | Open the focused row                                      |
| `Cmd/Ctrl+A`        | Select every row on the current page                      |
| `R`                 | Refresh the list                                          |

### Bulk actions across a filter

Ticking every row on the current page offers **Select all N matching this filter** in
the bulk bar. The action then applies to every device the active filter matches, not
just the visible page; the bar shows the total and any filter, search or page change
clears the selection. The ids are resolved through the same search endpoint the table
uses, and a single action is capped at 10,000 rows (it reports an error instead of
silently acting on part of the fleet). Every id is still authorised on the server when
the action runs.

API:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/search?q=macbook&status=enrolled&proto=apple&limit=50" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Query parameters:

| Parameter            | Values                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| `q`                  | Free text (see [What search matches](#what-search-matches))             |
| `status`             | `enrolling`, `enrolled`, `unenrolling`, `unenrolled`                    |
| `proto`              | `apple`, `win`, `android`                                               |
| `groupId`            | Group id                                                                |
| `notSeenSince`       | ISO timestamp                                                           |
| `staleDays`          | Integer                                                                 |
| `health`             | `healthy`, `attention`, `missing`, `critical`, `unknown`, `stale`       |
| `push`               | `failing`, `invalid`                                                    |
| `setup`              | `awaiting` (ADE held in Setup Assistant), `complete`                    |
| `limit` / `offset`   | Pagination                                                              |
| `sort` / `direction` | `name`, `health`, `lastSeenAt`, `enrolledAt`, `status` and `asc`/`desc` |

`GET /api/v1/tenants/:tenantId/devices` returns every device without pagination. Prefer
`/devices/search` for large fleets.

## Health in the list

The **Health** column shows each device's derived rollup (healthy, attention, **MIA**,
critical, unknown) using the same computation as the health filter, the fleet summary and
the device page. Reasons are not a separate request: hovering or focusing the badge lists
the rule labels that pulled the device out of `healthy` (for example "FileVault off" or
"Device has not checked in for more than 14 days and is still enrolled"). Devices with no
reasons show a quiet badge with no tooltip.

MIA (missing in action) is a distinct state between stale and unenrolled. The check-in
timeline is:

| Check-in age                                          | State                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| ≤ 7 days                                              | Healthy unless another rule applies.                                      |
| > 7 days                                              | **Stale** — `attention`, with a `stale` reason.                           |
| > 14 days                                             | **MIA** — the `missing` level, still enrolled.                            |
| Past the configured auto-unenrol (30 days by default) | Daily maintenance unenrols the device, so it reads `critical`, never MIA. |

Precedence is fixed: an unknown enrollment status wins; then `critical` (including an
unenrolled device or a critical rule such as a full disk); then MIA; then warnings
(`attention`); then `healthy`. An `unenrolled`/`unenrolling` device is never MIA, and a
device that has never checked in stays `attention` because there is no check-in age to
measure. `stale` remains the broad "not checking in" filter and includes MIA devices;
`health is missing` matches only the MIA level.

Health is derived from declarations and inventory fields, not stored on the device row.
The list therefore computes it once per response:

- `/devices/search` reads the declarations for the page it is returning (one query) and
  attaches `health` to every row.
- Sorting by `health` is a server sort. Ascending lists the worst devices first —
  `critical`, `missing`, `attention`, `unknown`, `healthy` — so it matches the "needs
  attention" filter and the dashboard's health counts. The two agree because both call the
  same rollup.
- `GET /devices` (the unpaginated listing) omits `health` to avoid reading declarations
  for an entire fleet; use the search endpoint when the field is needed.

The tenant overview also shows a dismissible **MIA** banner when one or more enrolled
devices are MIA, linking to the `?health=missing` device list. Dismissal lasts for the
browser session, so the warning is proactive without blocking the page.

## Export

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/export?status=enrolled" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -o devices.csv
```

CSV columns: name, serial, model, platform, status, OS version, OS build, last seen,
enrolled at, asset tag, model number, FileVault, battery health, capabilities, inventory
updated and groups. Visible custom attributes follow as `attribute:<key>` columns. Export
is capped at 10,000 rows; a truncated response sets `X-Export-Truncated`.

## Custom attributes

Tenants define their own device fields — cost centre, warranty end, loaner owner, anything
else they track — instead of putting them in notes. A definition has a stable key, a label,
a type (`text`, `number`, `boolean`, `date` or `select`), optional select options, a
required flag and a visibility (`visible` attributes get table columns and CSV columns;
`hidden` ones are API-only).

Manage the registry from **Settings → Attributes**. Keys are lowercase identifiers
(`[a-z][a-z0-9_]*`, maximum 64 characters) because they become CSV headers and policy
variables; they cannot be renamed after creation. Deleting a definition deletes every
device value for it, and any policy that still references its variable is rejected until
the reference is removed.

### Values on a device

The device page has an **Attributes** panel with one editor per visible attribute. Saving
sends only changed keys; emptying a field sends an explicit clear. Required attributes
reject empty values, select attributes must use one of their options, dates are
`YYYY-MM-DD`, booleans canonicalise to `true`/`false`, and numbers normalise through
`Number`.

```bash
curl -X PUT "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/attributes" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "values": { "cost_centre": "EMEA", "warranty_end": "2027-01-31" },
    "replace": false
  }'
```

`values` merges: listed keys are written, `null` clears that key, and unlisted keys are
left alone. Set `"replace": true` to clear every registered key that is absent. Every
write and clear is audited with the keys but not the values.

### CSV import

Bulk values go through a CSV with a `serial` column and one `attribute:<key>` column per
attribute (a bare key or the label is also accepted):

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/attributes/import" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile csv values.csv '{ csv: $csv }')"
```

Empty cells clear the value, unknown columns and duplicate serials are reported, and the
response lists a status per row. An export from the Devices page can be edited and
re-imported unchanged. Imports are capped at 1,000 rows and do not create devices: a
serial that is not in the tenant fails that row.

The device list's search box matches attribute values as well as the built-in columns.
The toolbar also filters on one registered attribute (select attributes filter on their
options); the filter is stored in the URL with the other device filters, so a view can be
shared.

### Enrollment questions

**Settings → Enrollment → Enrollment questions** turns a registered attribute into a
prompt on the public enrollment page. The enrolling person enters the hardware serial
(and optionally the device name and asset tag when the tenant enables them), then answers
the questions. Answers are validated with the same type, option and requiredness rules as
the dashboard and stored against the serial. When a device with that serial first checks
in, the answers become device attribute values (audited with the `enrollment` source).

A question can override the attribute's prompt and required flag. Questions are presented
in order and the platform instructions are hidden until the form is submitted.

## Device detail

The detail page opens with the Apple artwork for the model identifier (Windows and
Android fall back to their platform glyph) and a two-line identity: management name
and reported model. An **Overview** table carries the inventory facts in plain
English — management name, device name, vendor, model, asset tag, serial, OS,
version, build, disk size/used, full-disk encryption, activation lock (when the
device reports it), last seen and enrolled. A row is omitted when the device has
not reported that fact, rather than printing "Unknown". Apple serials link to
Apple's warranty coverage checker.

The **Scope** tab shows the manual groups that include the device, the dynamic
groups whose current rules match it, and every policy in effect with its resolved
setting kinds and delivery state. Delivery comes from the DDM declaration status
the device reports for each policy/kind. Windows and Android show "Not tracked"
because the dashboard does not yet map their platform delivery records to a
policy; their command history still shows each delivered configuration. Groups can
be added or removed from the device page for users with write permission.

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
- Apple user channels: per-user binding, last check-in, push health and reported profiles.
- Identity certificate counts.
- FileVault recovery-key presence, format (`plaintext` or unwrapped-on-reveal CMS),
  escrow age and whether the last security report is stale.
- The managed local administrator created during macOS ADE setup; the password is
  sealed at rest and revealed through a step-up read.
- ADE setup state (`Awaiting setup` or released) with the setup release timestamp.
- Activation Lock bypass-code presence and `IsActivationLockManageable`.
- Passcode and software-update state, lockdown mode, managed-certificate count and
  `mdm.app` entries.
- Policy delivery mode (`ddm` or `legacy`) with the recorded reason.

Notes are shown read-only in the sidebar, rendered as Markdown. They are editable
from the **Edit details** sheet, which also carries the management name and asset
tag. The device list has a Notes column (available from the column picker) and the
Groups column shows the membership count with the group names in a tooltip.

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

`GET .../activity` accepts `limit` (1–200, default 50) and returns
`{ events, hasMore, nextCursor? }`. Pages are newest first across every source
(audit log, commands, declarations, certificates and device lifecycle) and use a
keyset cursor: pass `nextCursor` back as `cursor` until `hasMore` is false. Each
page reads at most `limit + 1` rows per source, so paging depth does not add
reads. `offset` is retired; any non-zero value without a `cursor` returns `400`.
The dashboard exposes the same walk as "Load older activity".

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

| Action                         | Apple                         | Windows       | Android     | Step-up      |
| ------------------------------ | ----------------------------- | ------------- | ----------- | ------------ |
| `sync`                         | APNs wake-up                  | Not supported | Push policy | No           |
| `lock`                         | Yes (PIN)                     | No            | Yes         | Yes          |
| `wipe`                         | Yes (PIN)                     | Yes           | Yes         | Yes          |
| `return-to-service`            | iOS 17+/tvOS 18+/visionOS 26+ | No            | No          | Yes          |
| `restart`                      | Yes                           | Yes           | Yes         | Yes          |
| `shutdown`                     | Yes                           | No            | No          | Yes          |
| `clear-passcode`               | Yes                           | No            | No          | Yes          |
| `install-app`                  | Manifest or Store id          | No            | No          | Yes          |
| `collect-security-info`        | Yes                           | No            | No          | No           |
| `refresh-applications`         | Yes (manual refresh)          | No            | No          | No           |
| `collect-activation-lock-code` | Yes (supervised)              | No            | No          | Yes          |
| `rotate-filevault-key`         | Yes                           | No            | No          | Yes          |
| `set-recovery-lock`            | Yes (Apple silicon)           | No            | No          | Yes          |
| `verify-recovery-lock`         | Yes (Apple silicon)           | No            | No          | Yes          |
| `start-lost-mode`              | No                            | No            | Yes         | Yes          |
| `stop-lost-mode`               | No                            | No            | Yes         | Yes          |
| `reset-password`               | No                            | No            | Yes         | Yes          |
| `clear-app-data`               | No                            | No            | Yes         | Yes          |
| `request-device-info`          | No                            | No            | Yes         | Yes          |
| `relinquish-ownership`         | No                            | No            | Yes         | Yes          |
| `unenroll` (endpoint)          | Yes                           | Yes           | Yes         | Android only |

The action menu is capability-driven: `GET /api/v1/tenants/:tenantId/devices/:id` returns an
`actions` array for the device. The API rejects an action that is not in that list, so a
Windows device never accepts `sync` (it has no push channel; changes are applied at the next
SyncML poll) and an unenrolled device accepts nothing. The list is derived from the platform,
the enrollment status and any action capabilities the device reports.

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
| ADE setup commands                | 24 hours          |
| App install                       | 24 hours          |
| Installed-application inventory   | 7 days            |
| Erase                             | 7 days            |

An expired command is never delivered and never retried, so a lock queued three weeks ago
on an offline laptop does nothing when the device finally appears. The deadline is returned
as `expiresAt` by `GET /api/v1/tenants/:tenantId/devices/:id/commands`, alongside a
`statusLabel` for the lifecycle and the command's target `locURI` when it has one
(Windows policy and inventory commands always do).

Windows policy `Replace`/`Delete` commands and inventory `Get` requests are stored in the
same command history as imperative actions, with a stable row id per OMA-URI, so a device
status can always be matched to the command that caused it. Because those rows are derived
from device state rather than operator work, daily maintenance prunes them after 30 days
by default, independently of the 90-day terminal-command window. Pass
`windowsCommandRetentionDays` to `runMaintenance` to change the window; `0` keeps the rows
indefinitely. Pruning only removes delivery bookkeeping: if a setting needs to be delivered
again later, the deterministic id means the new row reuses its identity.

Queueing is idempotent: a request identical to one already queued or in flight on the same
device returns that command with `deduplicated: true` instead of inserting a second one.
Queueing a wipe supersedes every other pending action - including an earlier wipe, which is
why double-clicking **Erase** leaves exactly one erase queued - and a newer lock replaces
the previous lock PIN.

### Return to Service

`return-to-service` erases an iPhone, iPad, Apple TV or Apple Vision Pro and lets it enrol
itself again. Apple does not support Return to Service on macOS, and Mattrax refuses the
action there with an explanation instead of sending an erase Apple will ignore.

The erase carries:

- the device's effective **Wi-Fi profile**, so it can rejoin the network after erasing;
- the signed enrollment profile for devices that are not assigned in Apple Business Manager;
  ADE devices re-fetch their profile from Apple's ADE flow instead (the response reports
  `automatedDeviceEnrollment: true`);
- the escrowed **bootstrap token**. iOS/iPadOS/visionOS 26+ require it for Return to Service
  with app preservation, so the action refuses when the device has not escrowed one.

Before queueing, Mattrax requires an enrolled Apple device, a Wi-Fi configuration assigned to
it, and (on 26+) an escrowed bootstrap token. Missing prerequisites are reported as an
actionable `400` rather than sending an erase that cannot re-enrol. The action is recorded on
the device timeline; when the device comes back and sends its next `TokenUpdate`, Mattrax
records the completed re-enrolment.

Devices whose ADE profile sets `is_return_to_service` also send a `ReturnToService` check-in
before erasing (for example when a user triggers it from Control Center). Mattrax answers it
with the same Wi-Fi profile and bootstrap token; with no Wi-Fi policy or for an unenrolled
device it answers `Enabled: false` and the device falls back to a normal erase.

Command state is reconciled against what the device reports, so a command the device has
already satisfied does not stay `sent` forever. A reported application inventory proves
whether a delivered install landed (when the catalogue entry resolves to a bundle id); an
install that is still assigned to the device and provably missing is queued again, up to
three attempts per day. A device that unenrolls or re-enrolls closes out its old commands.

When a device re-enrols into a **different** tenant, the Apple and Windows enrollment paths
remove the previous tenant's device row and relations (commands, policies, memberships,
secrets and inventory) once that tenant has proof the hardware moved (ABM/Autopilot or a
pre-registration), instead of waiting for stale-unenrol. Identity certificates issued to the
old row are revoked, and the old tenant gets a `device.deleted` audit event. Android devices
are bound to a single Android Enterprise and are not migrated through this path, so their
old row still waits for stale-unenrol.

The same deadline applies on every platform: Windows SyncML delivers every queued command in
one session but expires or retries each row on the same rules, and Android commands are
issued directly and rely on the Pub/Sub result. The daily maintenance run expires anything
still active past its deadline (Android has no other way to close a lost result) and prunes
terminal command history older than 90 days. The audit log keeps the record after the row is
gone.

## Users

Two different things are called "users" on a device page:

- **Linked directory users** are Mattrax/Entra/SCIM accounts associated with the device
  (`GET/PUT /devices/:id/users`). Their policies are delivered on the device channel, so a
  user policy affects every login on the device. The checkbox list on the device page edits
  these.
- **Apple user channels** are the logins Apple itself manages over the MDM user channel.
  They carry push credentials, profiles and per-user commands, and they exist only for Apple
  devices. The device page shows them under the same **Users** panel with their binding, last
  check-in, push health and reported profile count.

```text
GET  /api/v1/tenants/:tenantId/devices/:id/apple-users
POST /api/v1/tenants/:tenantId/devices/:id/apple-users/:userId/action
```

`GET .../apple-users` returns `{ enrollmentMode, users }`. `enrollmentMode` is `device` for a
normal device enrollment and `user` for an Apple User Enrollment (BYOD). Each user has
`platformUserId` (Apple's opaque `UserID` or `EnrollmentUserID`), the reported short and long
names, a `binding` (`authenticated`, `enrollment` or `unbound`), push health and the profiles
the channel last reported.

Per-user actions:

| Action             | Behaviour                                                              |
| ------------------ | ---------------------------------------------------------------------- |
| `sync`             | APNs wake-up to that user's token. Rejected when no token is stored.   |
| `refresh-profiles` | Queues `ProfileList` on the user channel; the answer fills `profiles`. |

Both require the write role, not a step-up. They are refused unless the device is enrolled,
the user channel exists on _this_ device, and the tenant owns the device.

The device channel and a user channel never share a queue. A command queued for the device
is not delivered on a user check-in, and a user command is only acknowledged by the same
user's channel. Results from a user channel never overwrite device inventory.

## Unenroll and delete

These are different operations.

**Unenroll** asks the device to remove management. Apple, Windows and Android support it:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/unenroll" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Apple and Windows move to `unenrolling` (Android goes straight to `unenrolled`) and
certificates are revoked. Apple completes removal at its next check-in (and a device that checks in after its tenant or device row is gone
receives `410 Gone`). Windows receives an OMA-DM `Exec` on
`./Vendor/MSFT/DMClient/Provider/Mattrax/Unenroll`; while the device is `unenrolling`, the
next session also deletes the OMA-URIs that were applied, then removes the management
account. A Windows device that removes management locally reports the `1226` Generic Alert
on its next check-in, which moves it straight to `unenrolled`. Android relinquishes
ownership by deleting the device from the tenant's Android enterprise, cancels queued
commands and moves the row straight to `unenrolled`; it requires a recent step-up grant
because it erases work data.

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

## Scripts and the device timeline

The device page's activity feed includes every script run. A terminal run writes
`script.run_completed` or `script.run_failed` with the script name, trigger, status, exit
code, duration and timeout flag. Output is never copied into the timeline; open the script's
run history to read, copy or download it.

Create and assign scripts in **Scripts**. Apple devices receive them as
`com.mattrax.script` profiles executed by the Mattrax agent; Windows uses the same agent
because Windows MDM has no arbitrary-script CSP; Android is unsupported. See
[Scripts](/manage/scripts).

## Health

`GET /api/v1/tenants/:tenantId/device-health` returns fleet counts. The detail endpoint
returns reasons and a level. Health is derived, not a compliance policy. See
[Apple security](/platforms/apple/security) for the reason list.

## Next

- [Groups](/manage/groups)
- [Policies](/manage/policies)
- [Applications](/manage/applications)
- [Scripts](/manage/scripts)
