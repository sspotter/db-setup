#!/usr/bin/env bash
#
# redeploy.sh — pull the latest code from GitHub and restart the backend
# services (tiksurfer :3030 + insta-surfer :3033) so they pick up the update.
#
# Use this after someone pushes to GitHub, or whenever you want this box to be
# up to date and running the newest code.
#
# Usage:
#   ./redeploy.sh              # git pull, then reinstall deps + restart
#   ./redeploy.sh --no-pull    # skip git pull, just reinstall + restart
#   ./redeploy.sh --restart    # ONLY restart the services (no pull, no install)
#
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

DO_PULL=1
DO_INSTALL=1
case "${1:-}" in
  --no-pull) DO_PULL=0 ;;
  --restart) DO_PULL=0; DO_INSTALL=0 ;;
  "")        ;;
  *) echo "Unknown option: $1"; echo "Use: --no-pull | --restart"; exit 1 ;;
esac

step() { echo; echo "==> $*"; }

# --- 1. pull latest code -----------------------------------------------------
if [ "$DO_PULL" = 1 ]; then
  step "git pull (latest from GitHub)"
  if ! git pull --ff-only; then
    echo "ERROR: git pull failed (uncommitted changes or non-fast-forward)."
    echo "Resolve it manually, then re-run with --no-pull."
    exit 1
  fi
fi

# --- 2. reinstall deps + regenerate Prisma client ----------------------------
# Schema/deps may have changed in the pull, so refresh both DB projects.
if [ "$DO_INSTALL" = 1 ]; then
  for db in tiktok instagram; do
    dir="$PROJECT_ROOT/databases/$db"
    [ -f "$dir/package.json" ] || continue

    step "npm install ($db)"
    ( cd "$dir" && npm install --omit=dev ) || { echo "npm install failed for $db"; exit 1; }

    if [ -f "$dir/prisma/schema.prisma" ]; then
      step "prisma generate ($db)"
      ( cd "$dir" && npx prisma generate ) || echo "  (prisma generate skipped/failed for $db)"
    fi
  done
fi

# --- 3. restart the systemd services -----------------------------------------
step "restart services (tiksurfer + insta-surfer)"
sudo systemctl restart tiksurfer insta-surfer

# give them a moment to come up before we check health
sleep 3

# --- 4. show the live status table -------------------------------------------
step "current status"
"$PROJECT_ROOT/status.sh"

echo
echo "Done. If a service shows 'db ✗' or 'no resp', check logs:"
echo "  journalctl -u tiksurfer -n 50 --no-pager"
echo "  journalctl -u insta-surfer -n 50 --no-pager"