#!/usr/bin/env bash
#
# Restore a dump written by scripts/db-backup.sh into a MySQL database.
#
# Usage:
#   TARGET_DATABASE_URL=mysql://user:pass@host:3306/scratch \
#   RESTORE_CONFIRM=yes apps/cloud/scripts/db-restore.sh <stamp>.sql.zst
#
# The target is whatever database the URL names, and every table it shares with
# the dump is dropped and recreated, so rehearse against a scratch database
# first. RESTORE_CONFIRM=yes is the only thing standing between this and
# production.
set -euo pipefail

url="${MYSQL_URL:-${TARGET_DATABASE_URL:-}}"
dump_path="${1:-}"

if [ -z "$dump_path" ] || [ ! -f "$dump_path" ]; then
  echo "usage: TARGET_DATABASE_URL=mysql://... apps/cloud/scripts/db-restore.sh <dump.sql.zst>" >&2
  exit 1
fi
if [ -z "$url" ]; then
  echo "TARGET_DATABASE_URL (or MYSQL_URL) must be set to a mysql:// connection string" >&2
  exit 1
fi

for tool in node mysql zstd; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "missing required tool: $tool" >&2
    exit 1
  }
done

work="$(mktemp -d)"
cnf="$work/my.cnf"
started=0
finish() {
  local status=$?
  rm -rf "$work"
  if [ "$status" -ne 0 ] && [ "$started" -eq 1 ]; then
    echo "restore failed part-way: '$db_name' now holds some of the dump and some of" >&2
    echo "whatever was there before. Drop and recreate it before retrying." >&2
  fi
}
trap finish EXIT

db_name="$(MYSQL_URL="$url" node "$(dirname "$0")/mysql-client-config.mjs" "$cnf")"

# Check the dump before touching the destination: a corrupt file should fail
# while the target is still intact.
zstd --test --long=27 -q "$dump_path"

if [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  echo "about to overwrite tables in '$db_name' from $(basename "$dump_path")" >&2
  echo "re-run with RESTORE_CONFIRM=yes to proceed" >&2
  exit 1
fi

# Replaying triggers or routines into a server with binary logging on needs
# SUPER (or log_bin_trust_function_creators=1); without it mysql stops partway.
read -r log_bin trust_functions <<<"$(mysql --defaults-extra-file="$cnf" -N -B -e \
  'SELECT @@log_bin, @@log_bin_trust_function_creators')"
if [ "$log_bin" = "1" ] && [ "$trust_functions" = "0" ]; then
  can_super="$(mysql --defaults-extra-file="$cnf" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.user_privileges WHERE privilege_type = 'SUPER'")"
  if [ "$can_super" -eq 0 ]; then
    echo "warning: binary logging is on and this user has no SUPER privilege, so any" >&2
    echo "CREATE TRIGGER or CREATE PROCEDURE in the dump will be rejected." >&2
  fi
fi

echo "restoring $(basename "$dump_path") into '$db_name'" >&2
started=1
# --init-command keeps the session in UTC so TIMESTAMP columns do not shift.
zstd -d --long=27 -q -c "$dump_path" |
  mysql --defaults-extra-file="$cnf" --init-command="SET time_zone = '+00:00'" "$db_name"

echo "restored '$db_name'" >&2
