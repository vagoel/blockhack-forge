#!/usr/bin/env bash
# Runs a Convex function on the cloud deployment: scripts/run.sh module:fn ['{"json":"args"}']
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
DEPLOYMENT="outgoing-warbler-572"
KEY=$(curl -s -X POST \
  -H "Authorization: Bearer $CONVEX" \
  -H "Content-Type: application/json" \
  -d '{"name":"cli-run"}' \
  "https://api.convex.dev/v1/deployments/$DEPLOYMENT/create_deploy_key" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write(j.deployKey||j.key||j.adminKey||'')})")
if [ -z "$KEY" ]; then echo "failed to mint deploy key" >&2; exit 1; fi
if [ $# -ge 2 ]; then
  CONVEX_DEPLOY_KEY="$KEY" npx convex run "$1" "$2"
else
  CONVEX_DEPLOY_KEY="$KEY" npx convex run "$1"
fi
