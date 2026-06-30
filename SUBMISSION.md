# Segel — submission (Stellar Hacks: Real-World ZK)

> **Confidential sealed-bid OTC desk on Stellar. Bids sealed. Settlement proven.
> Losing amounts never revealed.**

- 🌐 **Live:** https://segel.vercel.app  (landing) · https://segel.vercel.app/app (desk)
- 💻 **Code:** https://github.com/PugarHuda/segel  (branch `master`)
- 🎬 **Demo:** [`frontend/segel-demo.mp4`](frontend/segel-demo.mp4) (~55s silent walkthrough; narrated script: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md))
- ⛓️ **Network:** Stellar **testnet** (Soroban) — every claim below has an on-chain proof link.

---

## The problem (real-world)

OTC desks leak. The moment a large block trade's bids are visible — on a DEX order
book or in a broker's chat room — the market front-runs them. So price discovery for
size happens in opaque venues you have to *trust*. There is no way today to run a fair
sealed auction on-chain without either (a) revealing every bid, or (b) trusting an
operator to settle honestly.

## The solution

Segel is an on-chain sealed-bid OTC desk where:
- **bid amounts are cryptographically sealed** (a Poseidon commitment),
- the **fair Vickrey (second-price) clearing price is proven correct in zero-knowledge**, and
- **every losing bid stays hidden forever** — on-chain, to the public, and to competing desks —
- while the whole settlement remains **verifiable on Stellar**.

It's a real **two-asset delivery-vs-payment** swap (the maker escrows a lot delivered
to the winner against payment), settled in **Circle's real testnet USDC**. It runs
both **open auctions** and **directed Direct OTC** — a maker can invite one
counterparty (enforced on-chain: only that address may bid), so the same desk covers
multi-bidder price discovery *and* private bilateral trades.

## Why the ZK is *load-bearing* (the hackathon's headline rule)

Two Circom/Groth16/BN254 circuits, **verified on-chain by deployed Soroban verifier
contracts** via the BN254 host functions (Protocol 25/26). Remove them and the product
cannot exist — there is no other way to settle a sealed auction without leaking bids or
trusting an operator.

| Circuit | Proves (all in-circuit) |
|---|---|
| **bidValidity** | `commit = Poseidon(bid,nonce,addr)` · `band_min ≤ bid ≤ band_max` · proof-of-funds (`bid ≤ escrow`) · ASP allow-list membership (KYC identity hidden) · fresh nullifier (1 bid / identity / RFQ) |
| **auctionResult** | every commitment binds · `winner = argmax` · `clearingPrice = second-highest` (Vickrey) · losing bids never appear in the output |

**Binding** is the security crux: the contract builds every verifier public-input
vector itself from values it controls (authenticated bidder, RFQ band, recorded
commitments) — it never trusts a caller-supplied vector, so a valid proof can't be
replayed with a different bid, identity, or bid-set.

**Soundness is checked live, not asserted** — `npm run test:tamper-onchain`: a real
auctionResult proof verifies on the *deployed* verifier (`true`); flip the
clearing-price input and the **same** proof is rejected on-chain (the Groth16 pairing
check fails). A judge can run it in one command.

## What's live on testnet (with proof)

| Contract | Role | Proof |
|---|---|---|
| [otc desk `CBAJVX6X`](https://stellar.expert/explorer/testnet/contract/CBAJVX6XPPGCMIQRWABO6ZOGQH7PJXTF4XB3MTAC35M4SBRLSIYXBBZM) | RFQ, sealed commit-set, Circle-USDC escrow, Vickrey settle, **DvP** delivery, un-griefable refunds, oracle price-guard, directed Direct-OTC, in-place upgradeable | DvP run #13: [post+20 XLM](https://stellar.expert/explorer/testnet/tx/a16e4dae39c9595dd8dd2fcb4fdd44d30fc88eca10385d2cb7e63767706875e1) · [bid](https://stellar.expert/explorer/testnet/tx/02afe9fc9ca8b4b465ec477f3e9abddaad5a6d2ae63f34ba1555e31c9c3ec495) · [settle+deliver](https://stellar.expert/explorer/testnet/tx/95dfea5077c2ba29d5357a2e0b6fd93d3098fbbefcf5062f7ad241ed7b00c41e) |
| [bidValidity verifier](https://stellar.expert/explorer/testnet/contract/CAL5XO2NPC2ZFVQSXX7HSS6ARQOX6GL24LCR5SZVEIKENOLN2HUOK7DK) | verifies sealed-bid validity on-chain | `verify` → [`true`](https://stellar.expert/explorer/testnet/tx/8994686dc5d787c63c3690db810aec2653dae9dbf7a3b6c5818fe151a5624862) |
| [auctionResult verifier](https://stellar.expert/explorer/testnet/contract/CCEZVOKXYPUH67KAVVQ6ZZAPUUXSE7ENBO3OLTTLHCVKDMJHOLGGJEBY) | verifies Vickrey settlement on-chain | `verify` → `true`; tampered → rejected (`npm run test:tamper-onchain`) |

Escrow asset = **Circle's canonical testnet USDC** (issuer `GBBD47IF…`, ~38k holders).
Oracle = **Reflector** SEP-40 testnet feed.

## Depth of integration (organizer + partner tools)

| Tool / primitive | Depth |
|---|---|
| BN254 pairing / MSM / Fr host fns (P25/26) | **Load-bearing** — both Groth16 proofs verified on-chain (the rarest thing in this field) |
| Soroban contract | **Load-bearing** — full lifecycle, escrow custody, upgradeable, CEI ordering |
| On-chain Poseidon (hand-rolled on BN254 host ops) | **Load-bearing** — bit-identical to circomlib; commitment scheme verifiable on-chain |
| Circle USDC (SAC) | **Load-bearing** — real escrow + settlement, migrated live via `upgrade()`+`set_token` |
| Reflector oracle (SEP-40) | **Consumed in `settle`** as a price circuit-breaker (honest scope below) |
| Two-asset DvP (native XLM lot) | **Load-bearing** — a true swap, not a one-sided payment |
| Directed Direct OTC (invited taker) | **Load-bearing** — on-chain enforced (`commit_bid` rejects non-invited, #15); open auctions + private bilateral in one desk |
| Selective disclosure (UI + CLI) | compliance primitive on the auction's own commitments — prove a hidden bid to an auditor, bindingly |
| Freighter / Stellar SDK | real signing + in-browser proving + live reads |
| MCP server (read-only) | an AI agent can query the live desk (`list_rfqs`, `read_settlement`, `mark_price`) — setup in the README |

## Where Segel fits in Stellar's privacy stack

Stellar's privacy stack is emerging fast — **Confidential Tokens** (OpenZeppelin +
Nethermind, testnet Developer Preview: hide balances + transfer amounts between
*known* parties) and **Stellar Private Payments / privacy pools** (hide *parties* +
amounts). Both are **payment** primitives. Segel occupies a **distinct, complementary
slot they don't cover: confidential *price discovery*** — a sealed-bid auction where
losing bids are proven valid but never revealed, and the fair Vickrey price is proven,
not trusted. (Segel's on-chain Groth16 verifier tooling is itself derived from the
Stellar private-payments reference workspace — it's built *on* the same privacy
lineage.)

- **Complementary, not competing:** CT/SPP move value privately; Segel *discovers a
  price* privately. A confidential token can't run an auction; an auction needs a
  mechanism + a soundness proof, which is exactly what Segel adds.
- **Selective disclosure — already shipped** (in the UI: **Portfolio → Disclose** /
  **Verify a disclosure**; and on the CLI: `npm run disclose`). The same compliance
  primitive Confidential Tokens highlights, on Segel's *own* commitments, no wrapper
  needed: a bidder can prove to a chosen party the exact value they bid —
  checked against the real on-chain commitment — without it ever being public, and
  without being able to lie (any other value yields a different Poseidon commitment).
  It's especially sharp here because the **winner's true bid is hidden on-chain**
  (Vickrey: they pay the *second* price), yet they can still disclose it bindingly to
  an auditor/counterparty. Demonstrated live against RFQ #13's settled commitments.
- **Honest future work (a real integration, not a deadline hack):** settle the
  winning leg through a **Confidential Token** so the *notional/size* stays private
  while Segel keeps the *price* publicly proven. We deliberately did **not** bolt the
  brand-new CT preview (Noir/UltraHonk, audits in progress) onto our working
  Circom/Groth16 stack at the deadline — combining two proof systems safely is a
  project, not a demo patch.

## Honest scope (what we do *not* overclaim)

- **The settle prover sees the bid openings.** A sealed-bid settler must, to compute
  the result (normal auctioneer property). Segel hides losers from the
  **public/chain**; hiding them from the auctioneer too needs MPC (future work).
- **The oracle price-guard is a fat-finger net, not an anti-manipulation control.**
  The maker supplies the band + base symbol, so it's an honest-misconfig
  circuit-breaker; the **auctionResult ZK proof** is the real binding on the price.
- **Demo identity / KYC.** The no-wallet demo plays maker + several bidders with one
  key via distinct ZK identities; the ASP allow-list is 16 deterministic test
  secrets, not real KYC.
- **Trusted setup** is a local phase-1 Powers-of-Tau (2^14); production wants the
  Hermez ceremony + multi-party phase-2.

(Nothing in a load-bearing path is mocked — the "USDC" is real Circle USDC, the
verifiers are real, the oracle read is real, the proofs are generated in-browser.)

## How to run / verify it yourself

```bash
npm install && npm run circuit:all
npm run serve                  # http://localhost:8000 — the live desk
npm run test:proving           # 6/6 — both circuits prove + verify
npm run test:negative          # 10/10 — soundness (bad witnesses rejected)
npm run test:tamper-onchain    # tampered proof rejected by the LIVE verifier
npm run disclose               # selective disclosure: prove a sealed bid's value vs the on-chain commitment (binding, private)
npm run e2e                    # full DvP flow on testnet: post lot → 3 sealed bids → settle+deliver
npm run test:e2e-ui            # Playwright: real-click journey through the desk (E2E_WRITE=1 also posts+bids on-chain)
# contracts: cargo test in contracts/otc → 26/26
```

## Mapping to judging criteria (honest self-assessment)

| Criterion | Self-score | Evidence |
|---|---|---|
| **ZK is load-bearing** (headline) | 10/10 | two Groth16/BN254 circuits verified *on-chain*; remove them → no product |
| Technical execution | 9/10 | on-chain pairing + hand-rolled Poseidon + binding + CEI + un-griefable refunds + live upgrade + runnable on-chain tamper proof |
| Stellar / ecosystem integration | 8–9/10 | real Circle USDC, DvP, Reflector consumed-in-settle, Freighter, MCP |
| Innovation | 8/10 | confidential Vickrey OTC with hidden losing bids; AI-agent (MCP) access |
| Real-world applicability | 8/10 | OTC block-trade confidentiality is a real institutional pain |
| Completeness / polish | 9/10 | live site, live e2e, 26/26 tests, demo video, deep docs, MCP |

**Overall (self): ~8.5/10.** Built solo in two weeks; everything above is live and
reproducible.
