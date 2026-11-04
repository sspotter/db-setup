#!/usr/bin/env bash
#
# restore-db.sh — restore a backup made by backup-db.sh.
#
# Run it ON THE VM from the repo root.
#
#   ./scripts/restore-db.sh <backup-dir>              SAFE (default): restores into a NEW scratch
#                                                     database "<db>_restore_<time>" and compares row
#                                                     counts with the manifest. The live database is
#                                                     not touched. Use it to check a backup or to
#                                                     copy rows back by hand.
#   ./scripts/restore-db.sh <backup-dir> --in-place   REVERT: replaces the live database with the backup.
#
# --in-place does, in order:
#   1. refuses if anything else is connected (stop the service first:
#        sudo systemctl stop tiksurfer        # or insta-surfer)
#   2. takes a safety backup of the CURRENT state (so the revert can itself be undone)
#   3. asks you to type the database name
#   4. pg_restore --clean in one transaction (all or nothing)
#   5. compares row counts with the manifest
# Start the service again afterwards:  sudo systemctl start tiksurfer
# Drop a scratch database you no longer need:  DROP DATABASE "<name>";
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib-db.sh"

DIR="${1:-}"
MODE="${2:-}"
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "Usage: $0 <backup-dir> [--in-place]"; exit 1; }
[ -z "$MODE" ] || [ "$MODE" = "--in-place" ] || { echo "Unknown option: $MODE"; exit 1; }
DIR="$(cd "$DIR" && pwd)"
[ -f "$DIR/full.dump" ] && [ -f "$DIR/manifest.txt" ] || { echo "$DIR is not a backup-db.sh folder (full.dump / manifest.txt missing)"; exit 1; }

echo "== checking backup integrity"
(cd "$DIR" && sha256sum -c SHA256SUMS) || { echo "STOP: checksum mismatch, the backup file changed"; exit 1; }
pg_restore -l "$DIR/full.dump" >/dev/null || { echo "STOP: dump is not readable"; exit 1; }

PLATFORM="$(grep -E '^platform=' "$DIR/manifest.txt" | cut -d= -f2)"
BACKUP_DB="$(grep -E '^database=' "$DIR/manifest.txt" | cut -d= -f2)"
load_db "$PLATFORM"
[ "$DB_NAME" = "$BACKUP_DB" ] || { echo "STOP: backup is of '$BACKUP_DB' but the $PLATFORM backend uses '$DB_NAME'"; exit 1; }

compare_counts() { # $1 = url of the restored database
  local ok=1 line t want got
  while IFS= read -r line; do
    t="${line%%=*}"; want="${line#*=}"
    got="$(psql "$1" -Atc "select count(*) from $t")"
    if [ "$got" = "$want" ]; then printf '   ok       %-24s %s\n' "$t" "$got"
    else printf '   MISMATCH %-24s backup=%s restored=%s\n' "$t" "$want" "$got"; ok=0; fi
  done < <(sed -n '/^\[row_counts\]/,$p' "$DIR/manifest.txt" | tail -n +2)
  [ "$ok" = 1 ]
}

if [ "$MODE" != "--in-place" ]; then
  SCRATCH="${DB_NAME}_restore_$(date +%Y%m%d%H%M%S)"
  echo "== restoring into NEW database $SCRATCH (live database untouched)"
  psql "$(url_for_db postgres)" -v ON_ERROR_STOP=1 -c "create database \"$SCRATCH\""
  pg_restore --no-owner --exit-on-error -d "$(url_for_db "$SCRATCH")" "$DIR/full.dump"
  echo "== row counts, backup vs restored"
  if compare_counts "$(url_for_db "$SCRATCH")"; then echo "OK  backup restores cleanly into $SCRATCH"; else echo "WARNING: counts differ"; fi
  echo "Drop it when done:  psql \"\$URL\" -c 'DROP DATABASE \"$SCRATCH\"'   (URL = the $PLATFORM LOCAL_DATABASE_URL)"
  exit 0
fi

echo "== IN-PLACE revert of $DB_NAME to the backup taken $(grep -E '^created=' "$DIR/manifest.txt" | cut -d= -f2)"
OTHERS="$(psql "$DB_URL" -Atc "select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()")"
if [ "$OTHERS" != 0 ]; then
  echo "STOP: $OTHERS other connection(s) to $DB_NAME. Stop the service first (sudo systemctl stop tiksurfer | insta-surfer), then re-run."
  exit 1
fi
[ -t 0 ] || { echo "STOP: in-place restore needs an interactive terminal to confirm"; exit 1; }
read -r -p "Type the database name ($DB_NAME) to REPLACE it with this backup: " TYPED
[ "$TYPED" = "$DB_NAME" ] || { echo "Not confirmed. Nothing was changed."; exit 1; }

echo "== 1/3 safety backup of the current state"
"$REPO_ROOT/scripts/backup-db.sh" "$PLATFORM"
echo "== 2/3 restoring (one transaction; rolls back on any error)"
pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error -d "$DB_URL" "$DIR/full.dump"
echo "== 3/3 row counts, backup vs restored"
if compare_counts "$DB_URL"; then echo "OK  $DB_NAME is back to the backup"; else echo "WARNING: counts differ, check before starting the service"; fi
echo "Start the service again:  sudo systemctl start $([ "$PLATFORM" = tiktok ] && echo tiksurfer || echo insta-surfer)"
