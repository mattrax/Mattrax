# Legacy `mttx` data migration

`migrate-mttx.mjs` copies the legacy `mattrax/mttx` MySQL schema into a freshly
migrated `mattraxe` database. It is an **operator tool**, not a deployment step:
it is not wired into CI and must never run automatically.

The full mapping, cutover checklist and open decisions live in
[`docs/enterprise/mttx-data-migration.md`](../../../docs/enterprise/mttx-data-migration.md).
The original design issue is [#5](https://github.com/oscartbeaumont/mattraxe/issues/5).

## Prerequisites

- Node.js 22 or newer. `mysql2` resolves from `apps/api` (already a dependency).
- The legacy database is at the current `mttx` schema (all migrations through
  `20260207091500_instance-id-bigint.sql`).
- The target database has all `mattraxe` migrations applied:

  ```sh
  pnpm db:up
  pnpm db:migrate
  ```

- A write freeze on the legacy service for the real run. The script uses one
  transaction on the target, but it cannot protect against concurrent legacy
  writes changing rows mid-read.
- Network/TLS access to both databases, or a tunnel.

## Configuration

Source:

| Variable                                                     | Meaning                                           |
| ------------------------------------------------------------ | ------------------------------------------------- |
| `MTTX_DATABASE_URL`                                          | Full DSN, e.g. `mysql://user:pass@host:3306/mttx` |
| `MTTX_DATABASE_HOST` / `PORT` / `USER` / `PASSWORD` / `NAME` | Used when the DSN is absent                       |
| `MTTX_DATABASE_SSL=1`                                        | Enable TLS for the source connection              |

Target:

| Variable                                                | Meaning                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `TARGET_DATABASE_URL`                                   | Full DSN for the mattraxe database                               |
| `DATABASE_HOST` / `PORT` / `USER` / `PASSWORD` / `NAME` | Existing project convention; defaults match `docker-compose.yml` |
| `TARGET_DATABASE_SSL=1`                                 | Enable TLS for the target connection                             |

APNs re-sealing (only with `--resell-apns`):

| Variable      | Meaning                                                     |
| ------------- | ----------------------------------------------------------- |
| `MTTX_SECRET` | Legacy 32-byte application secret used to encrypt APNs keys |
| `AUTH_SECRET` | New application secret used to seal APNs keys               |

Never put secrets in a shell history, committed file or ticket. Prefer an
ephemeral secret store or a short-lived environment on a trusted host.

## Usage

Always start with a dry run. It executes the same inserts inside a target
transaction and rolls everything back, so foreign-key and duplicate-key
problems surface before anything is committed:

```sh
MTTX_DATABASE_URL='mysql://.../mttx' \
TARGET_DATABASE_URL='mysql://.../mattraxe' \
node apps/api/scripts/migrate-mttx.mjs --dry-run
```

A real run requires `--yes`:

```sh
MTTX_DATABASE_URL='mysql://.../mttx' \
TARGET_DATABASE_URL='mysql://.../mattraxe' \
node apps/api/scripts/migrate-mttx.mjs --yes
```

Options:

| Flag               | Effect                                                                           |
| ------------------ | -------------------------------------------------------------------------------- |
| `--dry-run`        | Perform all work, then roll back. Does not require `--yes`.                      |
| `--yes`            | Required for a committed run.                                                    |
| `--resell-apns`    | Decrypt legacy APNs keys with `MTTX_SECRET` and re-seal them with `AUTH_SECRET`. |
| `--import-scep-ca` | Import the legacy SCEP CA (DER → PEM/JWK). Default is to generate a new CA.      |
| `--skip-instances` | Do not migrate the legacy `instance` table.                                      |
| `--verbose`        | Print every skipped row instead of the first 20 per reason.                      |

The script is additive and upsert-based: it never deletes target rows. Running
it again before cutover is safe and will refresh copied fields. Avoid reruns
after the new system starts accepting writes, because stale legacy values can
overwrite newer ones.

## What it migrates

- Organisations, owner memberships, enrolment settings and links.
- Users, email identifiers and email credentials (**no password hashes**).
- Devices, Apple device state and Apple user channels.
- Groups, group/device links, policies, configurations and group/policy links.
- Platform instances (keys are hashed; plaintext keys cannot be recovered).
- Optionally APNs certificates and the SCEP CA, with the caveats below.

It does **not** migrate sessions, email codes, audit history, invitations,
SSO/SCIM state, subscriptions, DDM declarations or queued commands.

## Dry-run checklist

Read the output and resolve every skipped row and unknown kind:

- `organisation was not migrated` — usually an orphan device/group/policy.
- `email already belongs to another target user` — merge decision needed.
- `serial already belongs to another device` — duplicate hardware record.
- `organisation already has an enrollment with a different id` — the target
  was already used; confirm which enrolment link should win.
- `unknown configuration kind` — rewrite to a supported `mttx.apple.*` /
  `mttx.windows.*` kind before cutover.
- `could not decrypt/re-seal legacy key` — wrong `MTTX_SECRET` or corrupt key;
  re-upload the APNs certificate instead.

## Validation queries

Run these against the target after a real migration. Counts are not a full
proof, but they catch partial runs and orphaned rows.

```sql
-- Top-level counts should match the legacy database, adjusted for reported skips.
SELECT COUNT(*) AS users FROM user;
SELECT COUNT(*) AS organizations FROM organization;
SELECT COUNT(*) AS members FROM member;
SELECT COUNT(*) AS enrollments FROM enterprise_enrollment;
SELECT COUNT(*) AS devices FROM device;
SELECT COUNT(*) AS apple_devices FROM device_apple;
SELECT COUNT(*) AS groups FROM enterprise_group;
SELECT COUNT(*) AS policies FROM policy;
SELECT COUNT(*) AS configurations FROM configuration;

-- Every organisation must still have its owner.
SELECT o.id, o.name
FROM organization o
LEFT JOIN member m ON m.organization_id = o.id AND m.role = 'owner'
WHERE m.id IS NULL;

-- Device counts per organisation against the legacy `tenant` column.
SELECT organization_id, COUNT(*) FROM device GROUP BY organization_id
ORDER BY organization_id;

-- Every Apple device should have a device_apple extension row.
SELECT d.id
FROM device d
LEFT JOIN device_apple da ON da.device_id = d.id
WHERE d.proto = 'apple' AND da.device_id IS NULL;

-- Group and policy targeting must be intact.
SELECT g.id, COUNT(gd.device_id) AS devices
FROM enterprise_group g
LEFT JOIN group_device gd ON gd.group_id = g.id
GROUP BY g.id
ORDER BY g.id;

SELECT p.id, COUNT(gp.group_id) AS groups
FROM policy p
LEFT JOIN group_policy gp ON gp.policy_id = p.id
GROUP BY p.id
ORDER BY p.id;

-- Authentication: migrated users should have an email identifier + credential,
-- and there must be no imported password verifiers.
SELECT COUNT(*) AS users_without_email_identifier
FROM user u
LEFT JOIN auth_identifiers i
  ON i.subject_id = u.id AND i.namespace = 'email'
WHERE i.subject_id IS NULL;

SELECT COUNT(*) AS imported_password_rows FROM auth_passwords;

-- Signed-in users must not carry over from the legacy system.
SELECT COUNT(*) AS sessions_after_migration FROM auth_sessions;

-- Unknown/unsupported policy kinds (also reported by the script).
SELECT DISTINCT kind FROM configuration
WHERE kind NOT LIKE 'mttx.apple.%' AND kind NOT LIKE 'mttx.windows.%';
```

Spot-check by signing in with email-code authentication for a few migrated
users, opening an existing `/enroll/<id>` link, and confirming a device
check-in appears in the device detail page.

## APNs and SCEP decisions

These cannot be copied as-is. The script warns and skips them by default.

### APNs

Legacy keys are ChaCha20-Poly1305 ciphertexts under the old `SECRET`; the new
server seals keys with AES-256-GCM under `AUTH_SECRET`. Either:

1. Re-upload the APNs certificate/key in the new UI (recommended), keeping the
   Apple topic the same so devices do not need to re-enrol, or
2. Run `--resell-apns` with both secrets on a trusted machine.

`topic` and `email` are copied. If two legacy tenants shared one Apple topic,
each organisation gets its own row.

### SCEP CA

The new server generates a fresh CA when none exists. That is the recommended
path; existing devices then need to re-enrol. `--import-scep-ca` converts the
legacy DER certificate and PKCS#8 key into the new PEM/JWK row, but:

- `scep_issued_certificate` has no legacy history, so renewal authentication
  fails until devices re-enrol or records are backfilled.
- The legacy CA key is long-lived (12 years) and has a larger blast radius.

## Password reset communication

No `auth_passwords` rows are created. Users with a legacy password hash must
either reset their password or use email-code sign-in. Users who were
passwordless in the legacy system already use email codes. Unverified legacy
addresses keep `verified_at = NULL` and must complete verification first.

## Rollback

The real run commits one target transaction. If validation fails before the DNS
switch, restore the target backup (or run the migration against a fresh target
again). Keep the legacy database and its backups untouched until the retention
window ends. See the cutover procedure in the full runbook.
