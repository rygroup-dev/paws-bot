#!/usr/bin/env bash
# Runs the bot (or a tool: ./run.sh human | explore | probe | uitest | clicktest | selftest N).
cd "$(dirname "$0")"
[ -x .runtime/node/bin/node ] && export PATH="$PWD/.runtime/node/bin:$PATH"
if [ -z "${1:-}" ]; then exec node src/index.js; else s="$1"; shift; exec node "src/$s.js" "$@"; fi
