Saved as setup-services.sh in your repo. Now here's the 2-paste setup to run on the VM.

Step 1 — SSH in and go to the project root

ssh testuser@100.115.149.3
cd ~/path/to/db-setup     # the folder that contains the "databases" subfolder

(If you're not sure of the path, run find ~ -name server.js -path '*tiktok*' 2>/dev/null — the project root is the part before /databases/tiktok/server.js.)

Step 2 — Create the script on the VM (paste this whole block)

cat > setup-services.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:?Usage: sudo bash setup-services.sh <root> <user> <node>}"
RUN_USER="${2:?missing user}"
NODE="${3:?missing node}"
NODE_DIR="$(dirname "$NODE")"
for f in "$ROOT/databases/tiktok/server.js" "$ROOT/databases/instagram/server.js"; do
  [ -f "$f" ] || { echo "ERROR: not found: $f — run from project root"; exit 1; }
done
write_unit() {
  cat > "/etc/systemd/system/$1" <<EOF
[Unit]
Description=$2
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$3
Environment=NODE_ENV=production
Environment=PATH=$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$NODE server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  echo "  wrote /etc/systemd/system/$1"
}
write_unit tiksurfer.service    "Tik Surfer backend API (port 3030)"   "$ROOT/databases/tiktok"
write_unit insta-surfer.service "Insta Surfer backend API (port 3033)" "$ROOT/databases/instagram"
systemctl daemon-reload
systemctl enable --now tiksurfer.service insta-surfer.service
systemctl enable postgresql 2>/dev/null || echo "  (no 'postgresql' unit — skip)"
echo "----- status -----"
systemctl --no-pager status tiksurfer insta-surfer 2>/dev/null | grep -E "Active:|Main PID:" || true
SCRIPT

Step 3 — Run it (one line; it asks for your sudo password)

sudo bash setup-services.sh "$PWD" "$(whoami)" "$(command -v node)"

Notice the three arguments — that's deliberate. They're evaluated as you before sudo, so the services run as your user with your node, not as root.

What you should see

Two lines saying wrote /etc/systemd/system/..., then Active: active (running) for both. Now close the terminal — they keep running, and they'll come back automatically after a reboot.

Verify it worked

curl localhost:3030/health   # tiktok
curl localhost:3033/health   # insta

Everyday commands

journalctl -u tiksurfer -f                    # live logs (like the old terminal output)
journalctl -u insta-surfer -f
sudo systemctl restart tiksurfer insta-surfer # after you change code / git pull
sudo systemctl stop tiksurfer                 # stop one

Paste back the output of Step 3 if anything doesn't say active (running) and I'll sort it out. Want me to commit setup-services.sh to the repo too?