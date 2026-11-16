# Quick start

This walkthrough creates a tenant and enrolls one Apple device. Windows and Android notes
follow at the end.

## Before you start

- A Mattrax account.
- An Apple device running a supported version of macOS, iOS or iPadOS.
- An APNs push certificate for the tenant. Mattrax generates the CSR; you sign it with
  Apple and upload the `.pem`.
- A trusted HTTPS origin. Apple devices do not enroll over plain HTTP.

## 1. Create an account and tenant

1. Open `/register` on your deployment, enter your name and email, and continue.
2. Enter the six-digit code sent to your email, then create the passkey when your device
   prompts for it. The account is created with the address already verified; no email
   link or callback page is involved.
3. Create a tenant. The account that creates it becomes the `owner`.
4. Open **Settings → General** and set the tenant name, slug, display name, support email
   and brand colour. The slug becomes the `/t/<slug>` part of every dashboard link; the
   other values appear on the enrollment page and in profiles.

## 2. Configure APNs

Apple MDM cannot push without a tenant APNs certificate.

1. Open **Settings → Management → Apple push**.
2. Download the CSR plist.
3. Sign it at [identity.apple.com/pushcert](https://identity.apple.com/pushcert) with an
   Apple ID that has the MDM push certificate role.
4. Download the resulting `.pem` and upload it together with the Apple ID email.
5. Confirm the topic is shown and the certificate is valid.

If your deployment sets `CLOUD_APPLE_VENDOR_CERT` and `CLOUD_APPLE_VENDOR_KEY`, the CSR
can be signed without leaving the dashboard.

## 3. Create a group

1. Open **Devices → Groups** and create a manual group, for example `Macs`.
2. Leave it empty for now. You can also create a dynamic group later; see
   [Groups](/manage/groups).

## 4. Create a policy

1. Open **Policies → New policy**.
2. Name it `Baseline`.
3. Add a configuration:
   - Use the **designer** for structured Apple settings, or
   - Upload a `.mobileconfig` as a custom profile.
4. Save the policy and assign it to the `Macs` group with mode **include**.

For a first test, a custom profile with a harmless restriction is enough. See
[Policies](/manage/policies) for the full set of configuration kinds.

## 5. Create the enrollment link

1. Open **Devices → Enrollment**.
2. Enable **Apple**.
3. Optionally set an enrollment password and a device cap.
4. Copy the enrollment link or show the QR code.

The link is public but rate-limited. If a password is set, the user must enter it before
the profile can be downloaded. The password is not embedded in the QR code.

## 6. Enroll the device

On the Apple device:

1. Open the enrollment link in Safari.
2. Enter the enrollment password if prompted.
3. Download the profile.
4. Install it in **System Settings → Privacy & Security → Profiles** (macOS) or
   **Settings → General → VPN & Device Management** (iOS/iPadOS).
5. Approve the management prompt.

The device performs an `Authenticate` check-in, receives its SCEP identity and MDM
payload, then sends `TokenUpdate`. Its status moves from `enrolling` to `enrolled`.

## 7. Verify

- **Devices** shows the device with its serial, model, OS version and last-seen time.
- The device detail page shows the effective policy and any queued commands.
- If you assigned the policy to the group after enrollment, the device receives the
  declaration on its next check-in. Use **Sync** to wake it with APNs.

## 8. Try a command

On the device detail page:

- **Sync** asks the device to check in.
- **Lock** queues a lock command and returns a six-digit PIN.
- **Collect security info** requests FileVault and bootstrap-token state.
- **Refresh applications** replaces the installed-app inventory.

Some actions require a recent step-up confirmation. See [Security](/manage/security).

## Windows in brief

1. Enable **Windows** on the enrollment page.
2. Open the enrollment link on the Windows device and copy the tenant-scoped discovery URL.
3. Run the discovery/enrollment flow. The device receives a WSTEP identity certificate.
4. Assign a policy containing `mttx.windows.custom.<id>` OMA-URI nodes.

Windows devices poll; there is no push channel. See [Windows](/platforms/windows/).

## Android in brief

Android requires deployment-level Google credentials before it appears as available.

1. Configure the Android service account and Pub/Sub (see [Android](/platforms/android/)).
2. Connect Android Enterprise from **Settings → Management → Android**.
3. Enable **Android** on the enrollment page.
4. Scan the QR code during Android setup, or use `afw#setup` and enter the token.

Android delivery is implemented but has not been validated against real devices in this
repository. Treat it as preview.

## API alternative

Every dashboard action has an API equivalent. Create a token under **Account → API tokens**
with the `write` scope, then:

```bash
export MATTRAX_URL=https://e.mattrax.app
export MATTRAX_TOKEN=mtx_...

curl -s "$MATTRAX_URL/api/v1/tenants" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

See [REST API](/api/) and the [API reference](/api/reference/).

## Troubleshooting

| Symptom                                   | Check                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Enrollment page says Apple is unavailable | APNs certificate uploaded and valid; Apple toggle enabled                      |
| Profile downloads but does not install    | Use Safari; the signing chain must be trusted; the profile must not be expired |
| Device enrolls but no policy arrives      | Group assignment, policy configuration, APNs delivery and device status        |
| Device cap reached                        | Raise the tenant cap or the plan limit; existing devices are never deleted     |
| Windows link expired                      | Reload the enrollment page for a fresh signed tenant token                     |
| Android shows `EnterpriseNotConfigured`   | The deployment is missing `ANDROID_MANAGEMENT_SERVICE_ACCOUNT_JSON`            |

More: [Troubleshooting](/operations/troubleshooting).
