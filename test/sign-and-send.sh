#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./test/sign-and-send.sh [payload.json] [webhook_url] [webhook_secret]
# Environment variables used if args not provided: WEBHOOK_SECRET, CLIENT_KEY

PAYLOAD_FILE=${1:-test/payload.example.json}
URL=${2:-http://localhost:8787/v1/webhooks/payment}
SECRET=${3:-${WEBHOOK_SECRET:-dev-webhook-secret}}

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required. Install jq and try again." >&2
  exit 2
fi

if [ ! -f "$PAYLOAD_FILE" ]; then
  echo "Payload file not found: $PAYLOAD_FILE" >&2
  exit 2
fi

TS_NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EVENT_ID="evt_local_$(date +%s)"

# Inject eventId and occurredAt if missing, keep existing values if present
PAYLOAD=$(jq --arg eid "$EVENT_ID" --arg now "$TS_NOW" '
  (.eventId // $eid) as $ei | .eventId = $ei |
  (.occurredAt // $now) as $oc | .occurredAt = $oc
' "$PAYLOAD_FILE")

TS_UNIX=$(date +%s)
SIGN=$(printf '%s' "$TS_UNIX.$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
HDR="t=$TS_UNIX,v1=$SIGN"

curl_args=( -sS -X POST "$URL" -H "Content-Type: application/json" -H "X-QAgent-Signature: $HDR" -d "$PAYLOAD" )

if [ -n "${CLIENT_KEY:-}" ]; then
  curl_args+=( -H "clientKey: ${CLIENT_KEY}" )
fi

echo "Sending webhook to $URL"
echo "Payload:"
echo "$PAYLOAD"
echo "Signature: $HDR"

curl "${curl_args[@]}" | jq . || true
