#!/usr/bin/env bash
# Upload the freshly built otc.wasm and upgrade the live desk in place (same id).
set -euo pipefail
export PATH="/usr/local/bin:$HOME/.cargo/bin:$PATH"
OTC=CBAJVX6XPPGCMIQRWABO6ZOGQH7PJXTF4XB3MTAC35M4SBRLSIYXBBZM
cp "/mnt/c/Hackathons/Hackathon Stellar Real World ZK V2/contracts/build/otc.wasm" /tmp/otc.wasm
which stellar
H=$(stellar contract upload --wasm /tmp/otc.wasm --source corredor --network testnet)
echo "WASM_HASH=$H"
stellar contract invoke --id $OTC --source corredor --network testnet -- upgrade --new_wasm_hash "$H"
echo "sealed_window=$(stellar contract invoke --id $OTC --source corredor --network testnet -- sealed_window)"
echo "price_guard=$(stellar contract invoke --id $OTC --source corredor --network testnet -- price_guard)"
