# Segel

> **Confidential sealed-bid OTC desk on Stellar.**
> Bids sealed. Settlement proven. Losers never seen.

Segel is an on-chain **over-the-counter (OTC) desk** for large trades on Stellar
where **bid amounts are cryptographically sealed**, the **fair clearing price is
proven correct in zero-knowledge** (Vickrey / second-price), and **every losing
bid stays hidden forever** — while the whole thing remains verifiable on-chain.

Built for the [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk)
hackathon. Two Circom/Groth16/BN254 circuits do the real work; a Soroban contract
verifies the proofs on-chain and custodies a testnet USDC-denominated asset
(a project-issued mock SAC — see the note under "What's real").

---

## TL;DR for judges

- **What:** a confidential sealed-bid OTC desk. Takers commit hidden bids; at
  settlement one ZK proof shows the **winner + Vickrey clearing price** are
  correct over exactly the on-chain commitments — **losing bids are never
  revealed**, on-chain or to the public.
- **ZK is load-bearing:** two Groth16/BN254 circuits. Remove them and the product
  cannot exist — there is no other way to settle a sealed auction without either
  leaking every bid or trusting an operator.

  | Circuit | Proves |
  |---|---|
  | **bidValidity** | `commit = Poseidon(bid,nonce,addr)` · `band_min ≤ bid ≤ band_max` · proof-of-funds (`bid ≤ escrow`) · ASP allow-list membership (identity hidden) · fresh nullifier (one bid per identity per RFQ) |
  | **auctionResult** | every commitment binds · `winner = argmax` · `clearingPrice = second-highest` (Vickrey) — all compared **in-circuit**; losing bids never appear in the output |

- **It runs on Stellar — live on testnet, every claim with a proof link:**

  | Contract | Role | Verified |
  |---|---|---|
  | [otc desk](https://stellar.expert/explorer/testnet/contract/CBAJVX6XPPGCMIQRWABO6ZOGQH7PJXTF4XB3MTAC35M4SBRLSIYXBBZM) | RFQ, sealed-bid commit-set, USDC escrow, Vickrey settle, refunds | [post](https://stellar.expert/explorer/testnet/tx/32e2ca93cf03a751ae63eaab6191667a82f61112e937d9b4fd6467493088d767) · [bid](https://stellar.expert/explorer/testnet/tx/68688b472b4b0b99fe963479f76019dd742554a0c9a72b64d07bf9f5bbddf8bc) · [settle](https://stellar.expert/explorer/testnet/tx/98a5633fc15ba033d0bf5b25035cda7a585747b1543e31e4088b25c90340c871) live |
  | [bidValidity verifier](https://stellar.expert/explorer/testnet/contract/CAL5XO2NPC2ZFVQSXX7HSS6ARQOX6GL24LCR5SZVEIKENOLN2HUOK7DK) | verifies sealed-bid validity | `verify` → [`true`](https://stellar.expert/explorer/testnet/tx/8994686dc5d787c63c3690db810aec2653dae9dbf7a3b6c5818fe151a5624862) |
  | [auctionResult verifier](https://stellar.expert/explorer/testnet/contract/CCEZVOKXYPUH67KAVVQ6ZZAPUUXSE7ENBO3OLTTLHCVKDMJHOLGGJEBY) | verifies Vickrey settlement | `verify` → `true`; tampered → `InvalidProof` |

- **🌐 Live site:** **https://segel.vercel.app** — landing page; hit **Open the
  desk** (or go to [`/app`](https://segel.vercel.app/app)). The desk reads live
  RFQs from the contract, builds **bidValidity / auctionResult proofs in your
  browser** (snarkjs/WASM), and submits real `commit_bid` / `settle` transactions.
  Works with **no install** (an embedded throwaway testnet key signs) or **connect
  Freighter**.
- **Run locally:** `npm install && npm run circuit:all && npm run serve` → http://localhost:8000.
- **Demo video:** a ~1-min auto-captured silent walkthrough ships at
  [`frontend/segel-demo.mp4`](frontend/segel-demo.mp4) (also live at
  https://segel.vercel.app/segel-demo.mp4); regenerate with `node scripts/record-demo.mjs`.
  Narrated 2–3 min script: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

---

## What the ZK is doing (load-bearing)

A sealed-bid auction has a hard problem: to settle it you must know all the bids,
but revealing them defeats the point and trusting the auctioneer's word is no
better. Segel resolves this with zero-knowledge.

1. **Sealing.** A taker commits `C = Poseidon(bid, nonce, addr)` on-chain. The
   amount is hidden. A **bidValidity** proof — generated in the browser — shows
   the hidden bid is in-band, escrow-backed, from an allow-listed identity, and
   not a duplicate, **without revealing the amount**. The contract verifies it
   on-chain before recording the commitment.
2. **Settling.** The prover takes all bid openings and produces ONE
   **auctionResult** proof that the announced winner and the **second-highest
   price** (Vickrey) are correct over exactly the recorded commitments. The only
   public outputs are the winner and the clearing price. **Every losing bid stays
   secret.** The contract verifies the proof, then pays the winner's clearing
   price to the maker, refunds the winner's surplus, and refunds every loser.

This is impossible without ZK (or a trusted operator / heavy MPC). The proofs are
**Groth16 over BN254**, verified on-chain with Stellar's native BN254 host
functions (Protocol 25/26) and Poseidon (Protocol 25).

---

## Deep Stellar / ZK integration (every primitive load-bearing)

Nothing here is namechecked. Each item, if removed, breaks the desk:

| Primitive / tool | Where it does real work |
|---|---|
| **BN254 pairing** (P25) | verifies both Groth16 proofs on-chain |
| **BN254 MSM** (P26) | accumulates the public-input vector inside the verifier |
| **BN254 scalar-field arithmetic** (P26) | the contract builds the public-input `Vec<Bn254Fr>` itself (binding) |
| **Poseidon host function** (P25) | `poseidon_hash(a,b)` exposed on-chain; matches circomlib exactly — the commitment scheme is verifiable on-chain, not asserted |
| **Soroban** | the whole desk: RFQ state, commit-set, escrow custody, settlement |
| **USDC SAC** | testnet USDC-denominated SAC escrow (project-issued mock asset, not Circle's USDC); winner pays clearing to maker, losers refunded |
| **Reflector oracle (SEP-40)** | `mark_price(symbol)` does a real cross-contract `lastprice()` read of the Reflector testnet feed — a live market mark (XLM/USDC USD price) to sanity-check the sealed auction against the market; basis for a future oracle-derived maker reserve |
| **Freighter / embedded key** | real signing of `post_rfq` / `commit_bid` / `settle` |

The contract's **binding** property is the security crux: it never accepts a
pre-built public-input vector. For every proof it constructs the inputs from
values it controls (the authenticated bidder, the RFQ band, the commitments it
actually recorded). So a valid proof can't be reused with a different bid, a
spoofed identity, or a different bid set — any mismatch fails verification.

---

## What's real (not mocked)

- **Real escrow & settlement (mock USDC asset).** `commit_bid` pulls a good-faith
  escrow (= `band_max`) from the bidder; `settle` pays the winner's clearing price
  to the maker, refunds the surplus, and refunds every loser. The custody mechanics
  are real SAC transfers; the asset is a **project-issued testnet "USDC" SAC (mock
  issuer), not Circle's canonical testnet USDC** — swapping to Circle's SAC is a
  config + redeploy.
- **Real proof-of-funds.** The escrow transfer must succeed, so the bidder
  provably holds ≥ `band_max` ≥ their hidden bid; the circuit binds `bid ≤ band_max`.
- **Real on-chain verification.** Both verifiers return `true` for valid proofs
  and reject tampered ones on-chain (`InvalidProof`).
- **Real Vickrey binding.** `settle` builds the auction public inputs from the
  **recorded** commitments (padded to N=8 with `Poseidon(0,0,0)`), so the proof is
  over exactly the on-chain sealed set — not a set the caller invented.
- **Per-identity Sybil resistance.** A nullifier `Poseidon(idSecret, rfqId)` lets
  one identity bid once per RFQ, with the KYC identity hidden via an ASP Merkle
  allow-list.
- **On-chain Poseidon (proven).** `poseidon_hash(1,2)` returns
  `0x115cc0f5…4417189a`, exactly circomlibjs `poseidon([1,2])` (see the Audit tab).
- **Live Reflector oracle (real cross-contract).** `mark_price("XLM")` invokes the
  Reflector SEP-40 testnet feed on-chain and returns the live USD mark (~$0.176);
  `mark_price("USDC")` ≈ $1.001. Surfaced live in the Audit tab.
- **16/16 contract unit tests** (`contracts/otc/src/test.rs`) + a full live e2e
  (`scripts/e2e-testnet.mjs`): post → 3 sealed bids → Vickrey settle on testnet.

## Still honestly simplified

- **Single-asset settlement.** The auctioned value transfers as the winner's USDC
  payment to the maker; a full two-asset atomic DvP swap is future work.
- **Who runs the settle prover.** A sealed auction's settler necessarily sees the
  bid openings (this is normal — an auctioneer sees bids). Segel keeps losing bids
  hidden from the **public/chain**; hiding them from the auctioneer too needs MPC
  (future work). In the no-wallet demo, **one key plays maker + several sealed
  bidders** via distinct ZK identities (ASP slots); on mainnet these are separate
  parties and the maker collects openings off-chain at reveal.
- **ASP allow-list** is seeded with 16 deterministic test identities (not real KYC).
- **Trusted setup** phase-1 is a locally-generated Powers-of-Tau (2^14) for the
  hackathon build; production wants the Hermez perpetual ceremony + multi-party phase-2.
- **Not audited — do not use with real assets.**

The BN254 Groth16 verifier pattern is adapted from Nethermind's
[stellar-private-payments](https://github.com/NethermindEth/stellar-private-payments)
reference (Apache-2.0 / GPLv3).

---

## Repository layout

```
circuits/        Circom — bidValidity, auctionResult (+ lib/merkleProof)
contracts/otc/   Soroban desk: RFQ, commit_bid, settle, escrow, poseidon.rs
contracts/build/ compiled verifier + otc WASMs
deployments/     testnet.json — live contract ids + proof links
frontend/        landing (index.html) + desk (app.html/app.js) + in-browser proving
                 stellar.js (chain), prover.js (snarkjs), wallet.js (Freighter)
scripts/         build / prove / convert / deploy / e2e helpers
docs/            ARCHITECTURE, SECURITY, ONCHAIN, DEMO_SCRIPT
```

---

## Run it

```bash
npm install

# A) Off-chain: compile + prove + verify BOTH circuits (Groth16/BN254)
npm run circuit:all          # or circuit:bid / circuit:auction

# B) Launch the desk (in-browser ZK proving against the live testnet contract)
npm run serve                # -> http://localhost:8000

# C) Full live flow on testnet (post -> 3 sealed bids -> Vickrey settle)
node scripts/e2e-testnet.mjs
```

**On-chain** (contracts already deployed — IDs above):
- Build a verifier WASM: `bash scripts/wsl-build-verifier.sh circuits/build/<name>_vk.json <out>.wasm`
- Build the desk: `bash scripts/wsl-build-otc.sh` (`cargo test` in `contracts/otc` → 16/16)
- Deploy: `bash scripts/wsl-deploy.sh`

> Soroban contract builds run in **WSL/Linux** — Windows lacks the MSVC `link.exe`
> the host build scripts need.

---

## License

Apache-2.0 unless noted. Portions adapted from Nethermind's stellar-private-payments
(Apache-2.0 / GPLv3) and circom/circomlib (GPLv3).
