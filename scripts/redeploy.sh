#!/usr/bin/env bash
#
# redeploy.sh — pull the latest code from GitHub and restart the backend
# services so they pick up the update.
#
# Use this after someone pushes to GitHub, or whenever you want this box to be
# up to date and running the newest code.
#
# Usage:
#   ./redeploy.sh              # git pull, then reinstall deps + restart
#   ./redeploy.sh --no-pull    # skip git pull, just reinstall + restart
#   ./redeploy.sh --restart    # ONLY restart the services (no pull, no install)
#
# Service names, ports and directories come from services.conf.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/services.lib.sh"
load_services || exit 1

cd "$REPO_ROOT" || { echo "ERROR: cannot enter $REPO_ROOT"; exit 1; }

DO_PULL=1
DO_INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=0 ;;
    --restart) DO_PULL=0; DO_INSTALL=0 ;;
    *) echo "Unknown option: $arg"; echo "Use: --no-pull | --restart"; exit 1 ;;
  esac
done

step() { echo; echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

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
# Schema/deps may have changed in the pull, so refresh every API project.
if [ "$DO_INSTALL" = 1 ]; then
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r unit port dir label kind public <<<"$entry"
    [ "$kind" = "api" ] || continue

    project="$REPO_ROOT/$dir"
    # A missing project directory means services.conf and the checkout disagree.
    # Skipping quietly here is what previously let this whole step no-op.
    [ -f "$project/package.json" ] || fail "no package.json in $project (check services.conf)"

    step "npm install ($label)"
    ( cd "$project" && npm install --omit=dev ) || fail "npm install failed for $label"

    if [ -f "$project/prisma/schema.prisma" ]; then
      # A stale client throws on every query at runtime, so this is as fatal as
      # a failed install — the service would start and then fail every request.
      step "prisma generate ($label)"
      ( cd "$project" && npx prisma generate ) || fail "prisma generate failed for $label"
    fi
  done
fi

# --- 3. restart the services -------------------------------------------------
# Delegated to restart-services.sh, which clears orphaned processes squatting
# the port and retries until each service actually answers on localhost. A bare
# `systemctl restart` leaves services "up but dead" — see
# FIX-tiktok-8443-binding.md.
step "restart services"
restart_status=0
"$REPO_ROOT/restart-services.sh" || restart_status=$?

# --- 4. show the live status table -------------------------------------------
step "current status"
"$SCRIPT_DIR/status.sh"

if [ "$restart_status" -ne 0 ]; then
  echo
  echo "Redeploy finished, but at least one service is unhealthy. Check logs:"
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r unit port dir label kind public <<<"$entry"
    [ "$kind" = "api" ] && echo "  journalctl -u $unit -n 50 --no-pager"
  done
  exit 1
fi

echo
echo "Done. All services are up and answering on localhost."
