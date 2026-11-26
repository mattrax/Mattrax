# Move a deployment (Cloud ↔ self-hosted)

This is the Mattrax-to-Mattrax path. It moves a tenant between two Mattrax
deployments — hosted Cloud to a self-hosted container, self-hosted to Cloud, or
one self-hosted installation to another — without re-enrolling devices that are
already managed.

For migrating from Jamf, Intune or another vendor, see
[Migration](/migration/). That is a re-enrollment project; this page is not.

## The one rule that decides whether it is zero-touch

**Devices check in to the hostname inside their installed profile.** An Apple
device keeps posting to the `ServerURL` from its enrollment profile and renews
its identity against the SCEP URL in the same profile. Windows and Android have
their own enrollment artefacts that embed the same origin.

So:

| Move                                          | Result                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Same hostname, DNS now points at the target   | Zero-touch. Set `ORIGIN` to that hostname on the target and import.                      |
| Different hostname                            | Every enrolled device needs a new profile or must re-enroll. The archive still moves its identity, so the new deployment can accept the device immediately. |

A custom domain pointed at Cloud can be repointed at a self-hosted container and
keep its name. A tenant on `e.mattrax.app` cannot: moving to a self-hosted
deployment changes the hostname, so plan a profile refresh (or re-enrollment)
for the fleet. Run the preflight report to see the exact counts before deciding.

## What the archive contains

The archive is a single encrypted JSON file (`.cutover.json`). It is not a
backup: it carries private keys, and it is always encrypted.

| Section         | Contents                                                                                       | Toggle   |
| --------------- | ---------------------------------------------------------------------------------------------- | -------- |
| Configuration   | Branding, groups, policies and configurations, applications, assignments, enrollment, pre-registrations, directory users | always   |
| Members         | Member emails, roles and pending invitations (never their bearer tokens)                       | optional |
| Devices         | Device rows, Apple push token/push magic/topic/unlock and bootstrap tokens, Windows device identity, group memberships, direct assignments, escrowed per-device secrets, the FileVault escrow key | optional |
| SCEP CA         | Current CA certificate **and private key**, retired trust anchors, issued-certificate metadata  | optional |
| Audit           | Up to 10,000 most recent audit entries                                                         | optional |

Deliberately **not** in the archive, because they are bound to the deployment
that issued them:

- APNs certificate and private key
- Apple Business Manager server token
- Apps and Books (VPP) token
- Android Enterprise binding and Pub/Sub subscription
- SCIM token (only a hash is stored)
- Uploaded application binaries (R2 objects)
- Webhook signing secrets

Every one of these is reported in the import summary as **needs re-issuance**
instead of being dropped silently.

## Archive format

```json
{
  "format": "mattrax.cutover",
  "version": 1,
  "kdf": { "name": "PBKDF2-SHA256", "iterations": 600000, "salt": "<base64>" },
  "cipher": { "name": "AES-256-GCM", "iv": "<base64>" },
  "manifest": {
    "version": 1,
    "createdAt": "...",
    "source": { "tenantId": "...", "slug": "...", "name": "...", "origin": "https://...", "deploymentId": "dp_..." },
    "sections": ["configuration", "members", "devices", "scepCa"],
    "counts": { "devices": 0, "certificates": 0, "...": 0 },
    "payloadSha256": "<hex>",
    "ciphertextSha256": "<hex>"
  },
  "payload": "<base64 AES-GCM ciphertext>"
}
```

- The manifest is plaintext so an operator can see what a file is before
  supplying a passphrase. It never contains a key, a certificate body, a token
  or a passphrase.
- The passphrase is stretched with PBKDF2-SHA256 (600,000 iterations, 16-byte
  random salt) into an AES-256-GCM key. AES-GCM authenticates the payload.
- `ciphertextSha256` is checked before the key is derived, so a corrupted or
  edited file is reported as tampering rather than as a wrong passphrase.
  `payloadSha256` is checked after decryption.
- Imports bound the file to 32 MB (24 MB decrypted), 10,000 devices, 10,000
  members and 10,000 audit entries. Larger fleets need a database dump.
- `deploymentId` is derived from the deployment's canonical origin (`dp_…`),
  so a same-hostname move keeps the same identity and a different hostname
  produces a different one. Importing an archive from a different deployment
  requires an explicit acknowledgement. It is deliberately **not** derived from
  `AUTH_SECRET`: the manifest is plaintext, and a hash of the master secret
  would be an offline verifier for it.

## Sequence

### 1. Preflight

Settings → Migration → Export / import → **Export / move deployment** → **Run
preflight**, with the origin you intend to serve. It reports:

- whether the hostname changes (a **blocker** for a zero-touch move)
- how many installed Apple profiles point at the old SCEP endpoint
- the APNs topic and the integrations that need re-authorisation
- WebAuthn relying-party impact (existing passkeys stop working on a new host)
- pending invitation and enrollment links that embed the old origin

Resolve every blocker before continuing.

### 2. Freeze writes on the source

Stop configuration changes and scheduled jobs. Devices may keep checking in;
what must stop is new enrollments and writes, so the archive is a consistent
snapshot. Keep the source online: it is the rollback and, for a hostname change,
the only channel that can still reach devices.

### 3. Export

Choose the sections, set a passphrase of at least 12 characters (use a password
manager; 20+ random characters), and download the archive. This requires tenant
export permission plus a fresh step-up (TOTP or passkey). Store the file like a
backup, but treat it as a private key: anyone with the file and the passphrase
can impersonate every device in the tenant.

### 4. Switch DNS and ORIGIN

Point the hostname at the target deployment and set `ORIGIN` on the target to
the same value. If you are changing the hostname, this step is the point of no
return for zero-touch: devices still call the old origin until they receive a
new profile.

### 5. Import

On the target: Settings → Migration → Export / import → **Import archive**. Add
the file and passphrase, then **Preview archive**. Review:

- counts and source origin/deployment
- conflicts
- needs-reissue items

Then acknowledge cross-deployment (if prompted), choose whether to replace an
existing tenant's configuration, resolve the SCEP CA and escrow-key choices, and
type the source tenant slug. The import is one transaction.

Import rules:

- **Tenant slug** is made unique automatically (`acme`, then `acme-2`).
- **Device serials** that already exist under a different identity are skipped
  only when you choose "skip"; otherwise the import refuses.
- **SCEP CA**: if the target already has a CA, the default keeps the target CA
  signing and adds the source CA as a trust anchor. Imported identities keep
  checking in and renewing (renewals are signed by the target CA). Choosing
  "make the source CA the signing CA" retires the target CA as a trust anchor
  instead.
- **FileVault escrow key**: two keys cannot coexist. Without replacing the
  target key, recovery keys collected on the source cannot be revealed on the
  target, and escrow policies that embed the source certificate are rejected.
- **Members** are matched by account email. An account that does not exist on
  the target becomes a pending invitation with no token; resend it from Members.
  Owner membership is never granted while importing into an existing tenant.
- **Custom roles** are not exported; a member on one is imported with a
  built-in fallback and listed for role review.

The response lists imported, skipped and **needs re-issuance**. Nothing is
silently discarded.

### 6. Verify

- Watch **Devices** for check-ins from both platforms.
- Confirm the audit stream contains a `tenant.cutover_imported` entry and live
  device activity.
- Upload the APNs certificate with the **same topic** (a renewal of the existing
  certificate). Stored push tokens remain valid; a different topic invalidates
  them.
- Re-authorise ABM, VPP, Android Enterprise and SCIM.
- Re-save any FileVault escrow policy whose embedded certificate does not match
  the target escrow key.
- Check identity renewal for one device before trusting the whole fleet.

### 7. Unfreeze and retire the source

Resume jobs and configuration changes, resend invitations, and keep the source
read-only for your rollback window. Delete the source tenant (and its backups)
only after the target is green.

## Rollback

The import is additive on the target and does not touch the source. To roll
back: point DNS and `ORIGIN` back at the source and unfreeze it. If the target
created a new tenant, delete it. If the import replaced an existing target
tenant, its pre-import configuration is gone — export the target first, or use
the tenant backup from before the cutover.

## Security notes

- The archive is a credential. Keep it out of ticket attachments, chat and
  shared drives. Delete it after the fleet is verified.
- Downloads and imports require tenant export/import permission and a fresh
  step-up. The passphrase is never logged, stored or put in a URL.
- Console and API logs record counts and IDs, not archive bodies, keys or
  passphrases.
- A wrong passphrase and a tampered file produce different errors; neither
  echoes ciphertext or key material.
- Importing into a tenant owned by someone else still requires that tenant's
  write permission and the same step-up. Cross-deployment imports require an
  explicit acknowledgement.
- Rotate a passphrase by exporting a new archive. There is no in-place re-key.
