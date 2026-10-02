#!/usr/bin/env bash
#
# Sets up the backend API servers as systemd services so they keep running
# after you log out and auto-start on reboot. PostgreSQL stays a separate
# system service.
#
# Run it from the VM like this (NOT as root directly — pass the values in):
#
#   cd <project root that contains databases/tiktok>
#   sudo bash scripts/setup-services.sh "$PWD" "$(whoami)" "$(command -v node)"
#
# The three arguments are deliberate: they are evaluated as *you* before sudo
# takes over, so the services run as your user with your node, not as root.
#
# Which services get installed, on which ports, is read from services.conf.
#
set -euo pipefail

. "$(dirname "$0")/services.lib.sh"
load_services

# --- preconditions -----------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: this writes to /etc/systemd/system — re-run with sudo:"
  echo "  sudo bash $0 \"\$PWD\" \"\$(whoami)\" \"\$(command -v node)\""
  exit 1
fi

ROOT="${1:?Usage: sudo bash setup-services.sh <project-root> <run-user> <node-path>}"
RUN_USER="${2:?missing run user (pass \"\$(whoami)\")}"
NODE="${3:?missing node path (pass \"\$(command -v node)\")}"

id "$RUN_USER" >/dev/null 2>&1 || { echo "ERROR: no such user: $RUN_USER"; exit 1; }

# Resolve symlinks (fnm/nvm hand out temporary per-shell paths that vanish on
# reboot) down to the real, permanent node binary.
NODE="$(readlink -f "$NODE")"
[ -x "$NODE" ] || { echo "ERROR: not an executable node binary: $NODE"; exit 1; }
NODE_DIR="$(dirname "$NODE")"

# --- sanity check: make sure we're pointed at the real project ---------------
# Each service needs its entrypoint and its .env — the .env carries the DB
# credentials, and without it the server starts and then fails every query.
for entry in "${SERVICES[@]}"; do
  IFS='|' read -r unit port dir label kind public <<<"$entry"
  [ "$kind" = "api" ] || continue

  if [ ! -f "$ROOT/$dir/server.js" ]; then
    echo "ERROR: could not find $ROOT/$dir/server.js"
    echo "Run this from the project root (the folder containing databases/tiktok)."
    exit 1
  fi
  if [ ! -f "$ROOT/$dir/.env" ]; then
    echo "ERROR: no .env in $ROOT/$dir — copy .env.example and fill in the DB credentials."
    exit 1
  fi
done

write_unit() {
  local name="$1" desc="$2" dir="$3" port="$4"
  cat > "/etc/systemd/system/$name" <<EOF
[Unit]
Description=$desc
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$dir
Environment=NODE_ENV=production
# Authoritative port, from services.conf. dotenv does not override variables
# that are already set, so this wins over anything in the service's .env.
Environment=PORT=$port
Environment=PATH=$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$NODE server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  echo "  wrote /etc/systemd/system/$name (port $port)"
}

echo "Project root : $ROOT"
echo "Run as user  : $RUN_USER"
echo "Node binary  : $NODE"
echo "Writing service files..."

UNITS=()
for entry in "${SERVICES[@]}"; do
  IFS='|' read -r unit port dir label kind public <<<"$entry"
  [ "$kind" = "api" ] || continue

  write_unit "$unit.service" "$label backend API (port $port)" "$ROOT/$dir" "$port"
  UNITS+=("$unit.service")
done

if [ "${#UNITS[@]}" -eq 0 ]; then
  echo "ERROR: no api services in $SERVICES_CONF — nothing to install."
  exit 1
fi

echo "Enabling + starting services..."
systemctl daemon-reload
systemctl enable --now "${UNITS[@]}"
systemctl enable postgresql || echo "  (note: no 'postgresql' unit to enable — skip if Postgres starts another way)"

echo "----------------------------------------"
echo "Done. Current status:"
systemctl --no-pager --full status "${UNITS[@]}" 2>/dev/null | grep -E "●|Active:|Main PID:" || true
echo "----------------------------------------"
for entry in "${SERVICES[@]}"; do
  IFS='|' read -r unit port dir label kind public <<<"$entry"
  [ "$kind" = "api" ] || continue
  echo "Logs:    journalctl -u $unit -f"
  echo "Health:  curl localhost:$port/api/health"
done
echo "Restart: sudo $ROOT/restart-services.sh"
