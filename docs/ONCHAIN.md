# Segel — On-chain reproduction

Live testnet IDs are in [`deployments/testnet.json`](../deployments/testnet.json).

## Build

```bash
# circuits (off-chain): compile + trusted setup + prove + verify
npm run circuit:all

# verifier WASMs (WSL) — embeds each circuit's VK
bash scripts/wsl-build-verifier.sh circuits/build/bidValidity_vk.json   bid_verifier.wasm
bash scripts/wsl-build-verifier.sh circuits/build/auctionResult_vk.json auction_verifier.wasm

# desk contract (WSL) — cargo test -> 26/26
bash scripts/wsl-build-otc.sh
```

## Deploy

```bash
bash scripts/wsl-deploy.sh    # deploys both verifiers + the otc desk (constructor)
```

Constructor: `__constructor(admin, token, bid_verifier, auction_verifier, asp_root, oracle)`
— `token` is Circle's canonical testnet USDC SAC (issuer `GBBD47IF…`); `oracle` is
the Reflector SEP-40 feed; `asp_root` comes from `node scripts/asp.mjs`. The token
can also be switched post-deploy via the admin `set_token` (used to migrate from
the earlier mock USDC to Circle USDC without a redeploy).

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

Posts a DvP RFQ (maker escrows a 20 XLM lot), seals 3 bids (real `bidValidity`
proofs, escrow locked), and settles with a real `auctionResult` proof (Vickrey) —
delivering the lot to the winner with the oracle price-guard armed. Verified live
(RFQ #13, clearing 4.20 USDC = second-highest of 4.90/4.20/3.80):

| Step | tx |
|---|---|
| post_rfq_dvp | [`a16e4dae…`](https://stellar.expert/explorer/testnet/tx/a16e4dae39c9595dd8dd2fcb4fdd44d30fc88eca10385d2cb7e63767706875e1) |
| commit_bid ×3 | [`02afe9fc…`](https://stellar.expert/explorer/testnet/tx/02afe9fc9ca8b4b465ec477f3e9abddaad5a6d2ae63f34ba1555e31c9c3ec495) · [`ebb0e1da…`](https://stellar.expert/explorer/testnet/tx/ebb0e1dae4563b76c916b50764d1d0ec00a1aadb64fced206699dc620a26815e) · [`6bf575b4…`](https://stellar.expert/explorer/testnet/tx/6bf575b430fcf3ce610fa97615f0769181bceff5196b176b6971a3572914cf07) |
| settle (Vickrey, clearing 4.20 USDC, 20 XLM delivered) | [`95dfea50…`](https://stellar.expert/explorer/testnet/tx/95dfea5077c2ba29d5357a2e0b6fd93d3098fbbefcf5062f7ad241ed7b00c41e) |

> Soroban builds run in **WSL/Linux** (Windows lacks MSVC `link.exe`). The verifier
> crate is built from V1's `_reference/stellar-private-payments` workspace.
