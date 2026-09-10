#!/usr/bin/env bash
# Runs the local PocketBase instance, downloading the binary first if needed.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${ROOT_DIR}/bin/pocketbase"

if [ ! -x "$BIN" ]; then
  "${ROOT_DIR}/scripts/download.sh"
fi

exec "$BIN" serve --http="127.0.0.1:8090" --dir="${ROOT_DIR}/pb_data"
