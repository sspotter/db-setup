#!/usr/bin/env bash
#
# cleanup-cross-platform-posts.sh — remove posts that were saved into the wrong
# platform's database (TikTok posts in the Instagram DB, Instagram posts in the
# TikTok DB) after a mis-set extension API URL.
#
# Run it ON THE VM, from the repo root:
#   ./scripts/cleanup-cross-platform-posts.sh tiktok            # dry run (default): counts only, changes nothing
#   ./scripts/cleanup-cross-platform-posts.sh instagram         # dry run
#   ./scripts/cleanup-cross-platform-posts.sh tiktok --apply    # back up, then delete (asks you to type the DB name)
#
# What it removes: rows in `posts` whose post_url is on the OTHER platform's domain.
# Rows with no post_url, or an unrelated domain, are never touched. Dependent rows
# (project_posts, user_scraped_posts, comments, post_metrics_history, post_relations,
# scrape_jobs, comment_scrape_logs) go with them through ON DELETE CASCADE.
# ig_users owners, projects and users are kept.
#
# --apply order: (1) full pg_dump backup, (2) CSV of the affected posts, (3) delete in ONE
# transaction that rolls back unless the number deleted equals the number counted.
# Backups go to ~/backups/ on the VM. They hold client data: never copy them into git.
set -euo pipefail

PLATFORM="${1:-}"
APPLY=0
[ "${2:-}" = "--apply" ] && APPLY=1
case "$PLATFORM" in
  tiktok)    FOREIGN='instagram.com' ;;
  instagram) FOREIGN='tiktok.com' ;;
  *) echo "Usage: $0 tiktok|instagram [--apply]"; exit 1 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/databases/$PLATFORM/.env"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }
DB_URL="$(grep -E '^LOCAL_DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
[ -n "$DB_URL" ] || { echo "LOCAL_DATABASE_URL not set in $ENV_FILE"; exit 1; }
DB_NAME="$(psql "$DB_URL" -Atc 'select current_database()')"

# Posts whose host is exactly the foreign domain or a subdomain of it (same rule as platformGuard.js).
MATCH="post_url ~* '^https?://([^/]+\\.)?${FOREIGN//./\\.}(/|\$|:|\\?)'"

echo "== $PLATFORM backend, database: $DB_NAME  (removing $FOREIGN posts)"
psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
\echo '-- rows that would be removed'
select 'posts' as "table", count(*) from posts where $MATCH
union all select 'project_posts', count(*) from project_posts pp join posts p on p.shortcode = pp.post_shortcode where p.${MATCH}
union all select 'user_scraped_posts', count(*) from user_scraped_posts s join posts p on p.shortcode = s.post_shortcode where p.${MATCH}
union all select 'comments', count(*) from comments c join posts p on p.shortcode = c.post_shortcode where p.${MATCH}
union all select 'post_metrics_history', count(*) from post_metrics_history m join posts p on p.shortcode = m.post_shortcode where p.${MATCH};
\echo '-- by user'
select u.email, count(distinct p.shortcode) as posts
from posts p join user_scraped_posts s on s.post_shortcode = p.shortcode join users u on u.id = s.user_id
where p.${MATCH} group by 1 order by 2 desc;
SQL

EXPECTED="$(psql "$DB_URL" -Atc "select count(*) from posts where $MATCH")"
if [ "$APPLY" != 1 ]; then
  echo; echo "DRY RUN: nothing was changed. $EXPECTED post(s) match. Re-run with --apply to back up and delete."
  exit 0
fi
[ "$EXPECTED" -gt 0 ] || { echo "Nothing to delete."; exit 0; }

echo; read -r -p "Type the database name ($DB_NAME) to delete $EXPECTED post(s): " TYPED
[ "$TYPED" = "$DB_NAME" ] || { echo "Not confirmed. Nothing was changed."; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
BK="$HOME/backups/cross-platform-$PLATFORM-$STAMP"
mkdir -p "$BK"; chmod 700 "$BK"

echo "== 1/3 full backup -> $BK/full.dump"
pg_dump "$DB_URL" -Fc -f "$BK/full.dump"
pg_restore -l "$BK/full.dump" >/dev/null   # fails if the dump is unreadable
echo "== 2/3 affected posts -> $BK/removed_posts.csv"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "\\copy (select * from posts where $MATCH) to '$BK/removed_posts.csv' csv header"

echo "== 3/3 delete (one transaction)"
psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
begin;
with gone as (delete from posts where $MATCH returning 1)
select count(*) as deleted from gone \gset
\echo deleted :deleted, expected $EXPECTED
select (:deleted = $EXPECTED) as ok \gset
\if :ok
  commit;
  \echo COMMITTED
\else
  rollback;
  \echo ROLLED BACK: count mismatch, nothing deleted
\endif
SQL
echo "Done. Backup kept in $BK (restore with pg_restore if anything looks wrong)."
