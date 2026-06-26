# Segel — On-chain reproduction

Live testnet IDs are in [`deployments/testnet.json`](../deployments/testnet.json).

## Build

```bash
# circuits (off-chain): compile + trusted setup + prove + verify
npm run circuit:all

# verifier WASMs (WSL) — embeds each circuit's VK
bash scripts/wsl-build-verifier.sh circuits/build/bidValidity_vk.json   bid_verifier.wasm
bash scripts/wsl-build-verifier.sh circuits/build/auctionResult_vk.json auction_verifier.wasm

# desk contract (WSL) — cargo test -> 14/14
bash scripts/wsl-build-otc.sh
```

## Deploy

```bash
bash scripts/wsl-deploy.sh    # deploys both verifiers + the otc desk (constructor)
```

Constructor: `__constructor(admin, token, bid_verifier, auction_verifier, asp_root)`
— `token` is a testnet USDC-denominated SAC (project-issued mock issuer, not
Circle's USDC); `asp_root` comes from `node scripts/asp.mjs`.

## Verify a proof on-chain

```bash
node scripts/gen-invoke-args.mjs bidValidity      # snarkjs proof -> CLI args
stellar contract invoke --id <BID_VERIFIER> --source corredor --network testnet -- verify \
  --proof-file-path circuits/build/bidValidity_soroban_proof.json \
  --public_inputs-file-path circuits/build/bidValidity_soroban_public.json
# -> true
```

A real verify tx: [`8994686dc5…`](https://stellar.expert/explorer/testnet/tx/8994686dc5d787c63c3690db810aec2653dae9dbf7a3b6c5818fe151a5624862).
Tampering any public input → rejected on-chain (`Error(Contract, #0)`).

## Full live flow

```bash
node scripts/e2e-testnet.mjs
```

Posts an RFQ, seals 3 bids (real `bidValidity` proofs, escrow locked), and settles
with a real `auctionResult` proof (Vickrey). Verified live:

| Step | tx |
|---|---|
| post_rfq | [`9e37218f…`](https://stellar.expert/explorer/testnet/tx/9e37218f4a7411ac4226cd3883c02af0f9dd0b83ef36f766c03523837e001c55) |
| commit_bid ×3 | [`f38279e6…`](https://stellar.expert/explorer/testnet/tx/f38279e66bfa7e968f7df82791a98d4857a975570823cbf30aabf4efd79351b8) · [`c565bf66…`](https://stellar.expert/explorer/testnet/tx/c565bf661023983374f7286f66053283b10af66733fe54e13a8e72baff22dfae) · [`1c20f8b8…`](https://stellar.expert/explorer/testnet/tx/1c20f8b85187662660b8abae1550e53f9ca4ae6f40681d23d85de8f7b7b50848) |
| settle (Vickrey, clearing 4200) | [`201ed29f…`](https://stellar.expert/explorer/testnet/tx/201ed29f3150113b7947fd55e653327c1a3d8c8ba3f716e46271b766e6f84d03) |

> Soroban builds run in **WSL/Linux** (Windows lacks MSVC `link.exe`). The verifier
> crate is built from V1's `_reference/stellar-private-payments` workspace.
