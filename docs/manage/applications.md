# Applications

The application catalogue stores app metadata and assignments. Installation depends on the
platform and the source of the app.

## Sources

| Source     | Required fields   | Install behaviour                                   |
| ---------- | ----------------- | --------------------------------------------------- |
| `manifest` | `manifestUrl`     | Apple `InstallApplication` with the manifest URL    |
| `store`    | Numeric `storeId` | Apple `InstallApplication` with the iTunes Store id |
| `upload`   | Uploaded package  | Stored in R2; not automatically installable         |

Create an entry:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Example App",
    "platform": "apple",
    "bundleId": "com.example.app",
    "version": "1.4.0",
    "source": "store",
    "storeId": "123456789"
  }'
```

Apple entries must have a manifest URL or a numeric store id. Windows and Android entries
can be stored for inventory purposes, but installation is not implemented.

## Assign

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/$APP_ID/assignments" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "assign": { "groups": ["group_id"], "devices": [] }, "unassign": {} }'
```

## Install

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/$APP_ID/install" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

The response is `{ queued, skipped }`. Only enrolled Apple devices are eligible. The
command is delivered on the next check-in and is not marked successful until the device
reports the app.

Installs converge without an operator re-running them. The command has a 24-hour deadline,
and the device's installed-application inventory is reconciled against it: an app that
appears in the inventory marks the command `succeeded`; an app that is still assigned but
missing after the inventory settles marks it `failed` and queues a fresh install, up to
three attempts per day. A repeated request for work that is already queued returns the
existing command instead of queueing a second install.

Reconciliation needs the catalogue entry to resolve to a bundle id; an install of an app
that is not in the catalogue simply expires after its deadline instead.

For a one-off install:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/action" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "action": "install-app", "manifestUrl": "https://example.com/manifest.plist" }'
```

## Upload a package

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/$APP_ID/upload" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "fileName": "app.pkg", "content": "<base64>" }'
```

The package is stored in R2 and metadata is recorded. Mattrax does not generate an OTA
manifest for uploaded packages. To install, provide a manifest URL that points at your own
manifest, or use a VPP licence.

Download:

```text
GET /api/v1/tenants/:tenantId/applications/:id/download/:sha256
```

This returns JSON with base64 `content`.

## VPP

Apps & Books licences are managed separately from the catalogue:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/vpp/assets/$ADAM_ID/install" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "devices": ["device_id"], "groups": ["group_id"] }'
```

See [Apps & Books](/platforms/apple/vpp).

## Inventory

Per device:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/applications" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Tenant-wide, grouped by bundle id:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/inventory?q=chrome&managed=managed&updates=available" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Filters: `q`, `managed=managed|unmanaged`, `updates=available`, `limit` (max 500),
`offset`.

Inventory is collected from every platform without an administrator pressing anything:

- Apple reports its full list in response to an `InstalledApplicationList` command. The
  daily maintenance run queues one for every enrolled device whose inventory is missing or
  older than a day, and `refresh-applications` collects it immediately.
- Windows reports `Win32AppInventory` and the MSI packages Mattrax deployed once a day.
- Android reports `applicationReports` with every status notification.

Each refresh replaces the device's rows, and the device page shows when the last report
arrived and whether it is stale. `publisher` is reported by Windows inventory.

## Limitations

- Apple app deployment through policy (`mttx.apple.application.<id>`) is rejected.
- Uploaded packages are stored but not automatically installable.
- Windows and Android app installation is not implemented.
- Release a VPP licence does not uninstall the app.
- Android and Windows inventory is collected, but only Apple app installation exists.
- There is no uninstall, update or managed-app configuration flow.

## API endpoints

| Method             | Path                                                          | Purpose                  |
| ------------------ | ------------------------------------------------------------- | ------------------------ |
| `GET/POST`         | `/api/v1/tenants/:tenantId/applications`                      | List / create            |
| `GET/PATCH/DELETE` | `/api/v1/tenants/:tenantId/applications/:id`                  | Detail / update / delete |
| `PATCH`            | `/api/v1/tenants/:tenantId/applications/:id/assignments`      | Assign                   |
| `POST`             | `/api/v1/tenants/:tenantId/applications/:id/install`          | Queue install            |
| `POST`             | `/api/v1/tenants/:tenantId/applications/:id/upload`           | Upload package           |
| `GET`              | `/api/v1/tenants/:tenantId/applications/:id/download/:sha256` | Download package         |
| `GET`              | `/api/v1/tenants/:tenantId/applications/inventory`            | Fleet inventory          |

## Next

- [Apps & Books](/platforms/apple/vpp)
- [Apple security](/platforms/apple/security)
