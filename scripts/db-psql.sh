#!/usr/bin/env bash
#
# db-psql.sh — runs ON THE VM. Opens psql on the TikTok or Instagram database.
# Normally started by db-shell.ps1 (which copies this file to the VM and runs it over SSH).
#
#   db-psql.sh tiktok|instagram                 interactive psql, READ-ONLY
#   db-psql.sh tiktok -f -                      run SQL from stdin, READ-ONLY
#   db-psql.sh tiktok --write                   interactive, can change data (asks to confirm)
#
# Read-only is enforced by the database session (default_transaction_read_only=on), so an
# UPDATE / DELETE / INSERT fails with "cannot execute ... in a read-only transaction".
# The database URL is read from databases/<platform>/.env here on the VM and never printed.
set -euo pipefail

PLATFORM="${1:-}"; shift || true
case "$PLATFORM" in tiktok|instagram) ;; *) echo "Usage: $0 tiktok|instagram [--write] [psql args]"; exit 1 ;; esac

WRITE=0
ARGS=()
for a in "$@"; do [ "$a" = "--write" ] && WRITE=1 || ARGS+=("$a"); done

ENV_FILE="${DB_SETUP_DIR:-$HOME/databases/db-setup}/databases/$PLATFORM/.env"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }
DB_URL="$(grep -E '^LOCAL_DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
[ -n "$DB_URL" ] || { echo "LOCAL_DATABASE_URL not set in $ENV_FILE"; exit 1; }
DB_NAME="$(psql "$DB_URL" -Atc 'select current_database()')"

if [ "$WRITE" = 1 ]; then
  echo "!! WRITE MODE on $PLATFORM ($DB_NAME): changes are real and immediate."
  echo "!! Take a backup first: ./scripts/backup-db.sh $PLATFORM"
  [ -t 0 ] || { echo "Write mode needs an interactive terminal."; exit 1; }
  read -r -p "Type the database name to continue: " T
  [ "$T" = "$DB_NAME" ] || { echo "Not confirmed."; exit 1; }
else
  export PGOPTIONS="-c default_transaction_read_only=on"
  [ -t 0 ] && echo "Connected to $PLATFORM ($DB_NAME), READ-ONLY. Try:  \\dt   \\d posts   select count(*) from posts;   \\q to quit"
fi

exec psql "$DB_URL" -v ON_ERROR_STOP=0 "${ARGS[@]}"
