#!/usr/bin/env bash
#
# generate-ops.sh — Generate OPERATIONS.md and status.sh from a project config JSON.
#
# Usage:
#   ./generate-ops.sh <config.json> [output-dir]
#
# Config format (see example-ops-config.json):
#   {
#     "project_name": "...",
#     "project_description": "...",
#     "host_ip": "...",
#     "services": [
#       {"name": "...", "port": 3000, "health_endpoint": "/api/health"}
#     ],
#     "database": {"type": "PostgreSQL", "port": 5432},
#     "prisma_studios": [
#       {"database": "TikTok", "port": 5555}
#     ]
#   }
#
set -euo pipefail

CONFIG_FILE="${1:?Usage: $0 <config.json> [output-dir]}"
OUTPUT_DIR="${2:-.}"

[ -f "$CONFIG_FILE" ] || { echo "ERROR: config file not found: $CONFIG_FILE"; exit 1; }
[ -d "$OUTPUT_DIR" ] || { echo "ERROR: output directory not found: $OUTPUT_DIR"; exit 1; }

# Parse JSON (bash + jq, or fallback grep-based parser)
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required. Install with: sudo apt install jq"
  exit 1
fi

# --- extract config values ---
PROJECT_NAME="$(jq -r '.project_name' "$CONFIG_FILE")"
PROJECT_DESC="$(jq -r '.project_description // ""' "$CONFIG_FILE")"
HOST_IP="$(jq -r '.host_ip // "100.115.149.3"' "$CONFIG_FILE")"
DB_TYPE="$(jq -r '.database.type // "PostgreSQL"' "$CONFIG_FILE")"
DB_PORT="$(jq -r '.database.port // 5432' "$CONFIG_FILE")"

echo "Generating ops for: $PROJECT_NAME"
echo "  Output dir: $OUTPUT_DIR"
echo

# --- generate status.sh ------
STATUS_SCRIPT="$OUTPUT_DIR/status.sh"

cat > "$STATUS_SCRIPT" <<'STATUSEOF'
#!/usr/bin/env bash
set -uo pipefail
HOST_IP="HOST_IP_PLACEHOLDER"
PROJECT_NAME="PROJECT_NAME_PLACEHOLDER"
SERVICES=()
SERVICES_JSON='SERVICES_JSON_PLACEHOLDER'

# Parse services from JSON
while IFS='|' read -r unit port endpoint; do
  [ -n "$unit" ] && SERVICES+=("$unit|$port|$endpoint")
done < <(echo "$SERVICES_JSON" | while read -r line; do echo "$line"; done)

HEADER=("Service" "Port" "Status" "Health check")
ROWS=()

for entry in "${SERVICES[@]}"; do
  IFS='|' read -r unit port endpoint <<<"$entry"

  state="$(systemctl is-active "$unit" 2>/dev/null || echo 'not-installed')"
  case "$state" in
    active) status="active (running)" ;;
    "")     status="not installed" ;;
    *)      status="$state" ;;
  esac

  if [ -n "$endpoint" ] && [ "$endpoint" != "null" ]; then
    health="$(curl -s -m 5 "http://localhost:$port$endpoint" 2>/dev/null | sed -E 's/,"serverTime":"[^"]*"//')"
    [ -z "$health" ] && health="(no response)"
  else
    code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://localhost:$port" 2>/dev/null)"
    case "$code" in
      200|302|307) health="up" ;;
      *)           health="(not reachable)" ;;
    esac
  fi

  ROWS+=("$unit|$port|$status|$health")
done

NCOL=4
WIDTHS=(0 0 0 0)
absorb() {
  local i=0 cell; local -a cells
  IFS='|' read -ra cells <<<"$1"
  for cell in "${cells[@]}"; do (( ${#cell} > WIDTHS[i] )) && WIDTHS[i]=${#cell}; i=$((i+1)); done
}
absorb "$(IFS='|'; echo "${HEADER[*]}")"
for r in "${ROWS[@]}"; do absorb "$r"; done

repeat() { local n=$1 s=$2 out=''; while (( n-- > 0 )); do out+="$s"; done; printf '%s' "$out"; }
center() {
  local text=$1 width=$2 len=${#1} total left right
  total=$(( width - len )); (( total < 0 )) && total=0
  left=$(( total / 2 )); right=$(( total - left ))
  printf '%*s%s%*s' "$left" '' "$text" "$right" ''
}

border() {
  local i out=$1
  for (( i=0; i<NCOL; i++ )); do
    out+="$(repeat $((WIDTHS[i]+2)) '─')"
    (( i < NCOL-1 )) && out+="$2" || out+="$3"
  done
  printf '%s\n' "$out"
}

row() {
  local i out='│' cell; local -a cells
  IFS='|' read -ra cells <<<"$1"
  for (( i=0; i<NCOL; i++ )); do
    cell="${cells[i]:-}"
    if [ "$2" = center ]; then out+=" $(center "$cell" "${WIDTHS[i]}") │"
    else                       out+="$(printf ' %-*s ' "${WIDTHS[i]}" "$cell")│"; fi
  done
  printf '%s\n' "$out"
}

border '┌' '┬' '┐'
row "$(IFS='|'; echo "${HEADER[*]}")" center
border '├' '┼' '┤'
last=$(( ${#ROWS[@]} - 1 ))
for i in "${!ROWS[@]}"; do
  row "${ROWS[i]}" left
  (( i < last )) && border '├' '┼' '┤'
done
border '└' '┴' '┘'
STATUSEOF

chmod +x "$STATUS_SCRIPT"

# --- generate OPERATIONS.md --
OPS_MD="$OUTPUT_DIR/OPERATIONS.md"

# Build service table
SERVICE_TABLE="┌──────────────┬──────┬──────────────────┬────────────────────────────────────┐
│   Service    │ Port │      Status      │          Health check              │
├──────────────┼──────┼──────────────────┼────────────────────────────────────┤"

jq -r '.services[] | "\(.name)\t\(.port)"' "$CONFIG_FILE" | while read -r name port; do
  SERVICE_TABLE+="
│ $(printf '%-12s' "$name") │ $(printf '%4d' "$port") │ active (running) │ {...}                          │
├──────────────┼──────┼──────────────────┼────────────────────────────────────┤"
done

SERVICE_TABLE="$(echo "$SERVICE_TABLE" | sed '$ s/├──────────────┼──────┼──────────────────┼────────────────────────────────────┤/└──────────────┴──────┴──────────────────┴────────────────────────────────────┘/')"

# Port table
PORT_TABLE="| Component | Port | Purpose |
|---|---|---|"

jq -r '.services[] | "| \(.name) | \(.port) | \(.description // "API") |"' "$CONFIG_FILE" >> /tmp/port_table.tmp
[ -f /tmp/port_table.tmp ] && PORT_TABLE+="$(cat /tmp/port_table.tmp)" && rm /tmp/port_table.tmp

echo "| $DB_TYPE | $DB_PORT | Database |" >> /tmp/port_table.tmp
jq -r '.prisma_studios[]? | "| \(.database) Studio | \(.port) | Database UI |"' "$CONFIG_FILE" >> /tmp/port_table.tmp
[ -f /tmp/port_table.tmp ] && PORT_TABLE+="$(cat /tmp/port_table.tmp)" && rm /tmp/port_table.tmp

cat > "$OPS_MD" <<OPSEOF
# $PROJECT_NAME — Operations Guide

$PROJECT_DESC

---

## Quick Status

Run **\`./status.sh\`** to see live service status and health:

\`\`\`bash
./status.sh
\`\`\`

---

## Services Overview

$SERVICE_TABLE

---

## All Ports

$PORT_TABLE

---

## Service Management

### Check status
\`\`\`bash
./status.sh                                      # live table
systemctl status $(jq -r '.services[0].name' "$CONFIG_FILE")                # one service
\`\`\`

### View logs
\`\`\`bash
journalctl -u $(jq -r '.services[0].name' "$CONFIG_FILE") -f                # live logs
journalctl -u $(jq -r '.services[0].name' "$CONFIG_FILE") --since -1h       # last hour
\`\`\`

### Restart services
\`\`\`bash
sudo systemctl restart $(jq -r '.services | map(.name) | join(" ")' "$CONFIG_FILE")
\`\`\`

### Stop / Start
\`\`\`bash
sudo systemctl stop $(jq -r '.services[0].name' "$CONFIG_FILE")
sudo systemctl start $(jq -r '.services[0].name' "$CONFIG_FILE")
\`\`\`

---

## Database

**Type:** $DB_TYPE
**Port:** $DB_PORT

OPSEOF

# Prisma Studio section if configured
if jq -e '.prisma_studios[]?' "$CONFIG_FILE" &>/dev/null; then
  cat >> "$OPS_MD" <<'PRISMAEOF'

### Prisma Studio

Database UI on ports:
PRISMAEOF
  jq -r '.prisma_studios[] | "- **\(.database):** http://$HOST_IP:\(.port)"' "$CONFIG_FILE" >> "$OPS_MD"
fi

cat >> "$OPS_MD" <<'FOOTEOF'

---

## Deploy & Restart

```bash
cd /home/medpush/databases/db-setup
git pull
sudo systemctl restart <service-name>
```

FOOTEOF

echo "✓ generated $STATUS_SCRIPT"
echo "✓ generated $OPS_MD"
echo
echo "Next:"
echo "  ./status.sh          # verify services"
echo "  less $OPS_MD         # read the guide"