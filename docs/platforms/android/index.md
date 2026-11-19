# Android

Android management uses Google's Android Management API (AMAPI). It covers work profiles,
fully managed and dedicated devices: enterprise signup, enrollment tokens, policy delivery,
inventory, remote commands and reconciliation. Delivery needs Google Cloud credentials, so
nothing is sent until an operator configures the deployment and a tenant connects its
enterprise.

## What is supported

| Area          | Support                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| Signup        | Google-hosted enterprise signup with a signed callback                       |
| Enrollment    | One-time AMAPI enrollment token and QR code, with a chosen provisioning mode |
| Policy        | AMAPI policy fragments, deterministic merge, delivery and cleanup            |
| Commands      | Wipe, reboot, lock, lost mode, password reset, app data and device info      |
| Notifications | Google Pub/Sub with OIDC verification and idempotency                        |
| Inventory     | Hardware, software, memory, network, management state and installed apps     |
| Apps          | Assigned Managed Google Play apps in the policy (`applications`)             |
| Sync          | Manual reconcile: device list, command results and superseded policies       |
| Compliance    | Derived device health only                                                   |

## Prerequisites

- A Google Cloud project with the Android Management API enabled.
- A service account with the Android Management user role.
- A Pub/Sub topic and a push subscription pointing at
  `<ORIGIN>/api/v1/android/pubsub`.
- An OIDC service account token on the subscription whose audience matches
  `ANDROID_MANAGEMENT_PUBSUB_AUDIENCE` (or the default endpoint URL).
- A trusted HTTPS origin.

## Configure the deployment

Set these on the API Worker:

```bash
cf workers secrets update ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON \
  --worker mattrax-api --type secret_text --text "$(cat service-account.json)"

cf workers secrets update ANDROID_MANAGEMENT_PROJECT_ID \
  --worker mattrax-api --type secret_text --text 'my-project'

cf workers secrets update ANDROID_MANAGEMENT_PUBSUB_TOPIC \
  --worker mattrax-api --type secret_text \
  --text 'projects/my-project/topics/mattrax-android'

cf workers secrets update ANDROID_MANAGEMENT_PUBSUB_SUBSCRIPTION \
  --worker mattrax-api --type secret_text \
  --text 'projects/my-project/subscriptions/mattrax-android'
```

The full service-account JSON is used in memory; only the client email and project id are
persisted. Without the service account every Android endpoint returns
`EnterpriseNotConfigured` and the dashboard keeps Android unavailable.

The topic and subscription must already exist. Mattrax records their names but does not
call the Pub/Sub Admin API.

## Connect Android Enterprise

1. Open **Settings → Management → Android**.
2. Choose **Connect Android Enterprise**.
3. Complete Google's signup flow.
4. The callback creates the enterprise with the configured Pub/Sub topic and notification
   types, creates the default `mattrax-default` policy and marks the tenant active.
5. Choose how new devices are provisioned (below) and issue an enrollment token.

The callback state is HMAC-signed with a 30-minute TTL plus a one-time nonce. Replayed or
tampered callbacks are rejected.

## Enrollment

1. Choose how new devices enroll under **Settings → Management → Android → New devices
   enroll as**:

   | Mode              | `allowPersonalUsage`                 | What the device becomes                                             |
   | ----------------- | ------------------------------------ | ------------------------------------------------------------------- |
   | **Work profile**  | `PERSONAL_USAGE_ALLOWED`             | A managed work profile on a personally owned or company-owned phone |
   | **Fully managed** | `PERSONAL_USAGE_DISALLOWED`          | A company-owned device with no personal profile                     |
   | **Dedicated**     | `PERSONAL_USAGE_DISALLOWED_USERLESS` | A kiosk or shared device with no user account                       |

   The mode applies to tokens issued from then on; enrolled devices keep the mode they
   were provisioned with. Each device page shows the mode Google actually reports, so a
   device that ignores the request is visible rather than assumed.

   **Disconnect** (`PATCH /android` with `{ "disconnect": true }`) deletes the Google
   enterprise with its policies and devices. It needs the tenant-delete permission and a
   recent step-up grant; local device rows stay, marked unenrolled.

2. Enable **Android** on **Devices → Enrollment**.
3. The page requests a one-time enrollment token from AMAPI with the tenant id in
   `additionalData` and the selected `allowPersonalUsage`, valid for one hour.
4. Scan the QR code during Android setup, or enter `afw#setup` and the token. The enrollment
   page explains the steps for the selected mode.

Google has no documented universal deep link for AMAPI enrollment. The QR code and
`afw#setup` are the supported paths.

The token is one-time and expires. Reload the enrollment page for a new one.

## Policy delivery

Effective `mttx.android.policy*` configurations are merged and delivered through AMAPI.
See [Android policies](/platforms/android/policies).

## Commands

| Action                 | AMAPI command / call                                |
| ---------------------- | --------------------------------------------------- |
| `wipe`                 | `WIPE`                                              |
| `restart`              | `REBOOT`                                            |
| `lock`                 | `LOCK`                                              |
| `start-lost-mode`      | `START_LOST_MODE`                                   |
| `stop-lost-mode`       | `STOP_LOST_MODE`                                    |
| `reset-password`       | `RESET_PASSWORD`                                    |
| `clear-app-data`       | `CLEAR_APP_DATA`                                    |
| `request-device-info`  | `REQUEST_DEVICE_INFO`                               |
| `relinquish-ownership` | `RELINQUISH_OWNERSHIP`                              |
| `unenroll` (endpoint)  | `enterprises.devices.delete`                        |
| `sync`                 | Reconcile from Google, then push the current policy |

`reset-password` generates a temporary password for Google and never stores or returns it.
`clear-app-data` clears the data of every managed app in the device's compiled policy, including
apps declared by policy fragments and catalogue assignments.
`reset-password` is only offered on company-owned devices, and `relinquish-ownership` only on
company-owned work profiles; the device page hides controls Android would reject.

Command results arrive through Pub/Sub and update the command row. **Sync** on a device
reads that device from Google, pushes its policy and polls its unfinished operations;
**Sync devices & policies** in Settings does the same for the whole enterprise. A dropped
notification therefore cannot leave an action spinning until its budget expires, and a
device deleted in Google is retired instead of being pushed to.

## Pub/Sub behaviour

`POST /api/v1/android/pubsub` verifies the Google OIDC token (issuer, audience, service
account email, JWKS signature) and records `message.messageId` in an idempotency ledger.

Notification types:

- `ENROLLMENT` and `STATUS_REPORT` — upsert the device, map AMAPI state to Mattrax status,
  refresh inventory, ingest `applicationReports` and sync policy.
- `COMMAND` — match the operation name to the queued command and update its status.

Messages are recorded only after a successful apply, so a retry is safe.

A device state of `DISABLED` (suspended) or `LOST` (lost mode) is still a managed device:
it stays `enrolled` so the dashboard keeps offering the commands that undo it. Only
`DELETED` and `DEACTIVATED_BY_DEVICE_FINANCE` end management.

### Reconciliation

Pub/Sub is at-least-once, so a delivery can be missed and the dashboard would then show
state Google has already changed. **Sync devices & policies** walks the Google enterprise
instead and repairs the difference:

1. re-asserts the `ENROLLMENT`, `STATUS_REPORT` and `COMMAND` notification types (an
   enterprise created by an older deployment is missing them),
2. lists every device and applies the same merge a notification would,
3. retires local devices Google no longer lists,
4. polls in-flight command operations,
5. pushes the effective policy to every enrolled device,
6. deletes superseded `mattrax-*` policies that no device references.

Step 6 matters because every distinct policy hash becomes its own Google policy resource.
Without cleanup the enterprise would accumulate one policy per edit; the baseline
(`mattrax-default`), each device's assigned policy and any policy a device reports as
applied are kept.

## Inventory

Every `ENROLLMENT` and `STATUS_REPORT` merges the AMAPI `Device` resource into the device
row. Google sends partial resources, so a field that is absent means "not reported" and
never clears a known value:

| AMAPI field                                 | Stored in                                   |
| ------------------------------------------- | ------------------------------------------- |
| `hardwareInfo.model`                        | `model`, and `physicalName`/`name`          |
| `hardwareInfo.hardware`                     | `modelIdentifier`                           |
| `hardwareInfo.serialNumber`                 | `serial`                                    |
| `hardwareInfo.manufacturer`                 | `vendor`                                    |
| `displayName`                               | `physicalName` when the enterprise sets one |
| `softwareInfo.androidVersion`               | `osEdition` (`Android`), `osVersion`        |
| `softwareInfo.androidBuildNumber`           | `osBuild`                                   |
| `softwareInfo.securityPatchLevel`           | `android_device.security_patch_level`       |
| `memoryInfo.totalInternalStorage`           | `diskTotal`                                 |
| `memoryInfo.totalRam`                       | `android_device.total_ram`                  |
| `apiLevel`                                  | `android_device.api_level`                  |
| `managementMode`, `ownership`, `state`      | `android_device` management columns         |
| `appliedPolicyName`, `appliedPolicyVersion` | `android_device` policy columns             |
| `enrollmentTokenName`                       | `android_device.enrollment_token_name`      |
| `disabledReason.localizedMessage`           | `android_device.disabled_reason`            |
| `networkInfo.networkOperatorName`           | `android_device.network_operator`           |
| `applicationReports`                        | `device_application` (full replacement)     |
| any of the above                            | `inventoryUpdatedAt`                        |

IMEI, MEID and Wi-Fi MAC addresses are deliberately not parsed or stored.

**Device names.** AMAPI has no field for the user-visible Android device name. The reported
name is the enterprise `displayName` when present, otherwise the hardware model (for
example `Pixel 9 Pro`). It becomes the management name while that is still blank or a
placeholder (serial, model, resource id or previous reported name); an administrator's
rename is never overwritten. The applied policy is shown separately on the device page.

**Application reporting.** Google only reports software, application, memory and network
detail when `statusReportingSettings` enables it, and disables most of it by default.
Mattrax merges `softwareInfoEnabled`, `applicationReportsEnabled`, `memoryInfoEnabled` and
`networkInfoEnabled` underneath every compiled policy; an explicit tenant value still wins
(at the cost of that inventory). Applications whose AMAPI state is `REMOVED` or
`PENDING_UNINSTALL` are not listed as installed.

The device page marks the application list stale after seven days without a report.

## Application delivery

Assigned application catalogue entries (`platform: android`) are merged into the compiled
policy as `applications` entries. A package the policy fragments already configure keeps
its `installType`, `autoUpdateMode` and `managedConfiguration`; only assigned packages the
policy does not mention are added, as `FORCE_INSTALLED` with `AUTO_UPDATE_DEFAULT`.

Removing an assignment removes the package from the next compiled policy, which makes
Google uninstall an app it force-installed. The policy hash changes, so the device receives
the new policy on the next sync. See
[Applications](/manage/applications#android) for the catalogue fields.

## Limitations

- No managed Google Play approval flow; apps must already be approved for the enterprise in
  the Play console. Managed configurations and per-package install types are set in the
  policy (`applications`), not in a separate app UI.
- App inventory depends on `statusReportingSettings.applicationReportsEnabled`; a tenant
  policy that turns it off leaves the list empty.
- Assigning an app only changes the policy; there is no per-device install command because
  AMAPI delivers apps through the policy.
- No eSIM commands are exposed.
- No Android compliance state ingestion; device health is derived from inventory.
- Deleting a device with the dashboard's Delete action first removes the Google device
  resource. If Google refuses, the request fails and the row stays, so a device cannot be
  orphaned in Google. **Disconnect** deletes the whole enterprise, including its policies
  and every device record.
- Unenrolling deletes the Google device resource. `relinquish-ownership` is available
  separately for company-owned work profiles that should keep their personal data.
- Android Enterprise is not part of tenant export/backup: the Google enterprise is a
  deployment-side resource and reconnects with a new signup after a restore.
- Android devices are stored with `serial = null` when the serial would collide with an
  Apple or Windows device in the same tenant.
- Signup, Pub/Sub, enrollment, policy convergence and commands have not been validated
  against a real Google Cloud project and managed device; the test suite uses an in-memory
  Google double.
- There is no universal enrollment deep link.

## API endpoints

| Method      | Path                                       | Purpose                                         |
| ----------- | ------------------------------------------ | ----------------------------------------------- |
| `GET/PATCH` | `/api/v1/tenants/:tenantId/android`        | Status, enablement, provisioning and disconnect |
| `POST`      | `/api/v1/tenants/:tenantId/android/signup` | Create the Google signup URL                    |
| `POST`      | `/api/v1/tenants/:tenantId/android/sync`   | Reconcile and push policies                     |
| `GET`       | `/api/v1/android/signup/callback`          | Google signup callback                          |
| `POST`      | `/api/v1/android/pubsub`                   | Pub/Sub push endpoint                           |

## Next

- [Android policies](/platforms/android/policies)
- [Troubleshooting](/operations/troubleshooting)
