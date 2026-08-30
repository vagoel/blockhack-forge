#!/usr/bin/env bash
# Pushes convex/ to the cloud deployment and syncs runtime env vars.
# Reads the team token from .env at runtime; mints a short-lived deploy key.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; source .env; set +a
DEPLOYMENT="outgoing-warbler-572"

# Accept Devin's documentation-style name and the existing DEVIN_v3 local
# name, while keeping DEVIN as the canonical variable used by the app.
DEVIN_KEY="${DEVIN:-${DEVIN_API_KEY:-${DEVIN_v3:-${DEVIN_V3:-}}}}"
DEVIN="$DEVIN_KEY"
export DEVIN

CONTEXT_KEY="${CONTEXT_DEV_API_KEY:-${CONTEXT:-}}"
VERCEL_KEY="${VERCEL_TOKEN:-${VERCEL:-}}"
if [ -z "$VERCEL_KEY" ]; then
  echo "VERCEL_TOKEN (or legacy VERCEL) is required" >&2
  exit 1
fi

OPENAI_PROVIDER_KEY="${OPENAI_API_KEY:-${OPENAI_KEY:-}}"

case "$DEVIN" in
  cog_*)
    if [ -z "${DEVIN_ORG_ID:-}" ]; then
      DEVIN_ORG_ID="$(
        curl --connect-timeout 10 --max-time 30 --fail-with-body --silent --show-error \
          https://api.devin.ai/v3/self \
          -H "Authorization: Bearer $DEVIN" \
        | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const id=j.org_id;process.stdout.write(typeof id==='string'&&id.startsWith('org-')?id:'')})"
      )"
      if [ -z "$DEVIN_ORG_ID" ]; then
        echo "DEVIN_ORG_ID is required and could not be discovered from /v3/self" >&2
        exit 1
      fi
      export DEVIN_ORG_ID
      echo "discovered Devin organization from /v3/self"
    fi
    ;;
  apk_*) ;;
  *)
    echo "DEVIN must be an apk_ legacy key or cog_ service-user token" >&2
    exit 1
    ;;
esac

KEY=$(curl -s -X POST \
  -H "Authorization: Bearer $CONVEX" \
  -H "Content-Type: application/json" \
  -d '{"name":"cli-deploy"}' \
  "https://api.convex.dev/v1/deployments/$DEPLOYMENT/create_deploy_key" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write(j.deployKey||j.key||j.adminKey||'')})")

if [ -z "$KEY" ]; then echo "failed to mint deploy key" >&2; exit 1; fi

set_convex_env() {
  CONVEX_DEPLOY_KEY="$KEY" npx convex env set "$1" -- "$2"
}

sync_optional_convex_env() {
  if [ -n "$2" ]; then
    set_convex_env "$1" "$2"
  else
    CONVEX_DEPLOY_KEY="$KEY" npx convex env remove "$1"
  fi
}

# Both generated artifacts are deployment inputs. Rebuild them immediately
# before Convex packaging so neither skills nor the embedded runtime can drift.
node scripts/build-skills.mjs
node scripts/build-vendor.mjs
node scripts/sync-playbook.mjs
CONVEX_DEPLOY_KEY="$KEY" npx convex deploy -y
set_convex_env DEVIN "$DEVIN"
set_convex_env VERCEL_TOKEN "$VERCEL_KEY"
set_convex_env APP_CONVEX_URL "https://$DEPLOYMENT.convex.cloud"

# Optional connectors are true mirrors of the local configuration: removing a
# local key also removes the canonical remote value instead of leaving a stale
# connector enabled. Legacy remote aliases are cleared after normalization.
sync_optional_convex_env CONTEXT_DEV_API_KEY "$CONTEXT_KEY"
sync_optional_convex_env OPENAI_API_KEY "$OPENAI_PROVIDER_KEY"
sync_optional_convex_env OPENAI_MODEL "${OPENAI_MODEL:-}"
sync_optional_convex_env VERCEL_TEAM_ID "${VERCEL_TEAM_ID:-}"
CONVEX_DEPLOY_KEY="$KEY" npx convex env remove CONTEXT
CONVEX_DEPLOY_KEY="$KEY" npx convex env remove OPENAI_KEY
CONVEX_DEPLOY_KEY="$KEY" npx convex env remove VERCEL
CONVEX_DEPLOY_KEY="$KEY" npx convex env remove CONVEX_CLOUD_URL
CONVEX_DEPLOY_KEY="$KEY" npx convex env remove OPERATOR_KEY

sync_optional_convex_env DEVIN_ORG_ID "${DEVIN_ORG_ID:-}"
set_convex_env DEVIN_MAX_ACU_LIMIT "${DEVIN_MAX_ACU_LIMIT:-2}"
set_convex_env DEVIN_MAX_RETRIES "${DEVIN_MAX_RETRIES:-0}"
set_convex_env DEVIN_PLAYBOOK_ID "$(cat scripts/.playbook-id)"
echo "deployed to https://$DEPLOYMENT.convex.cloud"
