# Applications

The application catalogue stores app metadata, installer sources and assignments. Each
platform has a real delivery path:

| Platform | Delivery                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------ |
| Apple    | `InstallApplication` (manifest or App Store) or `InstallEnterpriseApplication` (uploaded `.pkg`) |
| Windows  | `EnterpriseDesktopAppManagement` MSI install over SyncML                                         |
| Android  | Assigned apps are merged into the Managed Google Play policy                                     |

Apps can also be attached to a policy (`mttx.apple.application.<id>`), which installs them
on every device in the policy's scope without a separate assignment.

## Sources

| Source     | Required fields                | Install behaviour                                                           |
| ---------- | ------------------------------ | --------------------------------------------------------------------------- |
| `manifest` | `manifestUrl`                  | Apple `InstallApplication`; Windows `.msi` URL; Android package metadata    |
| `store`    | Numeric `storeId` (Apple only) | Apple `InstallApplication` with the iTunes Store id, VPP when configured    |
| `upload`   | A file uploaded to the entry   | Apple `.pkg` via `InstallEnterpriseApplication`; stored for other platforms |

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

Platform-specific identity:

- **Apple** — `bundleId` is the app bundle identifier and is used to reconcile the install
  with the device's inventory. A `.pkg` upload also needs `bundleId`, `version` and a signed
  package.
- **Windows** — `bundleId` is the MSI **ProductCode** (a GUID). `manifestUrl` is the HTTPS
  URL of the signed `.msi`.
- **Android** — `bundleId` is the Managed Google Play package name (for example
  `com.google.android.gm`). `manifestUrl` is not used for delivery.

## Assign

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/$APP_ID/assignments" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "assign": { "groups": ["group_id"], "devices": [] }, "unassign": {} }'
```

Assignments are evaluated for the platform the device reports: an Apple entry only reaches
Apple devices, and so on. Saving an Android assignment immediately repushes the Managed
Google Play policy; saving a Windows or Apple assignment makes the app eligible for the
next install.

## Install

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/$APP_ID/install" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

The response is `{ status, queued, skipped, message? }`. `queued` counts devices for which
work was actually created; a zero count is always accompanied by a message explaining why.
Nothing is reported as successful without a queued command or policy push.

### Apple

- A **manifest** entry queues `InstallApplication` with `ManifestURL`, `InstallAsManaged`
  and `ManagementFlags: 1`.
- A **store** entry consumes a VPP licence when Apps & Books is configured, then queues
  `InstallApplication` with `iTunesStoreID` and `PurchaseMethod: 1`. A configured but
  inactive token fails closed instead of silently using an Apple ID install.
- An **uploaded** entry serves the `.pkg` from R2 through a device-bound, expiring
  `/mdm/apple/assets/...` URL and queues `InstallEnterpriseApplication` with an inline
  manifest: `items[].assets` carries the URL and SHA-256, and `items[].metadata` carries the
  bundle identifier, version and title. The URL is valid for the command's 24-hour window
  and is bound to the device that will fetch it. An uploaded `.ipa` is reported, not
  queued, because it needs an OTA manifest URL.

Installs converge without an operator re-running them. The command has a 24-hour deadline,
and the device's installed-application inventory is reconciled against it: an app that
appears in the inventory marks the command `succeeded`; an app that is still assigned but
missing after the inventory settles marks it `failed` and queues a fresh install, up to
three attempts per day. A repeated request for work that is already queued returns the
existing command instead of queueing a second install.

Reconciliation needs the catalogue entry to resolve to a bundle id; an install of an app
that is not in the catalogue simply expires after its deadline instead.

### Windows

The entry must be an MSI (`.msi` file name, MSI content type, or an `.msi` installer URL)
with the ProductCode in `bundleId`. The install endpoint queues a SyncML `Exec` against:

```text
./Device/Vendor/MSFT/EnterpriseDesktopAppManagement/MSI/{ProductCode}/DownloadInstall
```

The data is an `MsiInstallJob` XML document containing the content URL, the SHA-256 digest
(so the device validates the download) and `/quiet /norestart` enforcement. The command
result reports the msiexec HRESULT; the daily
`EnterpriseDesktopAppManagement/MSI?list=StructData` inventory then reports the product and
its managed state, which appears in the device's application inventory.

An `.exe` or `.intunewin` cannot be installed over OMA-DM (that needs the Intune Management
Extension); the endpoint reports that instead of queueing a command that can never succeed.

### Android

The install endpoint repushes the Managed Google Play policy to each assigned device. The
compiled AMAPI policy includes assigned apps as:

```json
{
  "applications": [
    {
      "packageName": "com.google.android.gm",
      "installType": "FORCE_INSTALLED",
      "autoUpdateMode": "AUTO_UPDATE_DEFAULT"
    }
  ]
}
```

If a policy fragment already configures the same package, the fragment wins: its
`installType`, `autoUpdateMode` and `managedConfiguration` are preserved. Removing the
assignment removes the package from the next compiled policy, which is how Google is told
to uninstall an app it force-installed. Android Management must be configured for the
tenant; otherwise the response says so and nothing is queued.

For a one-off Apple install:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/action" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "action": "install-app", "manifestUrl": "https://example.com/manifest.plist" }'
```

## Applications in a policy

Adding a `mttx.apple.application.<id>` configuration to a policy installs the app on every
device that receives the policy. `<id>` is any stable key (for example `office`). The
configuration data is either a catalogue reference:

```json
{ "applicationId": "application-row-id" }
```

or a self-contained install:

```json
{
  "source": "upload",
  "sha256": "<sha256 of the uploaded .pkg>",
  "fileName": "Office.pkg",
  "contentType": "application/vnd.apple.installer+xml",
  "bundleId": "com.microsoft.Office",
  "version": "16.0",
  "title": "Microsoft Office",
  "configuration": { "AllowedDomain": "example.com" }
}
```

A `manifest` source (`manifestUrl`, `bundleId`, `version`) and a `store` source (`storeId`)
work the same way. `configuration` is the managed app configuration dictionary passed to
the install command. Upload a policy-scoped `.pkg` first:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID/applications" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "fileName": "Office.pkg", "content": "<base64>" }'
```

Saving a policy validates that a referenced catalogue entry exists in the tenant and that
an uploaded package is present in the policy's storage. Delivery is per device: each Mac
receives its own expiring package URL, and installed bundles are skipped so a stable policy
does not re-install an app on every check-in. Uploaded packages install on macOS only; use
a manifest for iOS enterprise apps.

Third-party applications can also be added from the policy designer's **Third-party apps**
section. That catalogue (`/catalog/third-party-apps.json`) carries managed settings for
Chrome, Edge, Firefox, Slack, Zoom, Teams, VS Code and 1Password, sourced from
ProfileManifests, the vendors' enterprise policy documentation and AppConfig schemas. On
Apple it compiles to `com.apple.ManagedClient.preferences` on macOS; on Windows to Policy
CSP nodes; on Android to `applications[].managedConfiguration`.

## Upload a package

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/$APP_ID/upload" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "fileName": "app.pkg", "content": "<base64>" }'
```

The package is stored in R2 and its SHA-256 is recorded. An Apple `.pkg` is then served to
assigned Macs through the signed asset URL described above; iPhones require an OTA manifest
for an `.ipa`, and other platforms keep the file for download.

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

- Uploaded `.ipa` files are not installable without an OTA manifest URL.
- A Windows `.exe`/`.intunewin` needs the Intune Management Extension; only MSI installs
  run over OMA-DM.
- Windows Store (MSIX) apps and Android APK uploads are not delivered by this flow.
- Releasing a VPP licence does not uninstall the app.
- A store app attached to a policy is not installed while Apps & Books is configured:
  install it from the applications page so a licence is assigned instead of bypassing the
  pool.
- There is no uninstall flow for catalogue apps. Removing an Android assignment removes the
  app from the policy; Windows and Apple installs remain until removed on the device.

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
| `POST`             | `/api/v1/tenants/:tenantId/policies/:id/applications`         | Upload a policy package  |

## Next

- [Apps & Books](/platforms/apple/vpp)
- [Apple security](/platforms/apple/security)
