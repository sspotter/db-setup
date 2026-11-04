#!/usr/bin/env bash
#
# backup-db.sh — full, verified backup of the TikTok and/or Instagram database.
#
# Run it ON THE VM from the repo root. It only READS the database.
#   ./scripts/backup-db.sh tiktok
#   ./scripts/backup-db.sh instagram
#   ./scripts/backup-db.sh all          # both, one folder each
#
# Each backup is a folder under ~/backups/ (override with BACKUP_ROOT=...):
#   db-<platform>-<timestamp>/
#     full.dump      pg_dump custom format (restore with restore-db.sh)
#     manifest.txt   database name, time, git commit, row counts of key tables
#     SHA256SUMS     checksum, checked again by restore-db.sh
# The dump is verified (pg_restore -l) before the script reports success.
# Backups hold client data: keep them on the VM, never put them in git.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib-db.sh"

TARGET="${1:-}"
case "$TARGET" in
  tiktok|instagram) PLATFORMS="$TARGET" ;;
  all)              PLATFORMS="tiktok instagram" ;;
  *) echo "Usage: $0 tiktok|instagram|all"; exit 1 ;;
esac

umask 077
for PLATFORM in $PLATFORMS; do
  load_db "$PLATFORM"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  DIR="$BACKUP_ROOT/db-$PLATFORM-$STAMP"
  mkdir -p "$DIR"; chmod 700 "$DIR"

  echo "== $PLATFORM: backing up database $DB_NAME -> $DIR"
  pg_dump "$DB_URL" -Fc -f "$DIR/full.dump"
  pg_restore -l "$DIR/full.dump" >/dev/null || { echo "FAILED: dump is not readable"; exit 1; }

  {
    echo "platform=$PLATFORM"
    echo "database=$DB_NAME"
    echo "created=$(date -Is)"
    echo "git_commit=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo "pg_dump=$(pg_dump --version)"
    echo "[row_counts]"
    row_counts "$DB_URL"
  } > "$DIR/manifest.txt"
  (cd "$DIR" && sha256sum full.dump > SHA256SUMS)

  echo "   size: $(du -h "$DIR/full.dump" | cut -f1)   rows: $(grep -E '^(posts|comments)=' "$DIR/manifest.txt" | tr '\n' ' ')"
  echo "   OK  verified. Restore with: ./scripts/restore-db.sh $DIR"
done
