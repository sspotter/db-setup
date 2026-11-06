#!/usr/bin/env bash
#
# pull-db-to-local.sh — make a LOCAL copy of both production databases to test against.
#
# Run it LOCALLY (Git Bash) from the repo root. Needs ssh to the VM and Docker.
#   ./scripts/pull-db-to-local.sh                 take fresh backups on the VM, copy them here, restore
#   ./scripts/pull-db-to-local.sh --use-latest    skip the new backup, copy the newest one already on the VM
#   ./scripts/pull-db-to-local.sh --recreate      replace the local copies (without it, existing ones stop the script)
#   ./scripts/pull-db-to-local.sh --keep-hashes   do NOT blank user password hashes (default: blanked)
#
# What it does:
#   1. (VM) ./scripts/backup-db.sh all     READ-ONLY on production; each backup is verified there
#   2. copies the newest backup of each platform into ./local-db/ and re-checks the checksum
#   3. starts one throwaway-style Postgres container "db-setup-local-pg" on 127.0.0.1:55500
#      (same major version as the VM's pg_dump), with its own volume
#   4. restores into tiktok_local_test and instagram_local_test (names contain "test" so the
#      repo's real-database tests accept them)
#   5. blanks users.password_hash so no real credential hash sits on your laptop
#
# The copy still holds CLIENT DATA (emails, posts, follower counts). It stays in ./local-db/ and the
# container volume: both are git-ignored and must never be pushed, shared or attached anywhere.
# Production is only ever READ. Nothing here can write to it.
set -euo pipefail

VM="${VM_HOST:-medpush@100.115.149.3}"
VM_DIR="${VM_DIR:-databases/db-setup}"
C=db-setup-local-pg
PORT=55500
OUT="local-db"

USE_LATEST=0; RECREATE=0; KEEP_HASHES=0
for a in "$@"; do
  case "$a" in
    --use-latest) USE_LATEST=1 ;; --recreate) RECREATE=1 ;; --keep-hashes) KEEP_HASHES=1 ;;
    -h|--help) sed -n '3,24p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a"; exit 1 ;;
  esac
done
[ -f scripts/lib-db.sh ] || { echo "Run this from the repo root"; exit 1; }
git check-ignore -q "$OUT/x" || { echo "STOP: $OUT/ is not git-ignored; add it to .gitignore first"; exit 1; }
docker info >/dev/null 2>&1 || { echo "STOP: Docker is not running"; exit 1; }
remote() { ssh -o BatchMode=yes "$VM" "cd \"\$HOME/$VM_DIR\" && $*"; }

if [ "$USE_LATEST" = 0 ]; then echo "== taking fresh verified backups on the VM (read-only)"; remote 'bash ./scripts/backup-db.sh all'; fi

mkdir -p "$OUT"; chmod 700 "$OUT" 2>/dev/null || true
PGMAJOR=""
for p in tiktok instagram; do
  dir="$(ssh -o BatchMode=yes "$VM" "ls -dt \$HOME/backups/db-$p-* 2>/dev/null | head -1")"
  [ -n "$dir" ] || { echo "STOP: no backup of $p on the VM"; exit 1; }
  name="$(basename "$dir")"
  echo "== copying $name"
  rm -rf "$OUT/$name"; scp -qr "$VM:$dir" "$OUT/$name"
  (cd "$OUT/$name" && sha256sum -c SHA256SUMS >/dev/null) || { echo "STOP: checksum mismatch for $name"; exit 1; }
  echo "$name" > "$OUT/latest-$p"
  v="$(grep -E '^pg_dump=' "$OUT/$name/manifest.txt" | grep -Eo '[0-9]+\.[0-9]+' | head -1 | cut -d. -f1)"
  [ -z "$PGMAJOR" ] || [ "$v" -le "$PGMAJOR" ] || PGMAJOR="$v"
  [ -n "$PGMAJOR" ] || PGMAJOR="$v"
done
PGMAJOR="${PGMAJOR:-16}"

if ! docker ps -a --format '{{.Names}}' | grep -qx "$C"; then
  echo "== starting $C (postgres:$PGMAJOR) on 127.0.0.1:$PORT"
  docker run -d --name "$C" -e POSTGRES_PASSWORD=localtest -v db-setup-local-pgdata:/var/lib/postgresql/data -p 127.0.0.1:$PORT:5432 "postgres:$PGMAJOR" >/dev/null
else
  docker start "$C" >/dev/null
fi
for i in $(seq 1 40); do docker exec "$C" pg_isready -U postgres -q && break; sleep 1; done
sleep 2
docker exec "$C" psql -U postgres -qc "create role devuser" >/dev/null 2>&1 || true

for p in tiktok instagram; do
  db="${p}_local_test"; name="$(cat "$OUT/latest-$p")"
  exists="$(docker exec "$C" psql -U postgres -Atc "select 1 from pg_database where datname='$db'")"
  if [ -n "$exists" ]; then
    [ "$RECREATE" = 1 ] || { echo "STOP: $db already exists locally. Re-run with --recreate to replace it."; exit 1; }
    docker exec "$C" psql -U postgres -qc "drop database \"$db\" with (force)"
  fi
  docker exec "$C" psql -U postgres -qc "create database \"$db\""
  echo "== restoring $name into $db"
  docker exec -i "$C" pg_restore -U postgres -d "$db" --no-owner --no-acl --exit-on-error < "$OUT/$name/full.dump"
  if [ "$KEEP_HASHES" = 0 ]; then
    docker exec "$C" psql -U postgres -d "$db" -qc "update users set password_hash = 'blanked-in-local-copy'"
  fi
  echo "   rows: $(docker exec "$C" psql -U postgres -d "$db" -Atc "select 'users='||(select count(*) from users)||' projects='||(select count(*) from projects)||' posts='||(select count(*) from posts)")"
done

cat <<EOF

LOCAL COPY READY (client data, keep it local)
  tiktok    postgresql://postgres:localtest@127.0.0.1:$PORT/tiktok_local_test
  instagram postgresql://postgres:localtest@127.0.0.1:$PORT/instagram_local_test
Run the apps against it:   ./scripts/run-local-stack.sh
Refresh later:             ./scripts/pull-db-to-local.sh --recreate
Remove everything:         docker rm -f $C && docker volume rm db-setup-local-pgdata && rm -rf $OUT
EOF
