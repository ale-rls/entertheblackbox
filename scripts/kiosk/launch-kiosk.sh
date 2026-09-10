#!/usr/bin/env bash
set -euo pipefail

: "${KIOSK_URL:?Set KIOSK_URL to the production /display/ URL}"
KIOSK_PROFILE_DIR="${KIOSK_PROFILE_DIR:-${HOME}/.config/entertheblackbox-kiosk}"
NETWORK_ATTEMPTS="${NETWORK_ATTEMPTS:-30}"
NETWORK_RETRY_SECONDS="${NETWORK_RETRY_SECONDS:-2}"

case "$NETWORK_ATTEMPTS:$NETWORK_RETRY_SECONDS" in
  *[!0-9:]*|0:*|*:0) echo "Network retry settings must be positive integers" >&2; exit 64 ;;
esac

browser="${KIOSK_BROWSER:-}"
if [[ -z "$browser" ]]; then
  for candidate in chromium chromium-browser google-chrome-stable google-chrome; do
    if command -v "$candidate" >/dev/null 2>&1; then browser="$(command -v "$candidate")"; break; fi
  done
fi
if [[ -z "$browser" || ! -x "$browser" ]]; then
  echo "No Chromium/Chrome executable found; set KIOSK_BROWSER" >&2
  exit 69
fi

mkdir -p "$KIOSK_PROFILE_DIR"
exec 9>"$KIOSK_PROFILE_DIR/launcher.lock"
if ! flock -n 9; then
  echo "A kiosk launcher is already active" >&2
  exit 75
fi

ready=0
for ((attempt = 1; attempt <= NETWORK_ATTEMPTS; attempt++)); do
  if curl --fail --silent --show-error --max-time 5 --output /dev/null "$KIOSK_URL"; then
    ready=1
    break
  fi
  sleep "$NETWORK_RETRY_SECONDS"
done
if [[ "$ready" -ne 1 ]]; then
  echo "Kiosk URL unavailable after ${NETWORK_ATTEMPTS} attempts" >&2
  exit 1
fi

exec "$browser" \
  --kiosk \
  --autoplay-policy=no-user-gesture-required \
  --no-first-run \
  --disable-session-crashed-bubble \
  --user-data-dir="$KIOSK_PROFILE_DIR" \
  "$KIOSK_URL"
