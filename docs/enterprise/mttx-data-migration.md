# Migrating from legacy mttx

This page is the operator runbook for moving a production `mattrax/mttx` MySQL
database into `mattraxe`. The design issue is
[#5](https://github.com/oscartbeaumont/mattraxe/issues/5); the script itself is
`apps/api/scripts/migrate-mttx.mjs` with usage details in
`apps/api/scripts/README.md` (both in the repository).

The migration is **best effort**. It preserves IDs and operational data, but it
cannot preserve legacy passwords, sessions, APNs private keys or the SCEP CA
without an explicit operator decision.

## What the source looks like

The legacy schema is defined by `apps/mattrax/migrations` in
`mattrax/mttx`. Two facts drive the mapping:

- `tenant.id` **is** the owner's `account.id`. Registration inserts both rows
  with the same generated id, and tenant queries join
  `account a INNER JOIN tenant t ON a.id = t.id`.
- `tenant.email` is a contact email, not a login. The login email is
  `account.email`.

There are no legacy team members, invitations, audit rows, SSO identities or
user groups. Every legacy account owns exactly one tenant.

## Table mapping

| Legacy                          | New                                                                             | ID handling                        | Notes                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `tenant`                        | `organization`                                                                  | Preserve `tenant.id`               | Name, timestamps and `stripe_customer_id`; contact email goes into `organization.metadata`.        |
| `tenant` owner                  | `member`                                                                        | New deterministic id               | `role = 'owner'`, derived from `tenant.id = account.id`.                                           |
| `tenant` enrolment columns      | `enterprise_enrollment`                                                         | Preserve `enroll_id` as the new id | Keeps `/enroll/<id>` links alive; `enroll_code` becomes `code`.                                    |
| `account`                       | `user`                                                                          | Preserve `account.id`              | `verified` → `email_verified`, `disabled` → `disabled`.                                            |
| `account`                       | `auth_identifiers`, `auth_credentials`, `auth_emailCredentials`                 | Keyed by preserved user id         | Email identifier and email credential only. No password verifier.                                  |
| `session`                       | —                                                                               | —                                  | Dropped; legacy refresh tokens are not Yielded Auth sessions.                                      |
| `email_code`                    | —                                                                               | —                                  | Dropped; codes are short-lived.                                                                    |
| `device`                        | `device`                                                                        | Preserve `device.id`               | `tenant` → `organization_id`; `created` → `enrolled_at`; `last_seen` → `last_seen_at`.             |
| `device_apple.udid`             | `device.dm_identifier`                                                          | —                                  | UUID used for device lookup.                                                                       |
| `device_apple.cert_hash`        | `device.dm_cert_hash`                                                           | Binary → hex                       | Informational; the new server hashes the PEM certificate on the next check-in.                     |
| `device_apple.model_identifier` | `device.model_identifier`                                                       | —                                  | Moved to the core device row.                                                                      |
| `device_apple`                  | `device_apple`                                                                  | Preserve `device.id`               | Push `token` raw bytes → hex; `unlock_token`/`bootstrap_token` → base64; `device_token` preserved. |
| `device_user`                   | `device_apple_user`                                                             | New composite key                  | Apple `UserID` becomes `user_id`; push token → hex; disabled rows skipped.                         |
| `group`                         | `enterprise_group`                                                              | Preserve `group.id`                | Tenant maps to `organization_id`.                                                                  |
| `group_device`                  | `group_device`                                                                  | Composite key                      | Rows with skipped dependencies are reported.                                                       |
| `group_policy`                  | `group_policy`                                                                  | Composite key                      | Targeting survives.                                                                                |
| `policy`                        | `policy`                                                                        | Preserve `policy.id`               | Tenant maps to `organization_id`.                                                                  |
| `configuration`                 | `configuration`                                                                 | (`kind`, `policy_id`)              | Data copied; hash recomputed as `SHA-256(JSON.stringify(data))`.                                   |
| `apple_push_certs`              | `apple_push_certificate`                                                        | —                                  | One row per organisation. Key needs re-upload or re-seal.                                          |
| `ca`                            | `scep_ca`                                                                       | Always `id = 1`                    | Optional import. Prefer a new CA.                                                                  |
| `instance`                      | `platform_instance`                                                             | Preserve numeric id as text        | `key` hashed with SHA-256; prefix kept; issuer mapped to user.                                     |
| —                               | `scep_issued_certificate`                                                       | —                                  | No legacy source; renewals cannot be backfilled automatically.                                     |
| —                               | `invitation`, `audit_log`, `sso_*`, `scim_token`, `user_group*`, `subscription` | —                                  | Out of scope; no legacy data.                                                                      |

Fields without a new home (`account.marketing_email`, `device.imei`,
`device.meid`, `device.unenrolled`, `device_user` names and enabled flags) are
dropped. Contact email and Android enterprise id are preserved in organisation
metadata; export anything else you need before decommissioning.

## Authentication

### Preserved

- User IDs and lowercase emails.
- `email_verified` and `disabled` state.
- Email-code sign-in: an `auth_identifiers` row in namespace `email`, an active
  `auth_credentials` row, and an active `auth_emailCredentials` row under module
  id `mattrax/auth/email`.

### Not preserved

- **Passwords.** Legacy hashes are Argon2 PHC strings from the Rust
  `password_auth` crate. Yielded Auth stores a different versioned verifier, and
  compatibility has not been proven. The script writes no `auth_passwords`
  rows. Every user with a legacy password must reset it or use email-code
  sign-in.
- **Sessions.** `auth_sessions` starts empty; everyone is signed out.
- **Verification codes.** `email_code` is dropped.

Unverified legacy accounts keep a NULL `verified_at`, so email-code sign-in
rejects them until the address is verified again. Disabled accounts stay
disabled; note that the legacy 2026 auth overhaul marked passwordless accounts
as disabled, so some users need a deliberate re-enable.

## Devices

Binary conversions matter:

- `cert_hash BINARY(32)` → lowercase hex.
- Push `token VARBINARY` → lowercase hex (the new MDM handler normalises base64
  plist tokens to hex).
- `unlock_token` / `bootstrap_token` `VARBINARY` → base64 text (the new plist
  representation).
- `device_token` is preserved because it appears in profile and asset URLs.

The new server resolves devices by `dm_identifier` (UDID) scoped to the
organisation, so a changed `dm_cert_hash` does not break check-ins; it is
rewritten on the next `Authenticate`. Windows and Android rows can be copied,
but the new backend only has a Windows preview and no Android management, so
decide whether to migrate them as inert rows.

## Policies

`policy`, `configuration`, `group_policy` and `group_device` copy with IDs and
links preserved. Current legacy kinds already use `mttx.apple.*`; older rows may
not. The script reports unknown kinds and copies them unchanged rather than
guessing. Rewrite them to `mttx.apple.device`, `mttx.apple.custom.<id>`,
`mttx.apple.certificate.<id>`, `mttx.apple.declaration.<id>` or
`mttx.windows.custom.<id>` before devices can receive them.

Configuration hashes are recomputed because the new server defines the hash as
SHA-256 over `JSON.stringify(data)`. The first DDM sync after cutover may
re-issue declarations because declaration identifiers also changed from
`policyId.kind` to `policyId:kind`.

## APNs

Legacy APNs private keys are ChaCha20-Poly1305 ciphertexts (nonce prefix)
encrypted with the old 32-byte `SECRET`; certificates are DER. New keys are
JWK JSON sealed with AES-256-GCM under `SHA-256(AUTH_SECRET)`; certificates are
PEM.

Options, in order of preference:

1. **Re-upload** the certificate and key through the new UI. Keep the Apple
   topic unchanged, or devices must re-enrol.
2. **Re-seal offline** with `--resell-apns`, `MTTX_SECRET` and `AUTH_SECRET` on a
   trusted machine. The script decrypts, converts PKCS#8 DER to JWK, and seals
   with the new scheme.

`topic` and `email` are copied. A legacy Apple topic can be shared by more than
one tenant; the new schema stores one certificate per organisation.

## SCEP CA

**Recommended:** let the new server generate a fresh CA and re-enrol devices.
The legacy CA is an RSA-4096 key with a 12-year lifetime, and importing it
increases blast radius.

**If continuity is mandatory:** `--import-scep-ca` converts the DER certificate
to PEM and the PKCS#8 key to a JWK. Be aware that:

- `scep_issued_certificate` has no legacy history, so renewal authentication
  fails until devices re-enrol or records are backfilled.
- Devices only trust the CA named in their enrollment profile; changing CAs
  always requires re-enrolment.

## Enrolment, instances and invitations

- `tenant.enroll_id` becomes `enterprise_enrollment.id`, preserving existing
  share links. `enroll_code` is the new plaintext `code`; platform toggles and
  device cap carry over.
- `instance.key` is hashed into `platform_instance.key_hash` and the first 13
  characters become `key_prefix`. Existing self-hosted installations keep
  working, but the plaintext key can never be shown again.
- `mttx` has no invitation table. Recreate any outstanding invites after
  cutover.

## Cutover

1. Freeze legacy writes (maintenance mode or stop the service).
2. Snapshot the legacy database and back up the target. Record row counts and
   checksums for every table.
3. Restore production-sized copies into staging and run `--dry-run`. Resolve
   every skipped row and unknown policy kind.
4. Rehearse the timed run, including the APNs and SCEP decisions.
5. Run with `--yes`. The script writes in one target transaction.
6. Validate with the queries in the script README: counts, owner memberships,
   per-organisation device counts, group/policy links, email identifiers and
   the absence of imported password rows.
7. Re-upload or re-seal APNs credentials and choose the SCEP CA **before**
   switching traffic, so pushes and enrolment work immediately.
8. Lower DNS TTLs, switch traffic, and monitor sign-in failures, MDM check-ins,
   push errors and enrolment attempts.
9. Send the password-reset communication.

Rollback before the DNS switch is a target restore. After the switch, revert
DNS, keep the legacy database and backups, and reconcile any writes made in the
new system. Do not decommission the legacy database until the retention window
ends.

## Security

- Never log or commit DSNs, `MTTX_SECRET`, `AUTH_SECRET`, APNs keys, SCEP keys,
  password hashes, legacy sessions or instance keys. The script redacts DSNs and
  reports counts only.
- Use TLS for remote database connections and restrict access to backups and
  the migration host.
- Configure SPF/DKIM/DMARC for password-reset mail from the new domain and warn
  support about phishing suspicions.
- `audit_log` begins at cutover. If pre-cutover history is required for
  compliance, export it separately before decommissioning.

## Decisions needed

1. Force password resets for everyone (recommended), or fund a compatibility
   spike for the legacy Argon2 hashes?
2. Re-upload APNs credentials (recommended) or re-seal with the retired
   `SECRET`?
3. New SCEP CA and re-enrolment (recommended), or import the old CA and accept
   renewal failures?
4. What should happen to unverified and previously disabled accounts?
5. How should orphan accounts/tenants be resolved? The script reports them but
   never invents ownership.
6. Are derived organisation slugs acceptable, or do existing customers need
   reserved/reviewed slugs?
7. Migrate Windows/Android devices as inert rows, or exclude them until those
   backends are usable?
8. Do multiple tenants share an Apple topic? Each organisation needs its own
   APNs row.
9. Confirm legacy `DATETIME` values are UTC and target connections use UTC.
10. Are reruns allowed after cutover writes start? Upserts can restore stale
    legacy values.
