# Android

Android management uses Google's Android Management API (AMAPI). It is implemented in the
repository but gated behind deployment credentials and has not been validated against real
devices. Treat it as preview.

## What is supported

| Area          | Support                                                  |
| ------------- | -------------------------------------------------------- |
| Signup        | Google-hosted enterprise signup with a signed callback   |
| Enrollment    | One-time AMAPI enrollment token and QR code              |
| Policy        | AMAPI policy fragments, deterministic merge and delivery |
| Commands      | Wipe, restart, lock and policy sync                      |
| Notifications | Google Pub/Sub with OIDC verification and idempotency    |
| Apps          | Not implemented                                          |
| Compliance    | Derived device health only                               |

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

The callback state is HMAC-signed with a 30-minute TTL plus a one-time nonce. Replayed or
tampered callbacks are rejected.

## Enrollment

1. Enable **Android** on **Devices → Enrollment**.
2. The page requests a one-time enrollment token from AMAPI with the tenant id in
   `additionalData`.
3. Scan the QR code during Android setup, or choose **Work profile** / **Fully managed**
   and use `afw#setup` with the token.

Google has no documented universal deep link for AMAPI enrollment. The QR code and
`afw#setup` are the supported paths.

The token is one-time and expires. Reload the enrollment page for a new one.

## Policy delivery

Effective `mttx.android.policy*` configurations are merged and delivered through AMAPI.
See [Android policies](/platforms/android/policies).

## Commands

| Action    | AMAPI command               |
| --------- | --------------------------- |
| `wipe`    | `WIPE`                      |
| `restart` | `REBOOT`                    |
| `lock`    | `LOCK`                      |
| `sync`    | Push the current policy now |

Command results arrive through Pub/Sub and update the command row.

## Pub/Sub behaviour

`POST /api/v1/android/pubsub` verifies the Google OIDC token (issuer, audience, service
account email, JWKS signature) and records `message.messageId` in an idempotency ledger.

Notification types:

- `ENROLLMENT` and `STATUS_REPORT` — upsert the device, map AMAPI state to Mattrax status,
  populate model/manufacturer/serial/OS and sync policy.
- `COMMAND` — match the operation name to the queued command and update its status.

Messages are recorded only after a successful apply, so a retry is safe.

## Limitations

- No managed Google Play approval, app distribution or app install/uninstall.
- No password reset, lost mode, clear app data or eSIM commands exposed.
- No Android compliance state ingestion.
- Deleting a device removes local rows only; the Google device and enterprise mapping
  remain.
- Android devices are stored with `serial = null` when the serial would collide with an
  Apple or Windows device in the same tenant.
- Signup, Pub/Sub, enrollment, policy convergence and commands have not been validated
  against a real Google Cloud project and managed device.
- There is no universal enrollment deep link.

## API endpoints

| Method      | Path                                       | Purpose                      |
| ----------- | ------------------------------------------ | ---------------------------- |
| `GET/PATCH` | `/api/v1/tenants/:tenantId/android`        | Status and enablement        |
| `POST`      | `/api/v1/tenants/:tenantId/android/signup` | Create the Google signup URL |
| `POST`      | `/api/v1/tenants/:tenantId/android/sync`   | Push policies now            |
| `GET`       | `/api/v1/android/signup/callback`          | Google signup callback       |
| `POST`      | `/api/v1/android/pubsub`                   | Pub/Sub push endpoint        |

## Next

- [Android policies](/platforms/android/policies)
- [Troubleshooting](/operations/troubleshooting)
