#!/usr/bin/env bash
# Shared helpers for backup-db.sh and restore-db.sh. Source it; do not run it.
# Reads the LOCAL_DATABASE_URL from databases/<platform>/.env and never prints it
# (it contains the password).

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/backups}"

# Tables whose row counts go in the manifest and are compared after a restore.
# All of them exist in both the TikTok and the Instagram schema.
COUNT_TABLES="users projects posts project_posts user_scraped_posts comments post_metrics_history"

load_db() { # $1 = tiktok|instagram -> sets DB_URL, DB_NAME
  case "$1" in tiktok|instagram) ;; *) echo "platform must be tiktok or instagram"; return 1 ;; esac
  local env_file="$REPO_ROOT/databases/$1/.env"
  [ -f "$env_file" ] || { echo "Missing $env_file"; return 1; }
  DB_URL="$(grep -E '^LOCAL_DATABASE_URL=' "$env_file" | cut -d= -f2- | tr -d '"')"
  [ -n "$DB_URL" ] || { echo "LOCAL_DATABASE_URL not set in $env_file"; return 1; }
  DB_NAME="$(psql "$DB_URL" -Atc 'select current_database()')"
}

# Same server, different database name (for creating/dropping a scratch database).
url_for_db() { # $1 = db name
  local base="${DB_URL%/*}"
  echo "$base/$1"
}

# "table=count" lines, one per table in COUNT_TABLES, for the database at $1.
row_counts() { # $1 = url
  local t sql=""
  for t in $COUNT_TABLES; do
    [ -n "$sql" ] && sql="$sql union all "
    sql="${sql}select '$t', count(*) from $t"
  done
  psql "$1" -At -F= -c "$sql"
}
