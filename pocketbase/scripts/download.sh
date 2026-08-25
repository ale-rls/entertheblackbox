#!/usr/bin/env bash
# Downloads the pinned PocketBase binary for the current platform into
# pocketbase/bin/. The binary itself is not committed to git (see
# .gitignore) so every machine/CI runner fetches its own copy.
set -euo pipefail

VERSION="0.39.11"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${ROOT_DIR}/bin"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *) echo "Unsupported OS: $os" >&2; exit 1 ;;
esac

case "$arch" in
  arm64|aarch64) platform_arch="arm64" ;;
  x86_64|amd64) platform_arch="amd64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

asset="pocketbase_${VERSION}_${platform}_${platform_arch}.zip"
url="https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}/${asset}"

mkdir -p "$BIN_DIR"
tmp_zip="$(mktemp)"
trap 'rm -f "$tmp_zip"' EXIT

echo "Downloading PocketBase v${VERSION} (${platform}/${platform_arch})..."
curl -sL -o "$tmp_zip" "$url"
unzip -o "$tmp_zip" -d "$BIN_DIR" pocketbase >/dev/null
chmod +x "${BIN_DIR}/pocketbase"

echo "Installed to ${BIN_DIR}/pocketbase"
"${BIN_DIR}/pocketbase" --version
