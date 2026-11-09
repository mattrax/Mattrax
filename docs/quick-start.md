# Quick start

This guide enrolls your first device in a Mattrax Cloud tenant and applies a policy. If you
have not deployed Mattrax yet, start with [Self-hosting](./self-hosting).

## Before you begin

- A running Mattrax deployment reachable over **HTTPS**. Apple devices refuse MDM
  enrollment over plain HTTP.
- An account and a tenant. On Cloud, create an account at `/register`; the account that
  creates a tenant becomes its `owner`.
- For Apple devices, an APNs push certificate for the tenant. Without APNs, Apple
  enrollment is blocked.

::: tip Self-hosted gateway?
Whitelabel deployments do not have the Enterprise dashboard or enrollment page described
here. You are responsible for your own product UI and for returning an enrollment profile
from your management backend. See [Whitelabel](./whitelabel/).
:::

## 1. Configure APNs (Apple only)

Mattrax generates the private key and CSR; you never export the key from the server.

1. In the dashboard open **Tenant settings → Management → Apple push notifications**.
2. Select **Download CSR**. Mattrax downloads `mattrax-push-csr.plist`, containing the
   `PushCertRequestCSR`, certificate chain, and vendor signature when a vendor certificate
   is configured.
3. Sign in to [identity.apple.com/pushcert](https://identity.apple.com/pushcert), upload
   the CSR plist, and download the signed certificate.
4. Back in Mattrax, enter the Apple ID used for the certificate and upload the `.pem`
   certificate.

Mattrax reads the MDM topic from the certificate and stores the private key sealed with
`AUTH_SECRET`. Keep `AUTH_SECRET` backed up: losing it makes existing APNs keys
undecryptable.

::: warning Push delivery in Cloud
Apple MDM push certificates are per tenant. A single Cloudflare Worker cannot attach a
different client certificate per request. Hosted multi-tenant Cloud therefore needs an
APNs relay (`RelayPushTransport`, HMAC-signed) while self-hosted deployments can use
direct delivery (`NodePushTransport`). Without a configured transport, devices are
not woken by push and instead apply changes on their next poll. See
[APNs and push](./self-hosting#apns-and-push).
:::

## 2. Get the enrollment link

Open **Tenant settings → Enrollment**. The link has the form:

```text
https://your-mattrax-domain/enroll/<enrollment-id>
```

If an enrollment password is configured, share it separately. The password is not part
of the default link.

| Setting            | Effect                                                       |
| ------------------ | ------------------------------------------------------------ |
| Enrollment password | Required before the platform options are returned.           |
| Maximum devices     | Caps enrollments for this tenant. Set a high value for a large fleet. |
| Apple / Windows     | Enables the platform tab. Windows remains preview-only.      |
| Ask for asset tag   | Returns an asset-tag flag in the enrollment response.        |

Resetting the enrollment link invalidates the old id. Existing devices stay enrolled.

## 3. Enroll an Apple device

1. Open the enrollment link in **Safari** on the device. Other browsers may not handle
   `.mobileconfig` downloads.
2. Download the enrollment profile.
3. Install it:
   - **macOS:** System Settings → Privacy & Security → Profiles → install the Mattrax
     profile.
   - **iOS / iPadOS:** Settings → General → VPN & Device Management → install the Mattrax
     profile.
4. Approve the prompts. The device requests an identity certificate over SCEP, then
   checks in with `/mdm/apple/mdm`.
5. The device appears under **Devices** once the MDM check-in completes.

The profile contains a SCEP payload and an MDM payload. The SCEP identity certificate is
used for MDM authentication; the MDM payload supplies the APNs topic and check-in URL.

::: info Declarative management
Apple policies are delivered through declarative device management (DDM) declarations.
A device learns about changed declarations on its next check-in. APNs only makes that
check-in happen sooner.
:::

## 4. Windows (preview)

`packages/dm-windows` implements Windows discovery, WSTEP certificate issuance, SyncML
check-in, and the corresponding management webhook operations. The enrollment page
currently reports Windows as available, but the Windows HTTP routes are not mounted in
`apps/api` or `apps/mttx` in this tree. Treat Windows enrollment as **not end-to-end
functional** until those routes are mounted and the management backend implements the
Windows webhook methods.

Intended WSTEP flow once mounted:

1. Windows discovers the enrollment service and receives an auth policy.
2. The device requests the enrollment policy and submits a PKCS#10 CSR.
3. The backend signs the identity certificate and returns an enrollment result.
4. The gateway builds the WAP provisioning document and the device checks in over SyncML.

Do not promise Windows policy management yet. The webhook contract has Windows methods,
but the Cloud management backend currently answers `ManagementNotSupported`.

## 5. Android

Android enrollment is **not available**. There is no Android Management API integration
or Android device backend in this repository, and the Cloud management backend does not
implement Android management. The enrollment toggle does not create a working flow.

## 6. Organise devices and apply policy

### Groups

1. Open **Groups → Create group**.
2. Add devices or create more groups under the tenant.
3. Policies are assigned to groups, not directly to devices. A device receives the union
   of the policies from every group it belongs to.

### Policies

1. Open **Policies → Create policy**.
2. Open the policy editor and configure what is available:
   - **Security** — upload a PEM certificate.
   - **Applications** — upload an installer. The file is stored, but app delivery is not
     connected to MDM yet.
   - **Device** — basic restrictions.
   - **Custom profile** — upload a `.mobileconfig`.
   - **Advanced JSON** — edit the raw configuration map.
3. Save, then assign the policy to a group from the group page or via the policy's group
   membership.
4. Run **Sync** on the policy or group. Sync sends an APNs push to affected Apple devices
   when a transport is configured; otherwise devices apply changes at their next
   check-in.

::: warning Device actions
Sync and unenroll are implemented (they push Apple devices and update the device status).
Remote lock, wipe, restart and app installation are not exposed yet.
:::

## Troubleshooting

### Enrollment link does not load

- Confirm the deployment is healthy: Cloud returns `ok` from `GET /api/health`; the
  self-hosted gateway returns `ok` from `GET /health`.
- Confirm DNS points at the deployment and TLS is valid.
- On Cloud, check the web and API Workers are deployed from the same revision.
- On the self-hosted gateway, check `--origin` matches the public URL.

### Apple profile will not download

- Use Safari; Chrome and Firefox may download the file without offering installation.
- Confirm the certificate chain is trusted. A self-signed certificate will fail on iOS.
- Confirm APNs is configured for the tenant. The enrollment response returns an explicit
  `Apple management is not configured` error when the certificate topic is missing.
- Make sure the tenant's Apple enrollment toggle is on and the device limit has not been
  reached.

### Device enrolls but receives no policy

- Check the device status is `enrolled`, not `enrolling`.
- Confirm the device belongs to a group and that group has a policy assigned.
- Confirm the policy has at least one configuration.
- Check APNs. If push is unavailable the device still polls, so wait for the next
  check-in or force one by reinstalling the profile.
- Self-hosted gateway: check the management backend logs for `/webhook/apple/*` requests
  and typed errors such as `UnknownDevice` or `ManagementNotSupported`.

### Enrollment is disabled

The enrollment page reports that no platforms are enabled. In **Tenant settings →
Enrollment**, enable at least one platform and save. Enabling Apple without APNs produces
an APNs setup warning rather than a working Apple flow.

### Local logs

```bash
# Cloud dashboard + API (local dev)
pnpm web dev

# API Worker only
pnpm api dev

# Self-hosted whitelabel gateway
pnpm mserver dev serve --webhook-url http://localhost:8787
```
