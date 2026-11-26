# Applications

The application catalogue stores app metadata, installer sources and assignments. Each
platform has a real delivery path:

| Platform | Delivery                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| Apple    | `InstallApplication` (manifest, App Store or uploaded `.ipa`) or `InstallEnterpriseApplication` (uploaded `.pkg`) |
| Windows  | `EnterpriseDesktopAppManagement` MSI install over SyncML                                                          |
| Android  | Assigned apps are merged into the Managed Google Play policy                                                      |

Apps can also be attached to a policy (`mttx.apple.application.<id>`), which installs them
on every device in the policy's scope without a separate assignment.

## Curated software catalogue

The dashboard's **Applications → Catalogue** tab carries a curated list of common business,
school and consumer titles with vendor, identifiers, supported platforms and deployment methods.
Adding a title creates ordinary application entries with the right source for each platform; it
does not introduce a second installer. Catalogue-created Apple entries also record their OS target,
so a macOS App Store title is not queued on an iPhone or vice versa. See [Software catalogue](/manage/software-catalogue) for
the platform matrix, the data contract and the limits (notably #568 for Windows Win32/MSIX/Store
and #589 for versioned vendor feeds).

## Sources

| Source     | Required fields                | Install behaviour                                                        |
| ---------- | ------------------------------ | ------------------------------------------------------------------------ |
| `manifest` | `manifestUrl`                  | Apple `InstallApplication`; Windows `.msi` URL; Android package metadata |
| `store`    | Numeric `storeId` (Apple only) | Apple `InstallApplication` with the iTunes Store id, VPP when configured |
| `upload`   | A file uploaded to the entry   | Apple `.pkg` on macOS, `.ipa` on iOS/iPadOS; stored for other platforms  |

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
  and uninstall with the device's inventory. An uploaded `.pkg` or `.ipa` also needs
  `bundleId`, `version` and a signed artefact. Mattrax does not re-sign an upload: the
  `.ipa` must carry a valid enterprise or ad-hoc provisioning profile, and the catalogue
  shows its expiry when it can be read from the file.
- **Windows** — `bundleId` is the MSI **ProductCode** (a GUID). `manifestUrl` is the HTTPS
  URL of the signed `.msi`.
- **Android** — `bundleId` is the Managed Google Play package name (for example
  `com.google.android.gm`). `manifestUrl` is not used for delivery.

## Regions and availability

The App Store id (Apple's `trackId`, called `adamId` in Apps & Books) is allocated per
app record, not per storefront: Pages is `361309726` in every storefront. What differs is
availability — an app can be published in some storefronts and not others — and a vendor
that publishes separate records for different markets gets a different id in each. The
catalogue therefore keeps one storefront row per application, holding the id, availability,
last-seen time and reason.

The id used for a device install is resolved deterministically:

1. the tenant's **App Store region** (Settings → General; empty means the US storefront),
2. otherwise the US storefront,
3. otherwise any other available storefront in region order,
4. otherwise the installer's legacy single `storeId`.

Apple's MDM device information does not expose a reliable device storefront, so resolution
uses the tenant setting rather than guessing from a device locale.

Record a manual mapping (this replaces the full set; rows omitted are removed):

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/$APP_ID/storefronts" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "storefronts": [
        { "region": "US", "storeId": "123456789" },
        { "region": "GB", "storeId": "987654321" }
      ] }'
```

Check the live stores (each region is queried through Apple's public lookup API; bundle id
is preferred because a legacy id from another storefront may not resolve):

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/$APP_ID/storefronts/refresh" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "regions": ["US", "GB"] }'
```

A lookup that definitively returns no app marks that storefront unavailable and keeps the
last time the app was seen; a network or HTTP failure leaves the previous state alone. Once
no storefront carries the app the catalogue entry becomes `unavailable`: it is badged in
the list, the detail page shows a banner, and installing it queues nothing. Nothing is
deleted and existing assignments stay in place.

Unlink it explicitly:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/$APP_ID/unlink" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Pulled by the vendor" }'
```

This removes group, directory-group and direct-device assignments and returns the counts;
the application row and every device's install history are retained. A tenant can enable
**Unlink unavailable apps** in Settings → General to do this automatically when a refresh
finds the app in none of its storefronts.

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
  and `ManagementFlags: 1`. If the URL ends in `.pkg` (or the entry came from the catalogue's
  `apple-pkg` method), Mattrax instead queues `InstallEnterpriseApplication` with an inline
  manifest and the device downloads the vendor package. The vendor controls those bytes and no
  SHA-256 is recorded; use an uploaded package when hash pinning is required.
- A **store** entry consumes a VPP licence when Apps & Books is configured, then queues
  `InstallApplication` with `iTunesStoreID` and `PurchaseMethod: 1`. A configured but
  inactive token fails closed instead of silently using an Apple ID install.
- An **uploaded** entry serves the file from R2 through a device-bound, expiring
  `/mdm/apple/assets/...` URL. A `.pkg` installs on macOS with
  `InstallEnterpriseApplication` and an inline manifest: `items[].assets` carries the URL
  and SHA-256, and `items[].metadata` carries the bundle identifier, version and title.
  An `.ipa` installs on iOS/iPadOS with `InstallApplication` and a `ManifestURL` that
  points at an OTA manifest Mattrax generates at
  `/mdm/apple/manifests/...?token=...`; the manifest has the same
  `items[].assets[0].url` plus `items[].metadata` (`bundle-identifier`,
  `bundle-version`, `kind: "software"`, `title`). Both URLs are valid for the command's
  24-hour window and bound to the device that will fetch them. A file that is neither a
  `.pkg` nor an `.ipa`, or an upload without a bundle id, is reported with a specific
  reason instead of being queued.

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

## Uninstall

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/$APP_ID/uninstall" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

The response is `{ status, queued, skipped, failed?, message? }`. Mattrax only removes an app
it has a recorded successful install for; a user-installed App Store app on the same device
is never claimed or removed. A zero count is always accompanied by a reason.

Per platform:

- **Apple** — queues `RemoveApplication` with `BundleIdentifier`. Apple only removes managed
  apps, which is why the recorded-install check exists. There is no keep-user-data option:
  the managed app container is removed with the app. A VPP licence is returned **after** a
  later inventory confirms the app is gone, not when the command is queued.
- **Windows** — queues an `Exec` against
  `EnterpriseDesktopAppManagement/MSI/{ProductCode}/Uninstall` with `/quiet /norestart`.
  An installer without an MSI ProductCode (a Store app or an `.exe`) is reported `failed`
  with that explanation instead of queueing a command that cannot run. An MSI that does not
  implement a silent uninstall is reported failed by the device result.
- **Android** — Google removes force-installed apps by taking them out of the compiled
  policy. An explicit uninstall while the app is still assigned is refused with that
  explanation; unassign it (or enable the option below) and the next policy sync removes it.

Every request records a per-device uninstall with a 24-hour deadline. The next application
inventory resolves it: the app is gone → `succeeded`; still present after the deadline →
`failed` with the version the device reported. The queued command is closed with the same
outcome, so command history and the device timeline agree.

### Remove on unassign

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/$APP_ID" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "removeOnUnassign": true }'
```

With this on, Mattrax queues a removal on the devices that lost access (the same
recorded-install rule applies) and audits `application.uninstall_queued`. This happens when
an assignment is saved or unlinked, and Apple devices also apply the rule on every check-in,
so group membership changes and group/device removal converge without a separate action. The
app is not reported gone until the next inventory; a device that was offline keeps the old
app until it checks in again. Android devices receive the removal through the policy sync.
Windows removals are queued when the assignment change is saved. Off by default: removing an
assignment otherwise only stops future installs.

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
an uploaded package is present in the policy's storage. Delivery is per device: each device
receives its own expiring URL, and installed bundles are skipped so a stable policy does not
re-install an app on every check-in. A catalogue entry that points at an uploaded `.pkg`
reaches Macs; one that points at an `.ipa` reaches iPhones and iPads. A package uploaded
against the policy itself is `.pkg`-only.

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

The file is stored in R2 and its SHA-256 is recorded. An Apple `.pkg` is served to assigned
Macs and an `.ipa` to assigned iPhones/iPads through the signed asset URL described above;
Mattrax hosts the OTA manifest for the `.ipa`. Other platforms keep the file for download.
When the upload is an `.ipa`, its embedded `embedded.mobileprovision` expiry is read and
shown on the catalogue entry; an unreadable profile just omits the expiry. The file is
never re-signed, so renew the provisioning profile and upload a freshly signed `.ipa` before
it expires.

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

- An uploaded `.ipa` is installed as-is: Mattrax does not re-sign it, so an expired or
  missing enterprise/ad-hoc provisioning profile makes the install fail on the device. The
  catalogue shows the profile expiry when it can be read.
- Apple User Enrollment (BYOD) devices cannot install a managed `.ipa` or have a managed app
  removed; Mattrax refuses those requests instead of queueing a command Apple ignores.
- A Windows `.exe`/`.intunewin` needs the Intune Management Extension; only MSI installs
  run over OMA-DM.
- Windows Store (MSIX) apps and Android APK uploads are not delivered by this flow.
- Releasing a VPP licence does not uninstall the app. An uninstall returns the licence
  automatically only after inventory confirms the app is gone.
- A store app attached to a policy is not installed while Apps & Books is configured:
  install it from the applications page so a licence is assigned instead of bypassing the
  pool.
- Uninstall only removes apps Mattrax installed and recorded. Apple's `RemoveApplication`
  has no keep-user-data option, and no platform here exposes a separate remove-data switch:
  removing a managed app may remove its data.
- A policy-scoped upload (`POST /policies/:id/applications`) is still `.pkg` only; use a
  catalogue entry to install an uploaded `.ipa` through a policy.
- Unlinking an unavailable app removes assignments; devices keep the app unless
  `removeOnUnassign` is on, in which case the same recorded-install rule queues a removal.
  Restoring availability does not re-check devices until the app is installed or assigned
  again.
- Tenant export/restore carries application metadata but not the per-storefront mapping;
  a restored tenant starts with `unknown` availability until the app is refreshed.

## API endpoints

| Method             | Path                                                             | Purpose                  |
| ------------------ | ---------------------------------------------------------------- | ------------------------ |
| `GET/POST`         | `/api/v1/tenants/:tenantId/applications`                         | List / create            |
| `GET/PATCH/DELETE` | `/api/v1/tenants/:tenantId/applications/:id`                     | Detail / update / delete |
| `PATCH`            | `/api/v1/tenants/:tenantId/applications/:id/assignments`         | Assign                   |
| `PATCH`            | `/api/v1/tenants/:tenantId/applications/:id/storefronts`         | Storefront mapping       |
| `POST`             | `/api/v1/tenants/:tenantId/applications/:id/storefronts/refresh` | Check availability       |
| `POST`             | `/api/v1/tenants/:tenantId/applications/:id/unlink`              | Unlink assignments       |
| `POST`             | `/api/v1/tenants/:tenantId/applications/:id/install`             | Queue install            |
| `POST`             | `/api/v1/tenants/:tenantId/applications/:id/uninstall`           | Queue uninstall          |
| `POST`             | `/api/v1/tenants/:tenantId/applications/:id/upload`              | Upload package           |
| `GET`              | `/api/v1/tenants/:tenantId/applications/:id/download/:sha256`    | Download package         |
| `GET`              | `/api/v1/tenants/:tenantId/applications/inventory`               | Fleet inventory          |
| `POST`             | `/api/v1/tenants/:tenantId/policies/:id/applications`            | Upload a policy package  |

## Next

- [Apps & Books](/platforms/apple/vpp)
- [Apple security](/platforms/apple/security)
