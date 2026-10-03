#!/usr/bin/env sh
# Builds the Chrome Web Store / release archive into dist/.
set -eu

cd "$(dirname "$0")/.."
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -n 1)
name="oasis-wallet-v${version}"
mkdir -p dist
rm -f "dist/${name}.zip"

zip -q -r -X "dist/${name}.zip" manifest.json src assets LICENSE NOTICE TERMS.md -x '*.DS_Store'

cd dist
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${name}.zip" > "${name}.zip.sha256"
else
  shasum -a 256 "${name}.zip" > "${name}.zip.sha256"
fi
echo "dist/${name}.zip"
cat "${name}.zip.sha256"
