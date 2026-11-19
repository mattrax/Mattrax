#!/usr/bin/env bash
#
# Dump the Mattrax database, compress it, and describe the result.
#
# Usage:
#   DATABASE_URL=mysql://user:pass@host:3306/mattrax apps/cloud/scripts/db-backup.sh
#
# Writes into $OUT_DIR (default: .backups):
#   <stamp>.sql.zst   mysqldump output compressed with zstd level 19 and a
#                     128 MiB long-range window
#   <stamp>.json      manifest: sha256, sizes, versions, restore command
#
# The stamp is the only thing written to stdout, so the caller can build an
# object key from it. Everything else goes to stderr.
set -euo pipefail

url="${MYSQL_URL:-${DATABASE_URL:-}}"
if [ -z "$url" ]; then
  echo "DATABASE_URL (or MYSQL_URL) must be set to a mysql:// connection string" >&2
  exit 1
fi

out_dir="${OUT_DIR:-.backups}"
level="${ZSTD_LEVEL:-19}"
threads="${ZSTD_THREADS:-0}" # 0 = one worker per core

for tool in node mysql mysqldump zstd; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "missing required tool: $tool" >&2
    exit 1
  }
done

work="$(mktemp -d)"
cnf="$work/my.cnf"

cleanup() {
  local status=$?
  rm -rf "$work"
  # A half-written dump is worse than none: it looks restorable.
  if [ "$status" -ne 0 ] && [ -n "${dump:-}" ]; then
    rm -f "$dump"
  fi
}
trap cleanup EXIT

db_name="$(MYSQL_URL="$url" node "$(dirname "$0")/mysql-client-config.mjs" "$cnf")"
if ! [[ "$db_name" =~ ^[A-Za-z0-9_$]+$ ]]; then
  echo "refusing to use database name with unexpected characters: $db_name" >&2
  exit 1
fi

server_version="$(mysql --defaults-extra-file="$cnf" -N -B -e "SELECT VERSION()")"
tables="$(mysql --defaults-extra-file="$cnf" -N -B -e \
  "SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = '$db_name' AND table_type = 'BASE TABLE'")"

# Guards against DATABASE_URL pointing at a freshly created, never-migrated
# database: a backup of nothing restores to nothing, but it still looks green.
if [ "$tables" -eq 0 ]; then
  echo "database '$db_name' has no tables; refusing to record an empty backup" >&2
  exit 1
fi

# `--routines` is not free: reading a procedure body needs the global
# SHOW_ROUTINE privilege, which a schema-scoped grant such as `ALL ON mattrax.*`
# does not include. Dumping with it against an unprivileged user fails the
# whole backup, so only ask for it when the schema has routines, and say what
# to grant when it does and the user cannot read them.
routines="$(mysql --defaults-extra-file="$cnf" -N -B -e \
  "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = '$db_name'")"
extra_flags=()
if [ "$routines" -gt 0 ]; then
  can_show_routines="$(mysql --defaults-extra-file="$cnf" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.user_privileges WHERE privilege_type = 'SHOW_ROUTINE'")"
  if [ "$can_show_routines" -eq 0 ]; then
    echo "database '$db_name' has $routines routines but this user cannot read their" >&2
    echo "definitions; grant SHOW_ROUTINE (global) to the backup user or remove them" >&2
    exit 1
  fi
  extra_flags+=(--routines)
fi

dump_version="$(mysqldump --version | head -1 | tr -d '\\"')"
if printf '%s' "$dump_version" | grep -qi mariadb; then
  echo "warning: mysqldump is MariaDB's; its dumps do not import cleanly into MySQL 8.4" >&2
fi

# Views, triggers, procedures and events are dumped with `DEFINER=`root`@`...``.
# Replaying that needs SUPER or SET_ANY_DEFINER, so a restore as any ordinary
# user stops partway — and a DEFINER=root view is a privilege-escalation
# primitive wherever it lands. Strip the clauses so restored objects belong to
# whoever performs the restore. KEEP_DEFINERS=1 restores them, for a restore
# back into the same server.
# shellcheck disable=SC2016 # the backticks are literal, not a command substitution
definer_filter=(sed -E 's/DEFINER=`[^`]*`@`[^`]*` ?//g')
definers="stripped"
if [ "${KEEP_DEFINERS:-0}" = "1" ]; then
  definer_filter=(cat)
  definers="kept"
fi

# sha256sum is Linux-only; macOS has shasum. Operators run this on laptops too.
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

mkdir -p "$out_dir"
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
dump="$out_dir/$stamp.sql.zst"
manifest="$out_dir/$stamp.json"

echo "dumping $db_name ($tables tables, server $server_version) to $dump" >&2

# --single-transaction: a consistent snapshot from InnoDB without blocking
#   writers, and it implies --lock-tables=OFF.
# --no-tablespaces: avoids needing the global PROCESS privilege just to dump
#   tablespace names.
# --set-gtid-purged=OFF: without it a dump from a GTID server carries statements
#   that fail on import into a plain one.
mysqldump \
  --defaults-extra-file="$cnf" \
  --single-transaction \
  --quick \
  --triggers \
  --events \
  --no-tablespaces \
  --set-gtid-purged=OFF \
  --default-character-set=utf8mb4 \
  --hex-blob \
  ${extra_flags[@]+"${extra_flags[@]}"} \
  "$db_name" |
  "${definer_filter[@]}" |
  zstd --quiet "-$level" --long=27 -T"$threads" -o "$dump"

sha="$(sha256 "$dump")"
bytes="$(wc -c <"$dump" | tr -d ' ')"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat >"$manifest" <<JSON
{
  "schema_version": 1,
  "database": "$db_name",
  "dump": "$(basename "$dump")",
  "created_at": "$created_at",
  "sha256": "$sha",
  "compressed_bytes": $bytes,
  "tables": $tables,
  "mysql_server": "$server_version",
  "mysqldump": "$dump_version",
  "zstd_level": $level,
  "definers": "$definers",
  "restore": "zstd -d --long=27 $(basename "$dump") | mysql <database>"
}
JSON

echo "wrote $manifest: $bytes bytes, sha256 $sha" >&2
printf '%s\n' "$stamp"
