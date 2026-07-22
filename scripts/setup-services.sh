#!/usr/bin/env bash
#
# Sets up the two backend API servers (tiktok :3030, insta :3033) as
# systemd services so they keep running after you log out and auto-start
# on reboot. PostgreSQL stays a separate system service.
#
# Run it from the VM like this (NOT as root directly — pass the values in):
#
#   cd <project root that contains databases/tiktok>
#   sudo bash setup-services.sh "$PWD" "$(whoami)" "$(command -v node)"
#
set -euo pipefail

ROOT="${1:?Usage: sudo bash setup-services.sh <project-root> <run-user> <node-path>}"
RUN_USER="${2:?missing run user (pass \"\$(whoami)\")}"
NODE="${3:?missing node path (pass \"\$(command -v node)\")}"
# Resolve symlinks (fnm/nvm hand out temporary per-shell paths that vanish on
# reboot) down to the real, permanent node binary.
NODE="$(readlink -f "$NODE")"
NODE_DIR="$(dirname "$NODE")"

# --- sanity check: make sure we're pointed at the real project ---
for f in "$ROOT/databases/tiktok/server.js" "$ROOT/databases/instagram/server.js"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: could not find $f"
    echo "Run this from the project root (the folder containing databases/tiktok)."
    exit 1
  fi
done

write_unit() {
  local name="$1" desc="$2" dir="$3"
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
Environment=PATH=$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$NODE server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  echo "  wrote /etc/systemd/system/$name"
}

echo "Project root : $ROOT"
echo "Run as user  : $RUN_USER"
echo "Node binary  : $NODE"
echo "Writing service files..."
write_unit tiksurfer.service    "Tik Surfer backend API (port 3030)"   "$ROOT/databases/tiktok"
write_unit insta-surfer.service "Insta Surfer backend API (port 3033)" "$ROOT/databases/instagram"

echo "Enabling + starting services..."
systemctl daemon-reload
systemctl enable --now tiksurfer.service insta-surfer.service
systemctl enable postgresql 2>/dev/null || echo "  (note: no 'postgresql' unit to enable — skip if Postgres starts another way)"

echo "----------------------------------------"
echo "Done. Current status:"
systemctl --no-pager --full status tiksurfer insta-surfer 2>/dev/null | grep -E "●|Active:|Main PID:" || true
echo "----------------------------------------"
echo "Logs:    journalctl -u tiksurfer -f"
echo "         journalctl -u insta-surfer -f"
echo "Restart: sudo systemctl restart tiksurfer insta-surfer"