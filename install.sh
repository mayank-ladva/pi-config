#!/usr/bin/env bash
set -euo pipefail

target="${1:-$HOME/.pi/agent}"
mkdir -p "$target"
rsync -a --exclude ".git/" --exclude "node_modules/" --exclude ".secrets/" --exclude ".tmp/" ./ "$target"/
echo "Synced Pi config to: $target"
