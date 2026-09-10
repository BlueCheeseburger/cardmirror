#!/bin/bash
# Fetch sherpa-onnx-node's NON-HOST platform packages into node_modules.
#
# Why: sherpa-onnx-node resolves its native runtime from per-platform
# sherpa-onnx-<os>-<arch> packages declared as optionalDependencies, and
# npm only installs the HOST one. The mac universal build merges an x64
# and an arm64 app, so it needs BOTH darwin packages present; a Windows
# or Linux artifact cross-built here needs its own. Same pattern as
# fetch-koffi-cross.sh. Idempotent; versions pinned to the installed
# sherpa-onnx-node.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/sherpa-onnx-node/package.json','utf8')).version")

for pkg in sherpa-onnx-darwin-arm64 sherpa-onnx-darwin-x64 sherpa-onnx-win-x64 sherpa-onnx-linux-x64; do
  dest="node_modules/$pkg"
  if [ -d "$dest" ]; then
    have=$(node -p "JSON.parse(require('fs').readFileSync('$dest/package.json','utf8')).version" 2>/dev/null || echo none)
    if [ "$have" = "$VERSION" ]; then
      echo "sherpa-cross: $pkg@$have present"
      continue
    fi
    rm -rf "$dest"
  fi
  echo "sherpa-cross: fetching $pkg@$VERSION"
  tmp=$(mktemp -d)
  (cd "$tmp" && npm pack "$pkg@$VERSION" --silent >/dev/null && tar -xzf ./*.tgz)
  mkdir -p "$dest"
  cp -R "$tmp/package/." "$dest/"
  rm -rf "$tmp"
done
echo "sherpa-cross: done"
