#!/usr/bin/env bash
# Deploy Segel to Stellar testnet: bidValidity verifier, auctionResult verifier,
# and the otc desk contract (constructor wires the verifiers + ASP root + USDC).
# Reuses the funded `corredor` identity and the project-issued mock USDC SAC
# (a testnet USDC-denominated asset, NOT Circle's canonical USDC).
set -uo pipefail
export PATH="/usr/local/bin:$HOME/.cargo/bin:$PATH"
R="/mnt/c/Hackathons/Hackathon Stellar Real World ZK V2"
B="$R/contracts/build"

SRC="corredor"
NET="testnet"
TOKEN="CAT6F6HX4B2DBPSS4SIZ257IYSMKDKRJSEGIQTKBDS7LOFRMDXVGFVA2"   # mock USDC SAC (project-issued, not Circle)
ADMIN="GB2CVRVNR4VN5LYVOX637ZS46RJONKWVQZ4IZC5IIEPAPPFRC5CHYRVS"  # corredor address
ASP_ROOT="1a67e1520bae4f57e592dfbeac003a36ae2e8011e9fc000e081ed1cd19c5ebff"

echo "==> deploy bid_verifier"
BID=$(stellar contract deploy --wasm "$B/bid_verifier.wasm" --source "$SRC" --network "$NET" 2>/dev/null | tail -1)
echo "BID_VERIFIER=$BID"

echo "==> deploy auction_verifier"
AUC=$(stellar contract deploy --wasm "$B/auction_verifier.wasm" --source "$SRC" --network "$NET" 2>/dev/null | tail -1)
echo "AUCTION_VERIFIER=$AUC"

echo "==> deploy otc (with constructor)"
OTC=$(stellar contract deploy --wasm "$B/otc.wasm" --source "$SRC" --network "$NET" -- \
  --admin "$ADMIN" \
  --token "$TOKEN" \
  --bid_verifier "$BID" \
  --auction_verifier "$AUC" \
  --asp_root "$ASP_ROOT" 2>/dev/null | tail -1)
echo "OTC=$OTC"

echo ""
echo "{ \"bidVerifier\": \"$BID\", \"auctionVerifier\": \"$AUC\", \"otc\": \"$OTC\", \"token\": \"$TOKEN\", \"admin\": \"$ADMIN\", \"aspRoot\": \"$ASP_ROOT\" }"
