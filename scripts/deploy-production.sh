#!/usr/bin/env bash
# Deploy cubewars to the production VPS after the office gate (Tester PASS +
# Critic APPROVED / Judge ALL_CLOSED + Team Lead merge approve).
#
# Usage (from repo root):
#   ./scripts/deploy-production.sh              # deploy origin/master
#   ./scripts/deploy-production.sh --ref HEAD   # deploy local HEAD (emergency only)
#   ./scripts/deploy-production.sh --skip-gate  # skip local "on master?" check
#
# Override host / public URL:
#   CUBEWARS_DEPLOY_SSH=root@195.60.237.4
#   CUBEWARS_PUBLIC_HOST=cubewars.ru
#   CUBEWARS_WS_URL=wss://cubewars.ru/ws
#
# Docs: docs/ops/production-deploy.md

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEPLOY_SSH="${CUBEWARS_DEPLOY_SSH:-root@195.60.237.4}"
PUBLIC_HOST="${CUBEWARS_PUBLIC_HOST:-cubewars.ru}"
# Prefer WSS when public host is a real domain (not raw IP)
if [[ -z "${CUBEWARS_WS_URL:-}" ]]; then
  if [[ "$PUBLIC_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    WS_URL="ws://${PUBLIC_HOST}/ws"
  else
    WS_URL="wss://${PUBLIC_HOST}/ws"
  fi
else
  WS_URL="$CUBEWARS_WS_URL"
fi
REMOTE_APP="/opt/cubewars"
REMOTE_WWW="/var/www/cubewars"
REF="origin/master"
SKIP_GATE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)
      REF="${2:?--ref requires a git ref}"
      shift 2
      ;;
    --skip-gate)
      SKIP_GATE=1
      shift
      ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$WS_URL" == wss://* ]]; then
  PUBLIC_URL="https://${PUBLIC_HOST}/"
else
  PUBLIC_URL="http://${PUBLIC_HOST}/"
fi

echo "==> Deploy target: ${DEPLOY_SSH}"
echo "==> Git ref:       ${REF}"
echo "==> Public URL:    ${PUBLIC_URL}"
echo "==> WS URL:        ${WS_URL}"

if [[ "$SKIP_GATE" -eq 0 ]]; then
  git fetch origin master --quiet || true
  RESOLVED="$(git rev-parse --verify "$REF")"
  MASTER="$(git rev-parse --verify origin/master 2>/dev/null || git rev-parse --verify master)"
  if [[ "$RESOLVED" != "$MASTER" && "$REF" != "origin/master" && "$REF" != "master" ]]; then
    echo "ERROR: refusing to deploy ref '${REF}' that is not origin/master." >&2
    echo "       Merge the EPIC first, or pass --skip-gate / --ref for a hotfix." >&2
    exit 1
  fi
fi

RESOLVED="$(git rev-parse --verify "$REF")"
SHORT="$(git rev-parse --short "$RESOLVED")"
SUBJECT="$(git log -1 --format='%s' "$RESOLVED")"
echo "==> Commit:        ${SHORT} ${SUBJECT}"

write_maintenance_json() {
  local phase="$1"
  local countdown_end="${2:-0}"
  ssh "$DEPLOY_SSH" "node -e \"
const fs=require('fs');
const payload={active:true,phase:'${phase}'};
if ('${phase}'==='countdown'&&${countdown_end}>0) payload.countdownEndsAt=${countdown_end};
fs.writeFileSync('${REMOTE_WWW}/maintenance.json',JSON.stringify(payload));
\" && chown www-data:www-data '${REMOTE_WWW}/maintenance.json'"
}

clear_maintenance_json() {
  ssh "$DEPLOY_SSH" "rm -f '${REMOTE_WWW}/maintenance.json'"
}

echo "==> Streaming ${REF} → ${DEPLOY_SSH}:${REMOTE_APP}"
# Keep server-local docker-compose Redis bind override if present; archive overwrites tree.
ssh "$DEPLOY_SSH" "mkdir -p '${REMOTE_APP}' '${REMOTE_WWW}'"
git archive --format=tar "$REF" | ssh "$DEPLOY_SSH" "tar xf - -C '${REMOTE_APP}'"

# Ensure Redis stays localhost-only (idempotent)
ssh "$DEPLOY_SSH" "cd '${REMOTE_APP}' && \
  if grep -q '\"6379:6379\"' docker-compose.yml; then \
    sed -i 's/\"6379:6379\"/\"127.0.0.1:6379:6379\"/' docker-compose.yml; \
  fi && \
  docker compose up -d redis"

COUNTDOWN_END=$(( ($(date +%s) * 1000) + 5000 ))
echo "==> Maintenance banner: 5s countdown for connected players"
write_maintenance_json countdown "$COUNTDOWN_END"
sleep 5
write_maintenance_json updating

echo "==> npm ci + production build on server"
ssh "$DEPLOY_SSH" "set -euo pipefail
  cd '${REMOTE_APP}'
  export VITE_CUBEWARS_WS_URL='${WS_URL}'
  npm ci
  npm run build
  rm -rf '${REMOTE_WWW:?}/'*
  cp -a client/dist/. '${REMOTE_WWW}/'
  chown -R cubewars:cubewars '${REMOTE_APP}'
  chown -R www-data:www-data '${REMOTE_WWW}'
  printf '%s' '{\"active\":true,\"phase\":\"updating\"}' > '${REMOTE_WWW}/maintenance.json'
  chown www-data:www-data '${REMOTE_WWW}/maintenance.json'
  systemctl restart cubewars.service
  systemctl reload nginx
  sleep 2
  systemctl is-active --quiet cubewars.service
  systemctl is-active --quiet nginx
"

echo "==> Smoke checks"
HTTP_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' "${PUBLIC_URL}")"
echo "${PUBLIC_URL} → ${HTTP_CODE}"
[[ "$HTTP_CODE" == "200" ]] || { echo "ERROR: expected HTTP 200" >&2; exit 1; }

# Hit the game server directly (nginx may 301 http→https on :80 /ws).
# Resolve `ws` from the app install (absolute wrapper.mjs import breaks under some Node/npm layouts).
ssh "$DEPLOY_SSH" "cd '${REMOTE_APP}' && node --input-type=module -e \"
import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:7777');
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('WS timeout')), 8000);
  ws.on('open', () => { clearTimeout(t); console.log('WS localhost:7777 → OPEN'); ws.close(); resolve(); });
  ws.on('error', (e) => { clearTimeout(t); reject(e); });
});
\""

clear_maintenance_json
echo "==> Maintenance banner cleared — players can connect"

echo
echo "Deploy OK: ${PUBLIC_URL}  (${SHORT})"
echo "Verify in browser, then include this URL in the Team Lead final report."
