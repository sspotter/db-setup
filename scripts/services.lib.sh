#!/usr/bin/env bash
#
# services.lib.sh — shared helpers for reading the service inventory.
#
# Source it, then call load_services:
#
#   . "$(dirname "$0")/services.lib.sh"
#   load_services
#   for entry in "${SERVICES[@]}"; do
#     IFS='|' read -r unit port dir label kind public <<<"$entry"
#   done
#
# It sets REPO_ROOT, HOST_IP and FUNNEL_HOST, and load_services fills SERVICES
# with "unit|port|dir|label|kind|public" entries. `dir` stays relative to the
# repo root — callers join it themselves, because setup-services.sh installs
# against an explicitly supplied root rather than this checkout.

# This file lives in scripts/, so the repo root is one level up. Deriving it
# from the library rather than from $0 means callers work from any directory
# and at any depth.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICES_CONF="$REPO_ROOT/scripts/services.conf"

HOST_IP="100.115.149.3"
FUNNEL_HOST="medpush-virtual-machine.tail3e5104.ts.net"

SERVICES=()

load_services() {
  if [ ! -f "$SERVICES_CONF" ]; then
    echo "ERROR: service inventory not found: $SERVICES_CONF" >&2
    return 1
  fi

  local unit port dir label kind public
  while IFS='|' read -r unit port dir label kind public; do
    case "$unit" in ''|'#'*) continue ;; esac
    public="${public//\{funnel\}/$FUNNEL_HOST}"
    SERVICES+=("$unit|$port|$dir|$label|$kind|$public")
  done < "$SERVICES_CONF"

  if [ "${#SERVICES[@]}" -eq 0 ]; then
    echo "ERROR: no services defined in $SERVICES_CONF" >&2
    return 1
  fi
}

# Health body for a localhost port, or empty if the service did not answer.
health_body() { curl -s -m 5 "http://localhost:$1/api/health" 2>/dev/null; }

# True when a health body reports a live database. Tolerates the whitespace
# variations JSON serialisers differ on, which a literal substring match does
# not.
health_says_db_connected() {
  printf '%s' "$1" | grep -Eq '"database"[[:space:]]*:[[:space:]]*"connected"'
}
