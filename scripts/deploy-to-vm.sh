#!/usr/bin/env bash
#
# deploy-to-vm.sh — put the committed code of this repo on the production VM WITHOUT a git pull.
#
# Run it LOCALLY (Git Bash) from the repo root, with the work committed on main:
#   ./scripts/deploy-to-vm.sh --dry-run            checks only; nothing on the VM is changed
#   ./scripts/deploy-to-vm.sh                      apply the code and restart the three services
#   ./scripts/deploy-to-vm.sh --migrate            also back up both databases and apply the pending
#                                                  migrations (TikTok v6-v10, Instagram v7-v11), then add
#                                                  ADMIN_JWT_SECRET if missing. A deploy whose patch ADDS a
#                                                  migration file refuses to run without --migrate.
#   ./scripts/deploy-to-vm.sh --rollback           undo the last deploy made by this script
#
# How it works: it asks the VM which commit it runs, builds a patch from that commit to your HEAD
# (committed files only, so untracked captures such as ig-*.json can never ride along), checks it
# applies, applies it as UNCOMMITTED changes on the VM, restarts the services and checks health.
# Once the same commit reaches the VM's origin, free the files first (git checkout -- .), then pull.
#
# Migrations are idempotent here: each one is skipped when its table/column already exists.
# They only ADD tables and columns. Nothing is dropped. Passwords and URLs are never printed.
set -euo pipefail

VM="${VM_HOST:-medpush@100.115.149.3}"
VM_DIR="${VM_DIR:-databases/db-setup}"          # relative to the VM user's home
SERVICES="tiksurfer insta-surfer tiksurfer-dashboard"
PATCH_ON_VM="/tmp/db-setup-last-deploy.patch"

DRY=0; MIGRATE=0; ROLLBACK=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;; --migrate) MIGRATE=1 ;; --rollback) ROLLBACK=1 ;;
    -h|--help) sed -n '3,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a"; exit 1 ;;
  esac
done

remote() { ssh -o BatchMode=yes "$VM" "cd \"\$HOME/$VM_DIR\" && $*"; }
restart_and_check() {
  echo "== restarting $SERVICES (sudo asks for the VM password)"
  ssh -t "$VM" "sudo systemctl restart $SERVICES"
  sleep 4
  for p in 8443 8442 8444; do
    code="$(remote "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$p/api/health" || true)"
    echo "   port $p health: ${code:-no answer}"
  done
  echo "   (a service that answers 000/no answer: sudo journalctl -u <service> -n 50)"
}

if [ "$ROLLBACK" = 1 ]; then
  echo "== rollback: reverse $PATCH_ON_VM"
  remote "test -f $PATCH_ON_VM" || { echo "STOP: $PATCH_ON_VM not found on the VM"; exit 1; }
  remote "git apply --check -R $PATCH_ON_VM" || { echo "STOP: the patch no longer reverses cleanly (files changed since)"; exit 1; }
  remote "git apply -R $PATCH_ON_VM && rm -f $PATCH_ON_VM"
  restart_and_check
  echo "Rolled back. Migrations are not reversed (they only added tables/columns)."
  exit 0
fi

# ---- local checks
[ "$(git branch --show-current)" = main ] || { echo "STOP: not on main"; exit 1; }
git update-index -q --refresh || true
# Line-ending-only differences (Windows checkout read by another git/bash) do not matter: the patch is built from commits.
git diff --quiet --ignore-cr-at-eol HEAD || { echo "STOP: tracked files have uncommitted changes (not just line endings). Commit first, so the VM gets exactly what is in git."; git diff --stat --ignore-cr-at-eol HEAD | tail -5; echo "(Running from PowerShell? Use Git Bash: 'bash' there can be WSL, whose git sees every CRLF file as changed.)"; exit 1; }
HEAD_SHA="$(git rev-parse HEAD)"

echo "== asking the VM what it runs"
BASE="$(remote 'git rev-parse HEAD')"
git cat-file -e "$BASE^{commit}" 2>/dev/null || { echo "STOP: VM is at $BASE, which this clone does not have. git fetch first."; exit 1; }
DIRTY="$(remote 'git status --porcelain --untracked-files=no')"
if [ -n "$DIRTY" ]; then
  echo "STOP: the VM has uncommitted changes (an earlier patch?):"; echo "$DIRTY"
  echo "Undo them first: ./scripts/deploy-to-vm.sh --rollback   (or, on the VM: git checkout -- <files>)"; exit 1
fi
[ "$BASE" != "$HEAD_SHA" ] || { echo "VM already runs $HEAD_SHA (committed). Nothing to deploy."; exit 0; }
git merge-base --is-ancestor "$BASE" "$HEAD_SHA" || { echo "STOP: the VM's commit is not an ancestor of HEAD; refusing to guess"; exit 1; }

PATCH="$(mktemp)"; trap 'rm -f "$PATCH"' EXIT
git diff --binary "$BASE" "$HEAD_SHA" > "$PATCH"
FILES="$(git diff --name-only "$BASE" "$HEAD_SHA")"
echo "== $(echo "$FILES" | wc -l | tr -d ' ') files change between VM ($BASE) and HEAD ($HEAD_SHA)"
if echo "$FILES" | grep -Eiq '(^|/)(\.env|.*\.pem|.*\.dump|auth\.json|.*credentials.*)$'; then
  echo "STOP: the patch would touch a secret/data-looking file:"; echo "$FILES" | grep -Ei '(^|/)(\.env|.*\.pem|.*\.dump|auth\.json|.*credentials.*)$'; exit 1
fi

# New code can query columns a new migration adds: never restart it onto a database that lacks them.
NEW_MIGRATIONS="$(git diff --name-only --diff-filter=A "$BASE" "$HEAD_SHA" | grep -E '^databases/[a-z]+/migrations/.*\.sql$' || true)"
if [ -n "$NEW_MIGRATIONS" ] && [ "$MIGRATE" = 0 ]; then
  echo "STOP: this deploy adds migration file(s) the new code needs:"; echo "$NEW_MIGRATIONS" | sed 's/^/   /'
  echo "Re-run with --migrate (it backs up both databases first, then applies only what is missing)."; exit 1
fi

scp -q "$PATCH" "$VM:/tmp/db-setup-pending.patch"
remote "git apply --check /tmp/db-setup-pending.patch" || { remote 'rm -f /tmp/db-setup-pending.patch'; echo "STOP: the patch does not apply cleanly"; exit 1; }
echo "OK  patch applies cleanly on the VM"
if [ "$DRY" = 1 ]; then remote 'rm -f /tmp/db-setup-pending.patch'; echo "Dry run: nothing was changed on the VM."; exit 0; fi

# ---- migrations (only with --migrate), BEFORE the new code starts
if [ "$MIGRATE" = 1 ]; then
  echo "== backing up both databases first"
  remote './scripts/backup-db.sh all' || { remote 'rm -f /tmp/db-setup-pending.patch'; echo "STOP: backup failed, nothing applied"; exit 1; }
  ssh -o BatchMode=yes "$VM" "cd \"\$HOME/$VM_DIR\" && bash -s" <<'REMOTE'
set -euo pipefail
url_of() { grep -E '^LOCAL_DATABASE_URL=' "databases/$1/.env" | cut -d= -f2- | tr -d '"'; }
has_table()  { psql "$1" -Atc "select to_regclass('public.$2') is not null" | grep -q t; }
has_column() { psql "$1" -Atc "select exists(select 1 from information_schema.columns where table_name='$2' and column_name='$3')" | grep -q t; }
run() { # $1 db  $2 file  $3 already-applied test (shell function call, as a string)
  if eval "$3"; then echo "   skip  $1 $2 (already applied)"; else echo "   apply $1 $2"; psql "$URL" -v ON_ERROR_STOP=1 -q -f "databases/$1/migrations/$2.sql"; fi
}
for db in tiktok instagram; do
  URL="$(url_of "$db")"; [ -n "$URL" ] || { echo "no LOCAL_DATABASE_URL for $db"; exit 1; }
  echo "== $db"
  [ "$db" = tiktok ] && run $db v6_project_post_hide 'has_column "$URL" project_posts is_hidden'
  run $db v7_admin_audit     'has_table "$URL" admin_audit'
  run $db v8_plan_expiry     'has_column "$URL" users plan_expires_at'
  run $db v9_admin_accounts  'has_table "$URL" admin_accounts'
  run $db v10_blocked_ips    'has_table "$URL" blocked_ips'
  [ "$db" = instagram ] && run $db v11_project_post_hide 'has_column "$URL" project_posts is_hidden'
  if grep -qE '^ADMIN_JWT_SECRET=.+' "databases/$db/.env"; then echo "   ADMIN_JWT_SECRET already set in $db"
  else printf '\nADMIN_JWT_SECRET=%s\n' "$(openssl rand -hex 32)" >> "databases/$db/.env"; echo "   ADMIN_JWT_SECRET added to $db/.env"; fi
done
REMOTE
fi

echo "== applying the code"
remote "git apply /tmp/db-setup-pending.patch && mv /tmp/db-setup-pending.patch $PATCH_ON_VM"
restart_and_check
echo
echo "Deployed $HEAD_SHA (VM base was $BASE) as uncommitted changes on the VM."
echo "Undo:  ./scripts/deploy-to-vm.sh --rollback"
echo "Before the next git pull on the VM:  git checkout -- .   (then pull; the same commit should be upstream)"
