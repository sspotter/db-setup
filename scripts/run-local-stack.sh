#!/usr/bin/env bash
#
# run-local-stack.sh — run both backends and the dashboard on localhost against the LOCAL database copy
# made by pull-db-to-local.sh. Real/cloud databases are never used: DATABASE_URL and
# RAILWAY_DATABASE_URL are blanked and the .env files cannot override what is set here.
#
#   ./scripts/run-local-stack.sh        Ctrl+C stops everything
#
#   Dashboard        http://localhost:18444           password: demo-dash
#   Instagram admin  http://localhost:18442/admin.html password: demo-admin
#   TikTok admin     http://localhost:18443/admin.html password: demo-admin
# (demo passwords, valid only for this local run; user password hashes in the copy are blanked)
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE=postgresql://postgres:localtest@127.0.0.1:55500
docker ps --format '{{.Names}}' | grep -qx db-setup-local-pg || { echo "Local database is not running. Run ./scripts/pull-db-to-local.sh first."; exit 1; }
for d in tiktok_local_test instagram_local_test; do
  docker exec db-setup-local-pg psql -U postgres -Atc "select 1 from pg_database where datname='$d'" | grep -q 1 || { echo "Missing $d. Run ./scripts/pull-db-to-local.sh."; exit 1; }
done

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; echo "stopped"; }
trap cleanup EXIT INT TERM

SAFE="DATABASE_URL= RAILWAY_DATABASE_URL= ADMIN_PASSWORD=demo-admin ADMIN_JWT_SECRET=local-admin-jwt-secret JWT_SECRET=local-jwt-secret HOST=127.0.0.1"
( cd "$ROOT/databases/instagram" && env $SAFE PORT=18442 LOCAL_DATABASE_URL=$BASE/instagram_local_test node server.js ) & PIDS+=($!)
( cd "$ROOT/databases/tiktok"    && env $SAFE PORT=18443 LOCAL_DATABASE_URL=$BASE/tiktok_local_test node server.js ) & PIDS+=($!)
( cd "$ROOT/dashboard" && env PORT=18444 HOST=127.0.0.1 DASHBOARD_PASSWORD=demo-dash \
    TIK_URL=http://127.0.0.1:18443 TIK_ADMIN_PASSWORD=demo-admin INSTA_URL=http://127.0.0.1:18442 INSTA_ADMIN_PASSWORD=demo-admin \
    TIK_ADMIN_URL=http://127.0.0.1:18443 INSTA_ADMIN_URL=http://127.0.0.1:18442 node server.js ) & PIDS+=($!)
sleep 6
echo
echo "LOCAL STACK (copy of production data; keep it local)"
echo "  Dashboard        http://localhost:18444             password: demo-dash"
echo "  Instagram admin  http://localhost:18442/admin.html   password: demo-admin"
echo "  TikTok admin     http://localhost:18443/admin.html   password: demo-admin"
echo "  Ctrl+C stops everything."
wait
