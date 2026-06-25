#!/usr/bin/env bash
# One command to compile + trusted-setup + prove + verify BOTH Segel circuits
# off-chain. Proves the ZK works end-to-end without any network.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "############################################"
echo "# 1/2  bidValidity (sealed-bid validity)   #"
echo "############################################"
bash scripts/build-circuit.sh bidValidity 14 scripts/gen-input-bid.mjs

echo "############################################"
echo "# 2/2  auctionResult (Vickrey settlement)  #"
echo "############################################"
bash scripts/build-circuit.sh auctionResult 14 scripts/gen-input-auction.mjs

echo ""
echo "✅ Both circuits compiled, proven, and verified (Groth16 / BN254)."
