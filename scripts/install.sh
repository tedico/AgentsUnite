#!/usr/bin/env bash
set -euo pipefail
BIN_DIR="${1:-$HOME/.local/bin}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$BIN_DIR"
chmod +x "$REPO_DIR/bin/unite.js"
ln -sf "$REPO_DIR/bin/unite.js" "$BIN_DIR/unite"
echo "installed: unite -> $BIN_DIR/unite"
