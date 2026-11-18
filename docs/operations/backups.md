# Backups

`.github/workflows/db-backup.yml` writes a nightly logical backup of the
production MySQL database into R2.

- **When.** 03:17 UTC every day, plus `workflow_dispatch` for an off-cycle run.
- **Where.** The `mattrax-backups` bucket, location hint `enam` (Eastern North
  America, beside the GitHub-hosted runners).
- **How long.** 90 days. Objects move to Infrequent Access after 30 days and are
  deleted by an R2 lifecycle rule, not by the workflow.
- **Credentials.** The workflow reuses `DATABASE_URL`, `CLOUDFLARE_ACCOUNT_ID`
  and `CLOUDFLARE_API_TOKEN`; there is nothing extra to configure.

This is a logical backup of one database at one instant. It is not
point-in-time recovery: the worst case is losing up to a day of writes. For
anything shorter, enable the database provider's own binary log retention,
which this workflow does not configure.

## Object layout

```
mattrax-backups/
  daily/2026-11-18T03-17-04Z.sql.zst    mysqldump output, zstd -19 --long=27
  daily/2026-11-18T03-17-04Z.json       manifest: sha256, sizes, versions
```

The manifest is what the workflow verifies against, and what you should verify
against before restoring:

```json
{
  "schema_version": 1,
  "database": "mattrax",
  "dump": "2026-11-18T03-17-04Z.sql.zst",
  "created_at": "2026-11-18T03:17:41Z",
  "sha256": "…",
  "compressed_bytes": 412345,
  "tables": 94,
  "mysql_server": "8.4.13",
  "mysqldump": "mysqldump  Ver 8.0.43 …",
  "zstd_level": 19,
  "restore": "zstd -d --long=27 … | mysql <database>"
}
```

Dumps are compressed at zstd level 19 with a 128 MiB long-range window, which
measured about half the size of `gzip -9` on a representative dump.
Decompression needs the same window size, so always pass `--long=27` (the
scripts do).

`DEFINER=` clauses are stripped as the dump is written, so the restored views,
triggers and routines belong to whoever runs the restore instead of to `root`
on the source server. Keeping them would mean a restore needs `SUPER` or
`SET_ANY_DEFINER`, and a `DEFINER=root` view is a privilege-escalation
primitive wherever it lands. `KEEP_DEFINERS=1` turns this off for a restore
back into the same server; the manifest records which happened.

The bucket has no public URL and is private to the account. R2 encrypts objects
at rest; the dumps are not additionally encrypted, so permission to read the
bucket is permission to read every tenant's data.

## Manual run

```bash
gh workflow run db-backup.yml
gh run watch "$(gh run list --workflow=db-backup.yml --limit=1 --json databaseId --jq '.[0].databaseId')"
```

The run summary records the object key, size, table count and checksum. A run
only reports success after it has downloaded the object again, compared its
sha256 against the manifest and decompressed it.

There is no separate alerting: a failed run is a red run in Actions, and GitHub
emails the repository owner, which is also how the rest of this repository
reports failures. A run that fails before uploading leaves yesterday's backup in
place, so a single failure is not data loss — a failure that repeats for
`RETENTION_DAYS` is, which is why the retention rule is on the bucket and not in
the workflow.

## Restore

Rehearse into a scratch database first. Half-written dumps and partially
applied restores both look plausible, so the rehearsal is not optional.

```bash
# 1. Fetch the backup and its manifest.
stamp=2026-11-18T03-17-04Z
wrangler r2 object get "mattrax-backups/daily/$stamp.sql.zst" --file "$stamp.sql.zst"
wrangler r2 object get "mattrax-backups/daily/$stamp.json"   --file "$stamp.json"

# 2. Check it is the object the backup wrote.
sha256sum "$stamp.sql.zst"
jq -r .sha256 "$stamp.json"

# 3. Restore into a scratch database and sanity check it.
TARGET_DATABASE_URL="mysql://mattrax_ci:…@host:3306/restore_scratch" \
RESTORE_CONFIRM=yes apps/cloud/scripts/db-restore.sh "$stamp.sql.zst"

mysql --host … --user … -p restore_scratch \
  -e "SELECT COUNT(*) FROM organization; SELECT MAX(created_at) FROM audit_log;"
```

`apps/cloud/scripts/db-restore.sh` decompresses on the way in, checks the archive before
touching the target, pins the session to UTC so `TIMESTAMP` columns do not
shift, and drops and recreates every table that the dump contains.

Three things to know before running it:

- It needs enough privilege to create everything in the dump. Tables are fine
  with `ALL` on the schema; views, triggers and routines additionally need
  `SUPER`, `SET_ANY_DEFINER` or `SHOW_ROUTINE`-adjacent grants depending on the
  server. Restoring as `root` is the boring option.
- On a target with binary logging on, replaying triggers or routines needs
  `SUPER` or `log_bin_trust_function_creators=1`; the script warns when neither
  is true. Production has binary logging off, so this only bites scratch
  servers.
- A failed restore leaves the target **partially** restored — MySQL cannot roll
  back DDL. The script says so on the way out; drop and recreate the database
  before retrying.

Only when the rehearsal is clean, restore over production — and note that
migrations run on the next deploy, so the restored schema must match the code
that will serve it:

```bash
TARGET_DATABASE_URL="$DATABASE_URL" RESTORE_CONFIRM=yes \
  apps/cloud/scripts/db-restore.sh "$stamp.sql.zst"
```

## What this does not cover

A database dump restores the rows, not the product.
[Infrastructure backups](/admin/operations#infrastructure-backups) lists the
rest of the recovery set — the R2 data bucket, the Worker secrets and the
Apple/Stripe/Entra credentials — and the order to restore them in.

Known gaps, in the order they would hurt:

1. **A day of writes.** No binlog retention is configured, so there is no
   point-in-time recovery.
2. **The R2 data bucket.** Tenant uploads, packages and per-tenant bundles live
   there and are only covered by R2's own durability, not by this workflow.
3. **No off-site copy.** Every object is in one account. An account-level
   mistake (deleting the bucket, losing billing) takes the backups with it.
   R2 bucket locks, or a second copy in another account, close that gap.
