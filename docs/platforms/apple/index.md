# Apple

Mattrax manages macOS, iOS and iPadOS with the native Apple MDM protocol: a signed
enrollment profile, a SCEP identity, APNs push, declarative device management (DDM) and
legacy `.mobileconfig` profiles where DDM does not cover the setting.

## What is supported

| Area       | Support                                                                                |
| ---------- | -------------------------------------------------------------------------------------- |
| Enrollment | Profile link, optional password, QR code, device cap, asset tag                        |
| Identity   | Tenant SCEP CA, per-device certificate, renewal, revocation                            |
| Push       | Tenant APNs certificate; direct, mTLS or relay transport                               |
| Policy     | DDM declarations, legacy profiles, certificates, custom `.mobileconfig`                |
| Zero-touch | ABM/ADE assignment, automatic enrollment endpoint, setup gating and Return to Service  |
| Apps       | VPP/Apps & Books device licences; manifest, store and uploaded `.pkg` install commands |
| Security   | FileVault recovery-key escrow, bootstrap token, `SecurityInfo`                         |
| Users      | macOS/Shared iPad user channel, per-user push and profiles, BYOD profile               |
| Inventory  | DDM status items and `InstalledApplicationList`                                        |
| Health     | Derived enrollment/declaration/disk/FileVault/battery health                           |

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

- `com.apple.security.scep` — points at
  `<origin>/mdm/apple/scep/<organizationId>`, requests an RSA 2048 key with key usage 5,
  and carries a per-enrollment, one-time challenge that expires after one hour
  (`MATTRAX_ENROLLMENT_PROFILE_TTL_SECONDS`, 60–86400 seconds). The tenant id is a path
  segment (not a query parameter) because SCEP clients append their own `?operation=...`
  to the configured URL.
- `com.apple.mdm` — points check-in and command URLs at `<origin>/mdm/apple/mdm`, requires
  signed messages, references the SCEP identity, supplies the tenant APNs topic and asks
  the device to check out when the profile is removed.

Payload UUIDs are stable, so re-downloading the profile replaces the previous one instead
of creating a duplicate.

### Profile signing

Every enrollment profile download is signed. The response is a CMS (PKCS#7)
`SignedData` message with the plist encapsulated, SHA-256, and the standard
`contentType`/`messageDigest` signed attributes. It is still served as
`application/x-apple-aspen-config` with `Cache-Control: no-store`.

Signing uses, in order:

1. An explicit deployment identity, when configured (self-hosted override):

| Variable                      | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `APPLE_PROFILE_SIGNING_CERT`  | Leaf signing certificate, PEM                      |
| `APPLE_PROFILE_SIGNING_KEY`   | Unencrypted RSA PKCS#8 private key, PEM            |
| `APPLE_PROFILE_SIGNING_CHAIN` | Optional intermediate/root certificate bundle, PEM |

2. The owning tenant's SCEP CA. It is created on first use (enrollment page download or
   the first SCEP request), so there is no unsigned window.

There is no unsigned fallback: a profile that cannot be signed fails the download with an
internal error and a log line instead of being served as a plain plist. A configured
identity that cannot be loaded fails closed the same way.

**Signed is not the same as verified.** A CMS signature proves the profile body was not
modified and identifies the signing certificate. Apple shows the profile as _verified_ only
when that certificate chains to a CA the device already trusts. A generated tenant CA is
not an Apple-trusted root, so a profile signed with it is integrity-checked but still
displayed as unverified. Import a tenant CA issued by a CA distributed to managed devices
for a verified install prompt.

### Tenant SCEP CA

Each tenant owns one active SCEP CA (`scep_ca`, unique `organization_id`). It is an
RSA-2048, **five-year** self-signed CA whose subject carries the tenant id as `OU`.

Five years is deliberate. The CA is an online issuing CA — it signs every device identity —
so it follows issuing-CA guidance (3–5 years) rather than an offline root's 10–15 years, and
it is nowhere near perpetual. The window bounds how long a leaked key can mint identities,
and the automatic rotation below keeps the shorter life invisible to a fleet.

- **Bootstrap is race-safe.** The first cold request inserts the CA with
  `INSERT IGNORE`; concurrent requests read back the same persisted row, so two keys can
  never be issued for one tenant.
- **Import.** Settings → Enrollment → SCEP identity accepts an operator-supplied CA
  (PEM certificate plus unencrypted PKCS#8 key). Mattrax validates that the certificate is
  a CA, is unexpired and permits certificate signing, and that the key matches it.
  Importing is a deliberate trust-root change: identities issued by the previous CA are
  revoked and those devices must enroll again.
- **Automatic rotation.** Scheduled maintenance starts a rotation once the CA is inside its
  rotation window (400 days before expiry, longer than the 365-day identity lifetime). It
  mints a successor CA, keeps the previous certificate as a verification anchor in
  `scep_ca_trust`, and never revokes or re-enrolls a device. The tenant id keeps the same
  SCEP URL, so nothing on a device changes.
- **Overlap.** New and renewed identities are signed by the successor CA, and `GetCACert`
  serves only the successor, so a profile downloaded after rotation trusts only the new CA.
  Existing identities stay valid — mTLS check-in and renewal verify against the current CA
  **or** a retired CA whose trust window has not closed. The retired anchor is dropped when
  its own certificate expires (the latest instant an identity it issued can be valid), and
  the row is deleted once the window passes.
- **No retired keys.** `scep_ca_trust` stores only the certificate. A retired CA can verify
  an existing identity but can never sign a new one, so a database or backup reader cannot
  mint identities from history.
- **Health is explicit.** `GET /api/v1/tenants/:tenantId/identity/scep` and
  `credential-health` expose the CA's fingerprint, expiry, days left, level, whether
  rotation is due, and every retiring CA with its trust deadline and how many active
  identities still chain to it. Two counters make a broken overlap obvious:
  `unattributedIdentities` (issued before issuing-CA attribution existed) and
  `untrustedIdentities` (its CA is no longer trusted — should stay at zero).
- **Protected change.** Manual rotation and import both require a fresh step-up
  (`scep-ca-rotate`, `scep-ca-import`). A manual rotation is staged exactly like the
  automatic one and records `mode: overlap` plus the previous and new fingerprints in the
  audit log (`scep_ca.rotated`). Automatic rotations are audited as
  `scep_ca.auto_rotated` with the reason and overlap window. Import records
  `scep_ca.imported` with the revoked identity count.
- **Failure is safe.** Rotation writes the retired anchor before replacing the current CA.
  If the replacement then fails, the original CA stays current — devices keep working — and
  the stray anchor is ignored because it matches the current fingerprint.
- **Migration.** Upgrading copies the legacy deployment-wide CA row into every tenant that
  had used it, preserving existing device identities; from then on each tenant rotates
  independently.

The CA private key is sealed with `AUTH_SECRET`. A missing or wrong secret fails closed;
Mattrax never silently generates a new CA when the stored one cannot be read.

#### Rotation runbook

1. **Automatic.** Daily maintenance rotates a CA once it is 400 days from expiry. The audit
   log records `scep_ca.auto_rotated` with both fingerprints and `overlapUntil`. Nothing
   needs to be done on devices.
2. **Manual.** **Settings → Enrollment → SCEP identity → Rotate CA** (step-up required)
   runs the same staged rotation and audits `scep_ca.rotated` with `mode: overlap`. Use it
   to rotate early; do not use **Use a custom CA** unless you intend to revoke the fleet,
   because an import is a destructive trust-root change.
3. **Verify.** `GET /api/v1/tenants/:tenantId/identity/scep` reports the new
   `fingerprintSha256`, `rotationDue: false`, and one `retiring` entry per predecessor with
   its `trustUntil`, `daysUntilUntrusted` and the number of active `identities` still using
   it. `untrustedIdentities` must stay `0`; `unattributedIdentities` only covers identities
   issued before the fingerprint column existed.
4. **Watch.** Devices renew on their own schedule; Apple clients request a renewal before
   the identity expires. The overlap is a full identity lifetime, so an online device always
   has a renewal opportunity. A device that stays offline past its identity expiry has to
   enrol again regardless of the CA.
5. **Failure.** A rotation that cannot run is audited once per day as
   `scep_ca.rotation_failed` (and logged); the usual cause is a missing or changed
   `AUTH_SECRET`. Fix it and let the next maintenance run retry. The expiry alerts still
   fire at 30/7 days as a backstop.
6. **Compromise.** If the CA key is suspected leaked, rotate immediately and revoke the
   affected identities (device revoke-identity or delete) so they cannot renew. The
   retired key is not retained, so once rotated it cannot sign new identities at all.
7. **Cleanup.** Retired anchors are deleted automatically once their certificate expires;
   no operator action is needed.

### Enrollment link

Open **Devices → Enrollment**:

- **Apple** toggle (default on).
- **Password** (optional). The user must enter it before the profile is available.
- **Asset tag** (optional). Adds an asset-tag field to the enrollment page.
- **Device cap** (default 100, `0` means unlimited). The plan limit is enforced
  independently; whichever is lower wins.

`POST /api/v1/tenants/:tenantId/enrollment/reset` replaces the enrollment id and
invalidates old links and challenges. Changing the enrollment settings also drops
every unused challenge, so a profile issued before the change cannot be redeemed.
Existing devices stay enrolled.

The profile link carries a one-time bearer challenge. It defaults to a one-hour
lifetime and is deliberately short: the profile URL is a credential until its
first use, and resetting or reconfiguring the enrollment invalidates it.

### Check-in lifecycle

| Message                 | What Mattrax does                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Authenticate`          | Resolves the tenant from the SCEP certificate OU, creates or finds the device, applies a matching pre-registration, binds the certificate serial. It also returns a best-effort inline ADE profile for an ABM-assigned serial, though Apple's documented protocol ignores the response body |
| `UserAuthenticate`      | Validates the user against the authenticated device and answers with an empty `DigestChallenge` (no password); `410` for a user it will not manage                                                                                                                                          |
| `TokenUpdate`           | Stores push token, push magic and topic; moves `enrolling → enrolled`; writes `device.enrolled`. A user channel is stored per user                                                                                                                                                          |
| `CheckOut`              | Marks the device `unenrolled`, clears push credentials, revokes device certificates; a user channel removes only that user                                                                                                                                                                  |
| `DeclarativeManagement` | Serves DDM tokens, declaration items, declarations and status. A user channel gets an empty declaration set                                                                                                                                                                                 |
| `GetToken`              | Rejected with `400`: the Managed Apple Account and watch-pairing token services are not implemented, and the profile does not advertise `com.apple.mdm.token`                                                                                                                               |
| Command result          | Updates the command row, parses `SecurityInfo` and `InstalledApplicationList`; a user result only touches that user's rows                                                                                                                                                                  |

A new identity cannot take over an already-enrolled UDID with a different certificate
fingerprint. Reclaiming a row by serial also requires an ABM assignment, a pre-registration,
or a stale/unenrolled row; a self-asserted serial alone is refused.

### User channel

The enrollment profile advertises `com.apple.mdm.per-user-connections`, so macOS and Shared
iPad open a second, per-user channel alongside the device channel:

1. When a local user logs in, macOS sends `UserAuthenticate` with Apple's opaque `UserID`.
   Mattrax verifies the request against the device certificate that is already bound to the
   tenant and replies with an empty `DigestChallenge`, which tells the client that no
   `AuthToken` (and therefore no password) is required. A device that is unknown, unenrolled,
   or owned by another tenant gets `410` instead, which stops management for that user.
   Mattrax never requests a password: a `DigestResponse` is rejected with an empty
   `AuthToken`, as Apple specifies for an invalid digest.
2. The user channel sends its own `TokenUpdate` with `UserID`, `UserShortName` and
   `UserLongName`. Mattrax only accepts it after the `UserAuthenticate` binding, so a managed
   device cannot register an arbitrary user. Shared iPad uses Apple's
   `FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF` sentinel and is exempt because it never
   authenticates.
3. Commands queued for a user (`ProfileList` from **Refresh profiles**) are delivered only
   on that user's check-in. A user result is only accepted from the same user, and it never
   writes device inventory. `CheckOut` from a user removes just that channel and cancels its
   queued commands; a device `CheckOut` removes all of them.

The device page shows each channel with its short/long name, binding, last check-in, push
health and reported profiles, and offers **Wake** (APNs to that user's token) and
**Refresh profiles** (`ProfileList`). See [Devices](/manage/devices#users).

### Apple User Enrollment (BYOD)

Apple's Bring Your Own Device enrollment is a different enrollment type, not the macOS
per-user channel above:

- The device reports a per-enrollment `EnrollmentID` instead of a `UDID`, and the user
  channel identifies itself with `EnrollmentUserID`. Both are accepted and stored.
- The enrollment profile must carry `EnrollmentMode: BYOD` and `AssignedManagedAppleID`, and
  must not carry `AccessRights` (Apple cancels the enrollment).
  `buildAppleEnrollmentProfile({ userEnrollment })` produces such a profile.
- Apple delivers that profile through **account-driven enrollment**: the user signs in with a
  Managed Apple Account, the device fetches
  `https://<their-domain>/.well-known/com.apple.remotemanagement` (which must answer
  `{"Servers":[{"Version":"mdm-byod","BaseURL":"..."}]}`), completes the web sign-in, and only
  then receives the profile.

Mattrax does not host that service-discovery or sign-in flow. It requires:

1. A **Managed Apple Account** per user, created in Apple Business Manager or Apple School
   Manager. There is no API to create them.
2. A `.well-known/com.apple.remotemanagement` document on the domain of those accounts. In a
   hosted deployment that is the tenant's own domain, not Mattrax's.
3. A browser sign-in page that proves the user's identity, followed by a
   `apple-remotemanagement-user-login://authentication-results?access-token=...` redirect.
   Mattrax has no endpoint for this, so account-driven enrollment cannot complete against
   Mattrax today.

What a BYOD device that is enrolled by another path _does_ get from Mattrax is the full
user-enrollment check-in: `Authenticate`, `TokenUpdate` (device and `EnrollmentUserID` user
channel), `CheckOut`, per-user push, per-user commands and a user row on the device page.
`GetToken` (`com.apple.maid` access management and Apple Watch pairing) is not implemented,
so the enrollment profile no longer advertises `com.apple.mdm.token`; Apple requires a `400`
for a token service the server does not support.

### SCEP

- One CA per tenant, RSA-2048, five-year validity, served only from
  `/mdm/apple/scep/<organizationId>`. The old deployment-wide URL returns `410`; install a
  fresh enrollment profile after upgrading.
- Enrollment challenges are one-time: the digest is stored and consumed before the
  certificate is issued, so a captured PKCSReq cannot be replayed. A failed issuance
  burns the challenge and the device must fetch a fresh profile. The URL tenant must match
  the tenant that minted the challenge.
- Device certificates are valid for 365 days (clamped to the issuing CA's expiry) with the
  client-auth EKU, and their subject `OU` is pinned to the tenant.
- Renewal authenticates with the certificate being renewed and stays bound to the same
  device. During a CA rotation the renewal may be signed by a retired CA that is still
  inside its overlap window; the renewed identity is issued by the current CA and records
  the issuing CA's SHA-256 fingerprint on the row. Once the overlap closes, renewal of an
  identity from the retired CA is refused in-protocol (failure CertRep), so the bound is
  observable rather than silent.
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

Renew it before it expires:

1. Sign in at <https://identity.apple.com/pushcert/> with the **same Apple Account** that
   created the certificate.
2. Choose **Renew** for this MDM push certificate — not Create. Renewing in place keeps the
   topic and every device's push token; creating a new certificate forces every device to
   enrol again.
3. Download the renewed `.pem` and upload it under **Settings → Management → Apple push**.

There is no automatic renewal: Apple requires the account owner to renew, so the process
cannot run from the server. Instead the credential-health endpoint (and the APNs settings
panel) reports the expiry, days left and level, and maintenance emails the tenant's
owner/admins at 30 days, 7 days and on expiry with the portal link and the Renew-not-Create
step. Health also compares the stored private key with the certificate and the certificate
topic with the tenant's stored topic, and escalates a mismatch to `critical`: a certificate
whose key does not match cannot sign a push even if its expiry date is fine.

## Remote actions

| Action                  | Behaviour                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `sync`                  | APNs wake-up; the device checks in                                                                                         |
| `lock`                  | Locks the device and returns a six-digit PIN                                                                               |
| `wipe`                  | Erases the device with a PIN and default obliteration behaviour                                                            |
| `return-to-service`     | Erases and re-enrols an iPhone/iPad/Apple TV/Vision Pro (iOS 17+/tvOS 18+/visionOS 26+, Wi-Fi profile required; not macOS) |
| `restart` / `shutdown`  | Queues the matching Apple command                                                                                          |
| `clear-passcode`        | Uses the stored unlock token                                                                                               |
| `install-app`           | Requires `manifestUrl` or `iTunesStoreId`                                                                                  |
| `collect-security-info` | Requests FileVault/bootstrap-token state                                                                                   |
| `refresh-applications`  | Replaces installed-application inventory                                                                                   |

Every action except `sync`, `collect-security-info` and `refresh-applications` requires a
step-up confirmation in the browser. See [Security](/manage/security).

Commands are delivered on the next check-in and each has a deadline (15 minutes for a lock,
30 minutes for a restart, 24 hours for an install, 7 days for an inventory refresh or erase).
A command past its deadline is expired, never delivered and never retried. Identical
requests are de-duplicated while a command is queued or in flight, a wipe supersedes other
pending actions, and a reported inventory reconciles installs that already landed. See
[Devices](/manage/devices#actions) for the full lifecycle.

## Limitations

- ADE enrollment is automatic once the tenant's ADE profile points at
  `/api/v1/abm/ade/enroll` and sets `await_device_configured`. Apple's Business API does not
  expose cloud-configuration registration, so that URL is registered by the ABM
  administrator (Apple Business Manager / Apple Configurator) once per tenant. See
  [ABM](/platforms/apple/abm). The inline `EnrollmentProfile` in the `Authenticate`
  response is unverified: Apple's protocol reference says the response body is ignored, and
  it is not a substitute for registering the ADE profile `url`.
- `mttx.apple.device` currently exposes only the camera restriction. Use a custom
  `.mobileconfig` or a DDM declaration for everything else.
- `mttx.apple.application.<id>` installs a catalogue, manifest, store or uploaded `.pkg`
  app on the policy's devices; uploaded packages install on macOS only.
- Apple User Enrollment (BYOD) check-in is supported, but account-driven enrollment is not:
  it needs a Managed Apple Account, a `.well-known/com.apple.remotemanagement` document on the
  tenant's own domain, and a browser sign-in flow that Mattrax does not host. See
  [User channel and BYOD](/platforms/apple/#apple-user-enrollment-byod).
- `GetToken` is not implemented: the Managed Apple Account access token needs the
  ABM-assigned server UUID, and Apple Watch pairing is not managed. The enrollment profile
  does not advertise `com.apple.mdm.token`.
- There are no user-scoped declarations. A user channel is told it has an empty declaration
  set, so per-user payload isolation is still a device-channel concern.
- FileVault and installed-app inventory are fixture-tested but not yet validated on real
  supervised hardware. CMS-wrapped personal recovery keys need an operator decryption step.
- There is no automatic APNs renewal, CRL/OCSP endpoint or compliance engine.

## API endpoints

| Method      | Path                                                               |
| ----------- | ------------------------------------------------------------------ |
| `GET`       | `/api/v1/tenants/:tenantId/apns`                                   |
| `GET`       | `/api/v1/tenants/:tenantId/apns/csr`                               |
| `POST`      | `/api/v1/tenants/:tenantId/apns`                                   |
| `GET/PATCH` | `/api/v1/tenants/:tenantId/enrollment`                             |
| `POST`      | `/api/v1/tenants/:tenantId/enrollment/reset`                       |
| `GET`       | `/api/v1/tenants/:tenantId/enrollment/attempts`                    |
| `GET`       | `/api/v1/tenants/:tenantId/identity/scep`                          |
| `PUT`       | `/api/v1/tenants/:tenantId/identity/scep`                          |
| `POST`      | `/api/v1/tenants/:tenantId/identity/scep/rotate`                   |
| `POST`      | `/api/v1/tenants/:tenantId/devices/:id/action`                     |
| `POST`      | `/api/v1/tenants/:tenantId/devices/:id/unenroll`                   |
| `POST`      | `/api/v1/tenants/:tenantId/devices/:id/revoke-identity`            |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/recovery-key`               |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/applications`               |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/declarations`               |
| `GET`       | `/api/v1/tenants/:tenantId/devices/:id/apple-users`                |
| `POST`      | `/api/v1/tenants/:tenantId/devices/:id/apple-users/:userId/action` |
| `GET`       | `/api/v1/tenants/:tenantId/push-health`                            |
| `GET`       | `/api/v1/tenants/:tenantId/credential-health`                      |

## Next

- [Apple Business Manager](/platforms/apple/abm)
- [Apps & Books](/platforms/apple/vpp)
- [DDM and profiles](/platforms/apple/ddm)
- [FileVault, inventory and health](/platforms/apple/security)
