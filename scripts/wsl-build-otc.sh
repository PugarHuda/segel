#!/usr/bin/env bash
# Build the Segel otc contract WASM (standalone crate) from inside WSL.
set -uo pipefail
ROOT="/mnt/c/Hackathons/Hackathon Stellar Real World ZK V2"
OTC="$ROOT/contracts/otc"
OUT="$ROOT/contracts/build"
export PATH="/usr/local/bin:$HOME/.cargo/bin:$PATH"
mkdir -p "$OUT"

cd "$OTC" || { echo "otc dir missing"; exit 1; }
echo "BUILD START $(date)"
stellar contract build --out-dir "$OUT"
code=$?
echo "BUILD EXIT: $code"
ls -la "$OUT/otc.wasm" 2>/dev/null || echo "no otc.wasm"
exit $code
