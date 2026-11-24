# Apple

Mattrax manages macOS, iOS and iPadOS with the native Apple MDM protocol: a signed
enrollment profile, a SCEP identity, APNs push, declarative device management (DDM) and
legacy `.mobileconfig` profiles where DDM does not cover the setting.

## What is supported

| Area       | Support                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------- |
| Enrollment | Profile link, optional password, QR code, device cap, asset tag                               |
| Identity   | Tenant SCEP CA, per-device certificate, renewal, revocation                                   |
| Push       | Tenant APNs certificate; direct, mTLS or relay transport                                      |
| Policy     | DDM declarations, legacy profiles, certificates, custom `.mobileconfig`                       |
| Zero-touch | ABM/ADE assignment, automatic enrollment endpoint, setup gating and Return to Service         |
| Apps       | VPP/Apps & Books device licences; manifest, store and uploaded `.pkg`/`.ipa` install commands |
| Security   | FileVault recovery-key escrow, bootstrap token, `SecurityInfo`                                |
| Users      | macOS/Shared iPad user channel, per-user push and profiles, BYOD profile                      |
| Inventory  | DDM status items and `InstalledApplicationList`                                               |
| OS updates | DDM software-update enforcement on macOS 14+/iOS 17+/iPadOS 17+; `ScheduleOSUpdate` fallback  |
| Scripts    | Assigned scripts, scheduled/manual runs, results and script-collected attributes              |
| Health     | Derived enrollment/declaration/disk/FileVault/battery health                                  |

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
fingerprint. Reclaiming a row by serial requires a pre-registration or a row that is already
unenrolled/stale. An ABM assignment alone is **not** intra-tenant proof: any enrolled device
in the tenant can assert a serial, so ABM-only reclaim is refused.

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
   device cannot register an arbitrary user. Shared iPad never authenticates and reports
   Apple's `FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF` sentinel as `UserID` for every login, so its
   channels are keyed by the Managed Apple Account identifier Apple sends as `UserShortName`.
   That account is matched to a directory person by exact email and bound as
   `managed-apple-account`. See [User-scoped policies](/reference/user-scoped-policies/).
3. Commands queued for a user (`ProfileList` from **Refresh profiles**) are delivered only
   on that user's check-in. A user result is only accepted from the same user, and it never
   writes device inventory. `CheckOut` from a user removes just that channel and cancels its
   queued commands; a device `CheckOut` removes all of them.

The device page shows each channel with its short/long name, directory identity, last
check-in, push health and reported profiles, and offers **Wake** (APNs to that user's token)
and **Refresh profiles** (`ProfileList`). See [Devices](/manage/devices#users).

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

Mattrax hosts the account-driven flow:

1. The device fetches
   `https://<managed-apple-account-domain>/.well-known/com.apple.remotemanagement` from a
   hostname the tenant has pointed at this deployment. Mattrax answers from the tenant's BYOD
   configuration, resolved by that exact hostname; there is no shared document on
   `mattrax.app`.
2. The device POSTs its signed enrollment request to the `BaseURL` from that document.
   Mattrax returns `401` with
   `WWW-Authenticate: Bearer method="apple-as-web", url="<tenant-domain>/mdm/apple/byod/authorize"`,
   which makes Apple open the tenant's browser sign-in.
3. The tenant-host authorize request bounces to the deployment `ORIGIN` before any state is
   written, so the `__Host-byod_sso_state` cookie and the registered Entra callback share a
   host. The sign-in then redirects through the tenant's existing Microsoft Entra SSO. The IdP
   identity must be the same address as the Managed Apple Account (federated accounts). The
   callback resolves the Mattrax account and the directory person, then returns `308` to
   `apple-remotemanagement-user-login://authentication-results?access-token=...`.
4. The access token is short-lived, single-use and bound to the tenant, the authenticated
   account, the Managed Apple Account and a SHA-256 of the device request body. The device
   repeats its POST with `Authorization: Bearer`; Mattrax consumes the token and returns the
   signed profile with `EnrollmentMode: BYOD`, `AssignedManagedAppleID` and no
   `AccessRights`.
5. The SCEP challenge minted for that profile carries the BYOD request id into the issued
   identity certificate. When the `EnrollmentUserID` user channel checks in, the channel is
   bound to the directory person from the sign-in (source `byod-sign-in`), so user-scoped
   policies apply without an operator doing it manually.

#### Prerequisites

1. A **Managed Apple Account** per user, created in Apple Business Manager or Apple School
   Manager. There is no API to create them.
2. Microsoft Entra single sign-on enabled for the tenant, with a verified domain and directory
   sync. The BYOD domain must be a verified Entra domain, and the Managed Apple Account must
   match the IdP address. Directory sync must already have imported that person; the callback
   refuses to bind an unknown account rather than creating an orphan member.
3. DNS control of that FQDN. The apex of the Managed Apple Account domain must answer the
   discovery document, so point it at this deployment (CNAME/ALIAS or A/AAAA) and serve it over
   HTTPS with a valid certificate. Without a verified domain the setup page refuses to enable
   the feature and says which prerequisite is missing.
4. A tenant Apple push certificate. The BYOD profile needs the tenant's APNs topic.

#### Admin setup and validation

**Settings → Enrollment → Apple account-driven enrollment** shows the verified domains, the
copyable discovery URL and the exact JSON, and a **Test discovery document** action that
fetches the public URL (following only same-domain HTTPS redirects) exactly as a device would. A
successful test of the saved domain stamps the configuration; testing a different selected
domain before saving leaves the stamp alone, and changing the domain clears it.

The feature is a **preview**. Apple's flow cannot be proven by fixtures alone: a real iPhone or
iPad with a Managed Apple Account must complete the enrollment against the tenant before it is
relied on. The "Require real-device validation" flag is on by default and withholds the
discovery document (`403`) until an administrator records that validation. Turn it off only
for a controlled test, then back on. This repository's tests cover the document, host
resolution (including a Host different from `ORIGIN`), authorize/callback cookie binding,
token single-use/expiry/tenant/body binding, challenge replay, SSO nonce/issuer/email failures,
directory-person refusal, redirect encoding, profile fields and user-channel binding. They
cannot prove Apple's client behaviour or a real custom-hostname/DNS/TLS setup.

#### Limits

- Only Microsoft Entra SSO sign-in is implemented. Google Workspace directory sync exists, but
  Google OIDC sign-in does not, so a Google-only tenant cannot complete the flow.
- Non-federated Managed Apple Accounts (where the Apple ID differs from the IdP address) are
  rejected rather than guessed. There is no mapping surface.
- The tenant must own the discovery hostname. Mattrax has no custom-hostname/whitelabel
  automation yet (#460/#526). A self-hosted deployment can use its own domain; Mattrax Cloud
  blocks enabling a tenant-hosted domain until custom hostnames exist.
- The discovery document is `Cache-Control: no-store` so disabling the feature takes effect on
  the next request; Apple fetches it once per enrollment flow.
- The access token is consumed when the profile is downloaded. Ongoing check-ins authenticate
  with the SCEP identity certificate installed from that profile, not with the bearer token,
  so a later user-channel request that still carries `Authorization` is authorised by mTLS.
- The device POST is bound to the token by a SHA-256 of its body; Apple's CMS signature on that
  first request is not verified. The control is the one-time token delivered through Apple's
  authentication session and the five-minute lifetime, not the device signature.

What a BYOD device gets after enrollment is the full user-enrollment check-in:
`Authenticate`, `TokenUpdate` (device and `EnrollmentUserID` user channel), `CheckOut`,
per-user push, per-user commands and a user row on the device page.
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

### Certificate profiles (trusted root, PKCS, imported PFX)

SCEP issues the device identity. Other certificates — Wi-Fi/VPN client identities and
S/MIME — are separate policy profiles:

| Kind                          | Delivery                                                                 |
| ----------------------------- | ------------------------------------------------------------------------ |
| `mttx.apple.certificate.<id>` | `com.apple.asset.credential.certificate` + `security.certificate` declaration (macOS 14/iOS 17+), or `com.apple.security.pkcs1` on legacy devices |
| `mttx.apple.pkcs.<id>`        | `com.apple.asset.credential.identity` + `security.identity` declaration, or `com.apple.security.pkcs12` on legacy devices |
| `mttx.apple.pfx.<id>`         | Same identity path as PKCS, without CA/template metadata                  |
| `mttx.apple.mail.<id>`        | `account.mail` declaration with S/MIME identity references, or `com.apple.mail.managed` |

The trusted root must be delivered before the issued certificate is useful. Apple has no
on-device PKCS/NDES client: a PKCS profile records how the CA issued the certificate
(CA, template, subject format, key usage, validity, renewal threshold) and delivers the
PKCS#12 that the operator's enterprise connector produced. Mattrax does not call the CA
or issue per-device certificates. Imported PFX is for an existing PKCS#12, including a
shared S/MIME decryption identity.

The PFX and password are sealed with `AUTH_SECRET` and never appear in policy JSON, API
responses, deployment snapshots or tenant exports. Legacy delivery embeds them in a
`com.apple.security.pkcs12` profile, so the `InstallProfile` command payload is sealed in
`device_command` as well and only opened when the command is handed to the device or when
installed-profile reconciliation reads command history. Upload
the leaf certificate alongside the PFX; Mattrax parses the PKCS#12, verifies the password
and requires the leaf's fingerprint to match, and metadata always comes from the PFX. The
same PKCS#12 is delivered to every device/user in scope.

User-scoped identities use the DDM user channel. Legacy delivery has no user channel, so a
user-scoped identity is not installed on a pre-DDM device. S/MIME on a DDM mail account
with password authentication needs a credentials asset Mattrax does not create; that
combination is reported as unsupported. Apple defines `account.mail` S/MIME only on iOS 17+,
so a macOS declaration omits the `SMIME` dictionary.

Identity assets are private keys, not public roots. The asset endpoint requires the signed
per-device token and re-resolves the device's effective policy before serving the JSON
credential; a tenant mTLS certificate alone is accepted only for non-secret certificate
assets. A token for an unassigned or unenrolled device, another tenant's device, or an
expired link is refused.

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
| Hosted multi-tenant Cloud    | HMAC-signed requests to `apps/services`   |

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

## Scripts

Apple devices receive assigned scripts as a `com.mattrax.script` profile that `mattraxd`
executes; the agent posts each result back with a device-scoped token. Triggers, output
caps, redaction and retention are covered in [Scripts](/manage/scripts).

A script can also populate tenant-defined device attributes. A JSON object on stdout keyed
by attribute key (or one value per line in attribute order) is validated against the
attribute's declared type and written to the device, where it feeds search, CSV export and
`${attribute.<key>}` policy variables. The device page's **Collect now** queues a manual run
for that device. This is the supported path on Apple platforms; Windows and Android do not
deliver scripts yet, so attribute collection is reported as unsupported there. See
[Custom attributes](/manage/devices/#custom-attributes) for the output contract.

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
| `schedule-os-update`    | `ScheduleOSUpdate` on macOS; iOS/iPadOS only where the DDM declaration is unavailable (below 17 or legacy delivery)        |

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
- `mttx.apple.application.<id>` installs a catalogue, manifest, store or uploaded app on
  the policy's devices. An uploaded catalogue `.pkg` targets macOS and an uploaded `.ipa`
  targets iOS/iPadOS; a package uploaded against the policy itself is `.pkg`-only.
- Apple User Enrollment (BYOD) account-driven enrollment is a preview: Mattrax hosts the
  discovery document, tenant SSO sign-in, one-time token and BYOD profile, but real-device
  validation and a tenant-controlled discovery domain are required before it is supported. See
  [User channel and BYOD](/platforms/apple/#apple-user-enrollment-byod).
- `GetToken` is not implemented: the Managed Apple Account access token needs the
  ABM-assigned server UUID, and Apple Watch pairing is not managed. The enrollment profile
  does not advertise `com.apple.mdm.token`.
- User-scoped declarations are published only to a user channel that is bound to a
  directory person; an unbound channel is told it has an empty declaration set. The device
  channel never receives user-scoped configurations. See
  [User-scoped policies](/reference/user-scoped-policies/).
- FileVault and installed-app inventory are fixture-tested but not yet validated on real
  supervised hardware. CMS-wrapped personal recovery keys need an operator decryption step.
- There is no automatic APNs renewal, CRL/OCSP endpoint or general declarative compliance
  engine. OS update compliance comes from the tenant OS policy and DDM status items; see
  [OS version management](/manage/os-versions).
- The DDM software-update declaration targets the exact minimum version. Mattrax has no
  GDMF lookup for iOS/iPadOS, so a withdrawn target can leave the declaration active
  without an update.

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
