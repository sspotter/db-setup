#!/usr/bin/env bash
#
# status.sh — live status of the db-setup backend services, as a boxed table.
# Shows, for each service: systemd/port status, the local (localhost) URL and
# the public Tailscale Funnel URL.
#
#   ./status.sh
#
# The service list lives in services.conf — add a row there, not here.
#
set -uo pipefail

# The ✓/✗/· status marks and every box glyph are multi-byte, and the column
# maths below measures with ${#var} — which counts bytes under a C locale and
# shears the table. Deliberately NOT exported: bash re-reads its locale on
# assignment either way, and exporting would push it onto npm/git/prisma when
# redeploy.sh runs. If C.UTF-8 is unavailable bash falls back to C, as before.
LC_ALL="${LC_ALL:-C.UTF-8}"

. "$(dirname "$0")/services.lib.sh"
load_services || exit 1

# --- gather rows -------------------------------------------------------------
HEADER=("Service" "Port" "Status" "Local URL" "Public URL (Tailscale)")
ROWS=()

for entry in "${SERVICES[@]}"; do
  IFS='|' read -r unit port dir label kind public <<<"$entry"

  if [ "$kind" = "api" ]; then
    state="$(systemctl is-active "$unit" 2>/dev/null)"
    [ -n "$state" ] || state="unknown"     # active / inactive / failed / ...

    resp="$(health_body "$port")"
    if health_says_db_connected "$resp"; then status="$state · db ✓"
    elif [ -n "$resp" ];                  then status="$state · db ✗"
    else                                       status="$state · no resp"
    fi

    local_url="http://localhost:$port/api"
    [ -n "$public" ] && public_url="$public/api" || public_url="(not exposed)"
  else
    code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://localhost:$port" 2>/dev/null)"
    case "$code" in
      200|302|307) status="running" ;;
      *)           status="stopped" ;;
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

# Padding is computed from ${#text} (characters) and emitted as explicit spaces
# rather than handed to printf's '%-*s' width, which counts *bytes*. The status
# marks (· ✓ ✗) are multi-byte, so the two disagree and the box shears.
center() {  # $1=text $2=width  -> text centered in exactly width chars
  local text=$1 width=$2 len total left right
  len=${#text}
  total=$(( width - len )); (( total < 0 )) && total=0
  left=$(( total / 2 )); right=$(( total - left ))
  printf '%*s%s%*s' "$left" '' "$text" "$right" ''
}

pad_right() {  # $1=text $2=width -> text left-aligned in exactly width chars
  local text=$1 width=$2 pad
  pad=$(( width - ${#text} )); (( pad < 0 )) && pad=0
  printf '%s%*s' "$text" "$pad" ''
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
    else                       out+=" $(pad_right "$cell" "${WIDTHS[i]}") │"; fi
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
