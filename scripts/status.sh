#!/usr/bin/env bash
#
# status.sh — live status of the db-setup backend services, as a boxed table.
# Shows, for each service: systemd/port status, the local (localhost) URL and
# the public Tailscale Funnel URL.
#
#   ./status.sh
#
# Add a row by appending "unit|port|kind|public-base" to SERVICES below.
#   kind        = api    -> curl /api/health, local URL ends in /api
#               = studio -> just check the port is reachable
#   public-base = full https Funnel base (e.g. https://host:8443), or empty
#                 if the service is NOT exposed to the public internet.
#
set -uo pipefail

HOST_IP="100.115.149.3"
FUNNEL_HOST="medpush-virtual-machine.tail3e5104.ts.net"

# "systemd-unit|port|kind|public-base"
SERVICES=(
  "tiksurfer|3030|api|https://$FUNNEL_HOST:8443"
  "insta-surfer|3033|api|https://$FUNNEL_HOST"
  "prisma-tiktok|5555|studio|https://$FUNNEL_HOST:5555"
  "prisma-insta|5556|studio|"
)

# --- gather rows -------------------------------------------------------------
HEADER=("Service" "Port" "Status" "Local URL" "Public URL (Tailscale)")
ROWS=()

for entry in "${SERVICES[@]}"; do
  IFS='|' read -r unit port kind public <<<"$entry"

  if [ "$kind" = "api" ]; then
    state="$(systemctl is-active "$unit" 2>/dev/null)"
    case "$state" in
      active) status="active" ;;
      "")     status="not installed" ;;
      *)      status="$state" ;;          # inactive / failed / activating ...
    esac

    resp="$(curl -s -m 5 "http://localhost:$port/api/health" 2>/dev/null)"
    if echo "$resp" | grep -q '"database":"connected"'; then status="$status · db ✓"
    elif [ -n "$resp" ];                                 then status="$status · db ✗"
    else                                                      status="$status · no resp"
    fi

    local_url="http://localhost:$port/api"
    [ -n "$public" ] && public_url="$public/api" || public_url="(not exposed)"
  else
    code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://localhost:$port" 2>/dev/null)"
    case "$code" in
      200|302|307) status="running" ;;
      *)           status="stopped (./run-prisma.sh)" ;;
    esac

    local_url="http://localhost:$port"
    [ -n "$public" ] && public_url="$public/" || public_url="(not exposed)"
  fi

  ROWS+=("$unit|$port|$status|$local_url|$public_url")
done

# --- column widths -----------------------------------------------------------
NCOL=${#HEADER[@]}
WIDTHS=(); for ((i=0;i<NCOL;i++)); do WIDTHS+=(0); done
absorb() {
  local i=0 cell; local -a cells
  IFS='|' read -ra cells <<<"$1"
  for cell in "${cells[@]}"; do (( ${#cell} > WIDTHS[i] )) && WIDTHS[i]=${#cell}; i=$((i+1)); done
}
absorb "$(IFS='|'; echo "${HEADER[*]}")"
for r in "${ROWS[@]}"; do absorb "$r"; done

# --- drawing helpers ---------------------------------------------------------
repeat() { local n=$1 s=$2 out=''; while (( n-- > 0 )); do out+="$s"; done; printf '%s' "$out"; }

center() {  # $1=text $2=width  -> text centered in exactly width chars
  local text=$1 width=$2 len=${#1} total left right
  total=$(( width - len )); (( total < 0 )) && total=0
  left=$(( total / 2 )); right=$(( total - left ))
  printf '%*s%s%*s' "$left" '' "$text" "$right" ''
}

border() {  # $1=left $2=junction $3=right
  local i out=$1
  for (( i=0; i<NCOL; i++ )); do
    out+="$(repeat $((WIDTHS[i]+2)) '─')"
    (( i < NCOL-1 )) && out+="$2" || out+="$3"
  done
  printf '%s\n' "$out"
}

row() {  # $1=pipe-delimited cells  $2=align(left|center)
  local i out='│' cell; local -a cells
  IFS='|' read -ra cells <<<"$1"
  for (( i=0; i<NCOL; i++ )); do
    cell="${cells[i]:-}"
    if [ "$2" = center ]; then out+=" $(center "$cell" "${WIDTHS[i]}") │"
    else                       out+="$(printf ' %-*s ' "${WIDTHS[i]}" "$cell")│"; fi
  done
  printf '%s\n' "$out"
}

# --- render ------------------------------------------------------------------
border '┌' '┬' '┐'
row "$(IFS='|'; echo "${HEADER[*]}")" center
border '├' '┼' '┤'
last=$(( ${#ROWS[@]} - 1 ))
for i in "${!ROWS[@]}"; do
  row "${ROWS[i]}" left
  (( i < last )) && border '├' '┼' '┤'
done
border '└' '┴' '┘'

# --- footer: raw DB connection (kept private, never funneled) ----------------
echo
echo "PostgreSQL (private, tailnet only): postgres://…@$HOST_IP:5432"