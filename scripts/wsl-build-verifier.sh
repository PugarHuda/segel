#!/usr/bin/env bash
# Build a BN254 Groth16 verifier WASM with a given VK embedded, from inside WSL.
# Reuses the Nethermind circom-groth16-verifier crate that lives in V1's
# _reference workspace (study-only, gitignored). The crate's build.rs reads the
# VK from $VERIFIER_VK_JSON and bakes it into the WASM.
#
# Usage: bash scripts/wsl-build-verifier.sh <vk-relative-path> <out-wasm-name>
#   e.g. bash scripts/wsl-build-verifier.sh circuits/build/bidValidity_vk.json bid_verifier.wasm
set -uo pipefail

VK_REL="${1:?vk path relative to repo root}"
OUT_NAME="${2:?output wasm name}"

ROOT="/mnt/c/Hackathons/Hackathon Stellar Real World ZK V2"
REF="/mnt/c/Hackathons/Hackathon Stellar Real World ZK/_reference/stellar-private-payments"
OUT="$ROOT/contracts/build"
export VERIFIER_VK_JSON="$ROOT/$VK_REL"
export PATH="/usr/local/bin:$HOME/.cargo/bin:$PATH"

mkdir -p "$OUT"
echo "BUILD START $(date) — VK=$VK_REL -> $OUT_NAME"
[ -f "$VERIFIER_VK_JSON" ] || { echo "VK missing: $VERIFIER_VK_JSON"; exit 1; }

cd "$REF" || { echo "REF dir missing"; exit 1; }
stellar contract build --package circom-groth16-verifier --out-dir "$OUT"
code=$?
if [ $code -eq 0 ] && [ -f "$OUT/circom_groth16_verifier.wasm" ]; then
  cp "$OUT/circom_groth16_verifier.wasm" "$OUT/$OUT_NAME"
  echo "OK -> $OUT/$OUT_NAME ($(wc -c < "$OUT/$OUT_NAME") bytes)"
fi
echo "BUILD EXIT: $code"
exit $code
