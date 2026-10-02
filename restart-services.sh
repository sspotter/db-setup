#!/usr/bin/env bash
#
# restart-services.sh — restart the backend API services and KEEP them healthy.
#
# Restarts tiksurfer (:8443) and insta-surfer (:8442), then verifies each one
# actually answers on `curl http://localhost:<port>/api/health`, retrying until
# it does. This exists because the monitoring extension marks a service dead
# when localhost gives "no response" — which happened when tiktok bound the
# wrong interface, or when a stale orphaned node process squatted on the port.
#
# It defends against both:
#   * stale bind  — kills leftover `node server.js` processes for a service
#                   (matched by working dir, so tailscaled/postgres are never
#                   touched) before starting, freeing the port.
#   * bad bind    — if a unit is active but localhost doesn't answer, it
#                   restarts and retries instead of leaving it "up but dead".
#
# Usage:
#   ./restart-services.sh            # restart both, verify, report
#   ./restart-services.sh tiksurfer  # restart just one unit
#
set -uo pipefail

# Unit names, ports and directories come from scripts/services.conf.
. "$(dirname "$0")/scripts/services.lib.sh"
load_services || exit 1

RETRIES=6        # health attempts per service
SLEEP=2          # seconds between attempts

# If an argument is given, restart only the matching unit.
FILTER="${1:-}"

step() { echo; echo "==> $*"; }

# Kill leftover `node server.js` processes for a service that systemd is not
# tracking (orphans that keep the port bound). Safe: it only ever kills node
# processes whose cwd is this service's directory — never tailscaled/postgres.
kill_stale() {
  local unit="$1" dir="$2" mainpid pid cwd
  mainpid="$(systemctl show -p MainPID --value "$unit" 2>/dev/null || echo 0)"
  dir="$(readlink -f "$dir" 2>/dev/null || echo "$dir")"
  for pid in $(pgrep -f 'node .*server\.js' 2>/dev/null); do
    [ "$pid" = "$mainpid" ] && continue
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [ "$cwd" = "$dir" ]; then
      echo "   freeing port: killing stale $unit process (pid $pid, cwd=$cwd)"
      sudo kill "$pid" 2>/dev/null || true
      sleep 1
      kill -0 "$pid" 2>/dev/null && sudo kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

overall_ok=1

for entry in "${SERVICES[@]}"; do
  IFS='|' read -r unit port dir label kind public <<<"$entry"
  [ "$kind" = "api" ] || continue
  [ -n "$FILTER" ] && [ "$FILTER" != "$unit" ] && continue

  step "restarting $label ($unit, localhost:$port)"

  # Clear any orphan holding the port, then hand control back to systemd.
  kill_stale "$unit" "$REPO_ROOT/$dir"
  sudo systemctl restart "$unit"

  ok=0
  for ((i=1; i<=RETRIES; i++)); do
    sleep "$SLEEP"

    if ! systemctl is-active --quiet "$unit"; then
      echo "   [$i/$RETRIES] $unit not active — restarting"
      kill_stale "$unit" "$REPO_ROOT/$dir"
      sudo systemctl restart "$unit"
      continue
    fi

    body="$(health_body "$port")"
    if health_says_db_connected "$body"; then
      echo "   ✓ $label healthy — localhost:$port/api/health responding, db connected"
      ok=1; break
    elif [ -n "$body" ]; then
      # Server answers but DB isn't connected. Restarting won't fix the DB,
      # so report it and stop hammering the service.
      echo "   ⚠ $label is up on localhost:$port but DB not connected:"
      echo "     $body"
      ok=2; break
    else
      echo "   [$i/$RETRIES] $label active but no response on localhost:$port — restarting"
      sudo systemctl restart "$unit"
    fi
  done

  if [ "$ok" = 0 ]; then
    echo "   ✗ $label FAILED to answer on localhost:$port after $RETRIES attempts"
    echo "     check: journalctl -u $unit -n 40 --no-pager"
    overall_ok=0
  elif [ "$ok" = 2 ]; then
    overall_ok=0
  fi
done

step "listeners"
API_PORTS=()
for entry in "${SERVICES[@]}"; do
  IFS='|' read -r unit port dir label kind public <<<"$entry"
  [ "$kind" = "api" ] && API_PORTS+=(":$port")
done
PORT_PATTERN="$(IFS='|'; echo "${API_PORTS[*]}")"
sudo ss -tlnp 2>/dev/null | grep -E "$PORT_PATTERN" || echo "   (none found on ${API_PORTS[*]})"

echo
if [ "$overall_ok" = 1 ]; then
  echo "All requested services are up and answering on localhost. ✓"
else
  echo "One or more services need attention (see above)."
  exit 1
fi
