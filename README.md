# Segel

> **Confidential sealed-bid OTC desk on Stellar.**
> Bids sealed. Settlement proven. Losing amounts never revealed.

Segel is an on-chain **over-the-counter (OTC) desk** for large trades on Stellar
where **bid amounts are cryptographically sealed**, the **fair clearing price is
proven correct in zero-knowledge** (Vickrey / second-price), and **every losing
bid stays hidden forever** — while the whole thing remains verifiable on-chain.

**Why it matters:** OTC desks leak. The moment a large block trade's bids are
visible, the market front-runs them — so price discovery for size happens in
opaque chat rooms you have to trust. Segel is a sealed-bid desk where the losing
bids are *never revealed* — not to the chain, the public, or competing desks — and
the fair Vickrey clearing price is **proven, not trusted**. Confidentiality without
a trusted operator: exactly the real-world problem zero-knowledge is for.

Built for the [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk)
hackathon. Two Circom/Groth16/BN254 circuits do the real work; a Soroban contract
verifies the proofs on-chain and escrows + settles in **Circle's real testnet
USDC**, delivers the sell-side lot to the winner (DvP), and reads a live Reflector
oracle that backstops settlement with a price circuit-breaker.

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

- **More than a 1-sided auction:** real two-asset **delivery-vs-payment** (the maker
  escrows a lot the winner receives at settle, atomically against payment), escrow +
  settlement in **Circle's real testnet USDC**, a **Reflector** oracle price
  circuit-breaker consumed in `settle`, and a read-only **MCP** server so an AI agent
  can query the live desk. (Honest scope on the oracle: a fat-finger net, not an
  anti-manipulation control — the ZK proof is the real binding on the price.)
- **It runs on Stellar — live on testnet, every claim with a proof link:**

  | Contract | Role | Verified |
  |---|---|---|
  | [otc desk](https://stellar.expert/explorer/testnet/contract/CBAJVX6XPPGCMIQRWABO6ZOGQH7PJXTF4XB3MTAC35M4SBRLSIYXBBZM) | RFQ, sealed-bid commit-set, real Circle-USDC escrow, Vickrey settle, two-asset **DvP** delivery, un-griefable refunds, oracle price-guard, in-place upgradeable | DvP run (RFQ #13): [post+20 XLM lot](https://stellar.expert/explorer/testnet/tx/a16e4dae39c9595dd8dd2fcb4fdd44d30fc88eca10385d2cb7e63767706875e1) · [bid](https://stellar.expert/explorer/testnet/tx/02afe9fc9ca8b4b465ec477f3e9abddaad5a6d2ae63f34ba1555e31c9c3ec495) · [settle+deliver](https://stellar.expert/explorer/testnet/tx/95dfea5077c2ba29d5357a2e0b6fd93d3098fbbefcf5062f7ad241ed7b00c41e) live |
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
   public outputs are the winner and the clearing price. **Every losing bid
   _amount_ stays secret** (the winner's address and the clearing price are
   public on-chain; what stays hidden is the losing numbers and — via the ASP —
   every bidder's KYC identity). The contract verifies the proof, then pays the winner's clearing
   price to the maker, refunds the winner's surplus, and refunds every loser.

This is impossible without ZK (or a trusted operator / heavy MPC). The proofs are
**Groth16 over BN254**, verified on-chain with Stellar's native BN254 host
functions (Protocol 25/26); commitments use a Poseidon built on those same
BN254 field ops (no Poseidon host primitive exists — we hand-roll it, bit-identical to circomlib).

---

## Deep Stellar / ZK integration (core primitives load-bearing)

Nothing here is namechecked. Each **core** item, if removed, breaks the desk. The
oracle is now consumed at settle (as a sanity circuit-breaker, scoped honestly
below); the wallet is a real but optional integration:

| Primitive / tool | Where it does real work |
|---|---|
| **BN254 pairing** (P25) | verifies both Groth16 proofs on-chain |
| **BN254 MSM** (P26) | accumulates the public-input vector inside the verifier |
| **BN254 scalar-field arithmetic** (P26) | the contract builds the public-input `Vec<Bn254Fr>` itself (binding) |
| **Poseidon on-chain** (BN254 host ops) | `poseidon_hash(a,b)` — a circomlib Poseidon hand-rolled on Soroban's BN254 field host ops (there is no Poseidon host primitive), bit-identical to circomlibjs; lets the commitment scheme be verified on-chain, not just asserted |
| **Soroban** | the whole desk: RFQ state, commit-set, escrow custody, settlement |
| **Circle USDC SAC** | escrow + settlement in **Circle's canonical testnet USDC** (issuer GBBD47IF…) via its SAC; winner pays clearing to maker, losers refunded |
| **Reflector oracle (SEP-40)** | _Consumed at settle as a sanity circuit-breaker_ — `mark_price(symbol)` does a real cross-contract `lastprice()` read, and (when armed) `settle` **rejects** a clearing total outside ±bps of the lot's live market value. Honest scope: the maker supplies the band + base symbol, so it's a fat-finger / honest-misconfig net, **not** an anti-manipulation control — the `auctionResult` proof remains the real binding on `clearing`. Proven live on-chain: an off-market settle is rejected (`#14`) before proof check, a near-market one passes the guard |
| **Freighter / embedded key** | real signing of `post_rfq` / `commit_bid` / `settle` |

The contract's **binding** property is the security crux: it never accepts a
pre-built public-input vector. For every proof it constructs the inputs from
values it controls (the authenticated bidder, the RFQ band, the commitments it
actually recorded). So a valid proof can't be reused with a different bid, a
spoofed identity, or a different bid set — any mismatch fails verification.

**Where it fits in Stellar's privacy stack.** Confidential Tokens (hide amounts
between known parties) and Stellar Private Payments (hide parties + amounts) are
*payment* primitives. Segel fills a distinct, complementary slot they don't: a
confidential *price-discovery* mechanism — a sealed auction where losing bids are
proven valid but never revealed. CT/SPP move value privately; Segel discovers a
price privately. (Future work, honestly: settle the winning leg via a Confidential
Token so the size stays private while the price stays publicly proven.)

---

## Try the MCP server (AI-agent access, read-only)

Any MCP client (Claude Desktop, Cursor) can query the **live** desk on-chain — no
RPC wiring, no keys. Add to `claude_desktop_config.json` and restart:

```json
{
  "mcpServers": {
    "segel": { "command": "node", "args": ["mcp/server.mjs"], "cwd": "/abs/path/to/segel" }
  }
}
```

Then ask the agent: *"list_rfqs"*, *"read_settlement of RFQ 13"*, *"mark_price of XLM"*.
Tools: `list_rfqs`, `bid_count`, `clearing_price`, `read_settlement`, `mark_price` —
every one a real on-chain simulate against the live contract. `read_settlement`
reads the outcome the on-chain ZK verifier already accepted (it doesn't re-run the
proof). There is no signing path — the server is read-only by construction.

---

## What's real (not mocked)

- **Real escrow & settlement in Circle USDC.** `commit_bid` pulls a good-faith
  escrow (= `band_max`) from the bidder; `settle` pays the winner's clearing price
  to the maker, refunds the surplus, and refunds every loser — all in **Circle's
  canonical testnet USDC** (issuer `GBBD47IF…`, ~38k holders) via its SAC. The desk
  was migrated to Circle USDC live with no redeploy (admin `upgrade()` + `set_token`),
  keeping the same contract id.
- **Real proof-of-funds.** The escrow transfer must succeed, so the bidder
  provably holds ≥ `band_max` ≥ their hidden bid; the circuit binds `bid ≤ band_max`.
- **Real on-chain verification.** Both verifiers return `true` for valid proofs
  and reject tampered ones on-chain (`InvalidProof`). Reproduce it live in one
  command — `npm run test:tamper-onchain`: a real auctionResult proof verifies on
  the **deployed** verifier (`true`), then flipping the clearing-price public input
  makes the **same** proof fail the on-chain pairing check (rejected). Soundness
  checked on testnet, not asserted.
- **Real Vickrey binding.** `settle` builds the auction public inputs from the
  **recorded** commitments (padded to N=8 with `Poseidon(0,0,0)`), so the proof is
  over exactly the on-chain sealed set — not a set the caller invented.
- **Selective disclosure** — in the UI (**Portfolio → Disclose**, and **Verify a
  disclosure** for the counterparty/auditor) and on the CLI (`npm run disclose`). A
  bidder proves the exact value they bid to a chosen party — checked against the real
  on-chain commitment — without it being public, and without being able to lie (any
  other value yields a different Poseidon commitment). The same compliance primitive
  Confidential Tokens highlights, on Segel's own commitments. It's sharpest for the
  **winner**, whose true bid is hidden on-chain (Vickrey pays the second price) yet
  remains bindingly disclosable to an auditor.
- **Directed Direct OTC.** A maker can invite **one counterparty** (Create → Direct
  OTC → Counterparty); only that address may bid (`commit_bid` rejects everyone else
  on-chain), leaving it empty = open to anyone. The Active RFQs list labels each RFQ
  (`YOU` / `→ YOU` if you're the invited taker / `→ G…` / `reserved`) and has an
  **All / Mine / For me** filter so an invited taker finds RFQs directed to them.
- **Per-identity Sybil resistance.** A nullifier `Poseidon(idSecret, rfqId)` lets
  one identity bid once per RFQ, with the KYC identity hidden via an ASP Merkle
  allow-list.
- **On-chain Poseidon (proven).** `poseidon_hash(1,2)` returns
  `0x115cc0f5…4417189a`, exactly circomlibjs `poseidon([1,2])` (see the Audit tab).
- **Live Reflector oracle (real cross-contract).** `mark_price("XLM")` invokes the
  Reflector SEP-40 testnet feed on-chain and returns the live USD mark (~$0.176);
  `mark_price("USDC")` ≈ $1.001. Surfaced live in the Audit tab.
- **Two-asset delivery-vs-payment (DvP).** `post_rfq_dvp` lets the maker escrow a
  sell-side lot (a second SAC, e.g. native XLM) up front; `settle` delivers it to
  the winner atomically against their USDC payment, `cancel_expired` returns it to
  the maker. Verified live: the desk's XLM balance rises by the lot at post and
  falls by it at settle. The desk is a real swap, not a one-sided payment.
- **26/26 contract unit tests** (`contracts/otc/src/test.rs`) + a full live e2e
  (`scripts/e2e-testnet.mjs`): post a 20 XLM lot → 3 sealed bids → Vickrey settle
  with delivery, on testnet.

## Still honestly simplified
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
- Build the desk: `bash scripts/wsl-build-otc.sh` (`cargo test` in `contracts/otc` → 26/26)
- Deploy: `bash scripts/wsl-deploy.sh`

> Soroban contract builds run in **WSL/Linux** — Windows lacks the MSVC `link.exe`
> the host build scripts need.

---

## License

Apache-2.0 unless noted. Portions adapted from Nethermind's stellar-private-payments
(Apache-2.0 / GPLv3) and circom/circomlib (GPLv3).
