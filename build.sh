#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OUT_DIR="${OUT_DIR:-dist}"
VERSION="$(node -p "require('./package.json').version")"
OUT_FILE="${OUT_FILE:-$OUT_DIR/agent-terminal-launcher-$VERSION.vsix}"

mkdir -p "$OUT_DIR"

npm i --no-package-lock --no-audit --no-fund
npm run package -- --out "$OUT_FILE"

printf 'Built VSIX: %s\n' "$OUT_FILE"
