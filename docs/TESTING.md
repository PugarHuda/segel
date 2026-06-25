# Segel — Testing & QA report

Every layer is tested: circuit soundness, contract logic, in-browser proving, and
a full live flow on Stellar testnet. All green as of the latest run.

| Suite | Command | Result |
|---|---|---|
| Contract unit tests | `cargo test` (in `contracts/otc`) | **14 / 14 passed** |
| Circuit proving | `npm run test:proving` | **6 / 6** — both circuits prove + verify; public signals asserted |
| Circuit soundness | `npm run test:negative` | **10 / 10** bad witnesses rejected (see below) |
| Frontend smoke | `npm run test:browser` | landing + desk render, live RFQ reads, **0 console errors** |
| In-browser ZK | `npm run test:browser-zk` | bidValidity (~560ms) + auctionResult proofs **generated and verified in Chrome**; Vickrey clearing = 4200 |
| Live e2e | `npm run e2e` | post → 3 sealed bids → Vickrey settle, **on testnet** |
| On-chain verify | `scripts/gen-invoke-args.mjs` + invoke | both verifiers → `true`; tampered input → `InvalidProof` |

## Soundness cases (test:negative) — all correctly rejected

**bidValidity:** bid above band · bid below band · proof-of-funds violated
(`bid > availBal`) · mismatched commitment · forged nullifier · fake allow-list root.

**auctionResult:** wrong winner (not the max) · wrong clearing price (first-price
instead of second) · clearing too low (not the true runner-up) · winner == runner.

Each fails at witness generation because a circuit constraint is violated — i.e.
no valid proof exists for a false statement. That is the soundness guarantee.

## On-chain evidence

See [`deployments/testnet.json`](../deployments/testnet.json) for live contract IDs
and tx links:
- bidValidity verify → [`true`](https://stellar.expert/explorer/testnet/tx/8994686dc5d787c63c3690db810aec2653dae9dbf7a3b6c5818fe151a5624862)
- full flow: post / commit_bid ×3 / settle (Vickrey, clearing 4200) — all live.

## Reproduce everything

```bash
npm install
cargo test --manifest-path contracts/otc/Cargo.toml   # (run in WSL)
npm run test:proving && npm run test:negative
npm run test:browser && npm run test:browser-zk
npm run e2e
```
