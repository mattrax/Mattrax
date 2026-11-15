# Apple

Mattrax manages macOS, iOS and iPadOS with the native Apple MDM protocol: a signed
enrollment profile, a SCEP identity, APNs push, declarative device management (DDM) and
legacy `.mobileconfig` profiles where DDM does not cover the setting.

## What is supported

| Area       | Support                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| Enrollment | Profile link, optional password, QR code, device cap, asset tag          |
| Identity   | Tenant SCEP CA, per-device certificate, renewal, revocation              |
| Push       | Tenant APNs certificate; direct, mTLS or relay transport                 |
| Policy     | DDM declarations, legacy profiles, certificates, custom `.mobileconfig`  |
| Zero-touch | ABM/ADE device assignment and signed ADE profile URL                     |
| Apps       | VPP/Apps & Books device licences; manifest or App Store install commands |
| Security   | FileVault recovery-key escrow, bootstrap token, `SecurityInfo`           |
| Inventory  | DDM status items and `InstalledApplicationList`                          |
| Health     | Derived enrollment/declaration/disk/FileVault/battery health             |

## Prerequisites

- A trusted HTTPS origin. Apple requires TLS for enrollment and MDM.
- An APNs MDM push certificate for the tenant. See [APNs](/platforms/apple/#apns).
- For zero-touch: an Apple Business Manager account with the devices assigned to Mattrax.
- For apps: an Apps & Books location token (VPP).

## Setup order

1. Configure [APNs](/platforms/apple/#apns) so the tenant can push.
2. Create the enrollment link and install the profile on a test device.
3. Create groups and a baseline [policy](/platforms/apple/ddm).
4. Add [ABM](/platforms/apple/abm) for zero-touch and [VPP](/platforms/apple/vpp) for apps.
5. Turn on [FileVault escrow and inventory](/platforms/apple/security) for production.

## Enrollment

### The profile

The enrollment profile contains two payloads:

- `com.apple.security.scep` — points at `<origin>/mdm/apple/scep`, requests an RSA 2048
  key with key usage 5, and carries a per-enrollment, one-time challenge that expires
  after seven days.
- `com.apple.mdm` — points check-in and command URLs at `<origin>/mdm/apple/mdm`, requires
  signed messages, references the SCEP identity, supplies the tenant APNs topic and asks
  the device to check out when the profile is removed.

Payload UUIDs are stable, so re-downloading the profile replaces the previous one instead
of creating a duplicate.

### Profile signing

Profile downloads are CMS (PKCS#7) `SignedData` messages with the plist encapsulated,
SHA-256, and the standard `contentType`/`messageDigest` signed attributes. The response is
still served as `application/x-apple-aspen-config` with `Cache-Control: no-store`.

A dedicated deployment signing identity is configured with:

| Variable                      | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `APPLE_PROFILE_SIGNING_CERT`  | Leaf signing certificate, PEM                      |
| `APPLE_PROFILE_SIGNING_KEY`   | Unencrypted RSA PKCS#8 private key, PEM            |
| `APPLE_PROFILE_SIGNING_CHAIN` | Optional intermediate/root certificate bundle, PEM |

When no dedicated identity is configured, Mattrax signs with the deployment-global SCEP CA
(`scep_ca` id 1) if it already exists. The download handler never generates a CA; before
the CA has bootstrapped the plist is served unsigned and a warning is logged. A configured
identity that cannot be loaded or used fails the download with an internal error rather
than falling back to an unsigned profile.

**Signed is not the same as verified.** A CMS signature proves the profile body was not
modified and identifies the signing certificate. Apple shows the profile as _verified_ only
when that certificate chains to a CA the device already trusts. The SCEP CA fallback is
not an Apple-trusted root, so a profile signed with it is integrity-checked but still
displayed as unverified. Use a certificate issued by a CA distributed to managed devices
for a verified install prompt.

### Enrollment link

Open **Devices → Enrollment**:

- **Apple** toggle (default on).
- **Password** (optional). The user must enter it before the profile is available.
- **Asset tag** (optional). Adds an asset-tag field to the enrollment page.
- **Device cap** (default 100, `0` means unlimited). The plan limit is enforced
  independently; whichever is lower wins.

`POST /api/v1/tenants/:tenantId/enrollment/reset` replaces the enrollment id and
invalidates old links and challenges. Existing devices stay enrolled.

### Check-in lifecycle

| Message                 | What Mattrax does                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Authenticate`          | Resolves the tenant from the SCEP certificate OU, creates or finds the device, applies a matching pre-registration, binds the certificate serial |
| `TokenUpdate`           | Stores push token, push magic and topic; moves `enrolling → enrolled`; writes `device.enrolled`                                                  |
| `CheckOut`              | Marks the device `unenrolled`, clears push credentials, revokes device certificates                                                              |
| `DeclarativeManagement` | Serves DDM tokens, declaration items, declarations and status                                                                                    |
| Command result          | Updates the command row, parses `SecurityInfo` and `InstalledApplicationList`                                                                    |

A new identity cannot take over an already-enrolled UDID with a different certificate
fingerprint.

### SCEP

- One global SCEP CA per deployment, RSA-2048, ten-year validity.
- Enrollment challenges are one-time: the digest is stored and consumed before the
  certificate is issued, so a captured PKCSReq cannot be replayed. A failed issuance
  burns the challenge and the device must fetch a fresh profile.
- Device certificates are valid for 365 days with the client-auth EKU.
- The CA private key is sealed with `AUTH_SECRET`. A missing or wrong secret fails closed;
  Mattrax never silently generates a new CA.
- Renewal authenticates with a currently valid certificate issued by the CA and stays bound
  to the same device.
- Unenrollment, device deletion and the revoke-identity action revoke certificates.
  Renewal rejects revoked identities.
- There is no published CRL or OCSP endpoint. Revocation is enforced at renewal and on
  mTLS check-in.

## APNs

Apple push is per tenant.

1. **Settings → Management → Apple push → Download CSR**.
2. Sign the CSR at Apple's push certificate portal.
3. Upload the `.pem` and the Apple ID email.

Mattrax validates the certificate, checks that the UID topic matches
`com.apple.mgmt.*` and, when a pending key exists, that the certificate matches the key.
The private key is sealed with `AUTH_SECRET`.

Push transports:

| Deployment                   | Transport                                 |
| ---------------------------- | ----------------------------------------- |
| Single-tenant Node / gateway | Direct HTTP/2 with the tenant certificate |
| Single-tenant Worker         | Workers mTLS binding                      |
| Hosted multi-tenant Cloud    | HMAC-signed requests to `apps/apns-relay` |

Without a push transport, devices still converge by polling at their normal check-in
interval. Delivery outcomes are recorded per device and exposed through
`GET /api/v1/tenants/:tenantId/push-health`.

Renewal is manual: download a new CSR (the key is reused), sign it, upload the new
certificate. Existing devices do not need to re-enroll.

## Remote actions

| Action                  | Behaviour                                                       |
| ----------------------- | --------------------------------------------------------------- |
| `sync`                  | APNs wake-up; the device checks in                              |
| `lock`                  | Locks the device and returns a six-digit PIN                    |
| `wipe`                  | Erases the device with a PIN and default obliteration behaviour |
| `restart` / `shutdown`  | Queues the matching Apple command                               |
| `clear-passcode`        | Uses the stored unlock token                                    |
| `install-app`           | Requires `manifestUrl` or `iTunesStoreId`                       |
| `collect-security-info` | Requests FileVault/bootstrap-token state                        |
| `refresh-applications`  | Replaces installed-application inventory                        |

Every action except `sync`, `collect-security-info` and `refresh-applications` requires a
step-up confirmation in the browser. See [Security](/manage/security).

## Limitations

- ADE zero-touch is incomplete: the `Authenticate` response does not yet include the ADE
  profile, so operators must install the signed profile URL. See [ABM](/platforms/apple/abm).
- `mttx.apple.device` currently exposes only the camera restriction. Use a custom
  `.mobileconfig` or a DDM declaration for everything else.
- `mttx.apple.application.<id>` is rejected. Use the application catalogue or a direct
  install command.
- There is no per-user enrollment (`UserAuthenticate` and `GetToken` are not supported).
- FileVault and installed-app inventory are fixture-tested but not yet validated on real
  supervised hardware. CMS-wrapped personal recovery keys need an operator decryption step.
- There is no automatic APNs renewal, CRL/OCSP endpoint or compliance engine.

## API endpoints

| Method      | Path                                                    |
| ----------- | ------------------------------------------------------- |
| `GET`       | `/api/v1/tenants/:tenantId/apns`                        |
| `GET`       | `/api/v1/tenants/:tenantId/apns/csr`                    |
| `POST`      | `/api/v1/tenants/:tenantId/apns`                        |
| `GET/PATCH` | `/api/v1/tenants/:tenantId/enrollment`                  |
| `POST`      | `/api/v1/tenants/:tenantId/enrollment/reset`            |
| `GET`       | `/api/v1/tenants/:tenantId/enrollment/attempts`         |
| `POST`      | `/api/v1/tenants/:tenantId/devices/:id/action`          |
| `POST`      | `/api/v1/tenants/:tenantId/devices/:id/unenroll`        |
| `POST`      | `/api/v1/tenants/:tenantId/devices/:id/revoke-identity` |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/recovery-key`    |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/applications`    |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/declarations`    |
| `GET`       | `/api/v1/tenants/:tenantId/push-health`                 |
| `GET`       | `/api/v1/tenants/:tenantId/credential-health`           |

## Next

- [Apple Business Manager](/platforms/apple/abm)
- [Apps & Books](/platforms/apple/vpp)
- [DDM and profiles](/platforms/apple/ddm)
- [FileVault, inventory and health](/platforms/apple/security)
