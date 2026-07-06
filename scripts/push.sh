#!/bin/sh
# Push a narration file to a player's stream via the bridge.
#   ./scripts/push.sh <player_id> <file.mp3> [interrupt|queue]
set -eu
PLAYER="${1:?usage: push.sh <player_id> <file> [mode]}"
FILE="${2:?usage: push.sh <player_id> <file> [mode]}"
MODE="${3:-interrupt}"
BRIDGE="${BRIDGE:-http://localhost:8090}"

curl -s -X POST "$BRIDGE/players/$PLAYER/play" \
    ${BRIDGE_TOKEN:+-H "Authorization: Bearer $BRIDGE_TOKEN"} \
    -H "Content-Type: application/json" \
    -d "{\"file\": \"$FILE\", \"mode\": \"$MODE\"}"
echo
