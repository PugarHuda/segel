# Segel — Security notes & threat model

Research prototype for a hackathon. **Not audited. Do not use with real assets.**

## Properties the design enforces

1. **Bid confidentiality.** A bid appears on-chain only as `Poseidon(bid, nonce,
   addr)`. The amount is never published; it is proved in-band in zero-knowledge.
   What's hidden is the bid **amount** and (via the ASP) each bidder's **KYC
   identity** — *not* participation: bidder addresses and the winner's address are
   public on-chain (`settle` takes `winner` and emits `(winner, clearing)`), and
   refund sizes differ by role, so an observer can tell who won. Hiding the winner
   too would need a different settlement design.
2. **No fake winner / price.** Settlement requires an `auctionResult` proof that
   the winner is the max bid and the clearing price is the second-highest, over
   exactly the recorded commitments. The contract cannot be told a wrong outcome.
3. **Binding (no input swap).** The contract builds every verifier public-input
   vector itself from values it controls (authenticated bidder, RFQ band, recorded
   commitments). A valid proof can't be reused with a different bid, a spoofed
   identity, or a different bid-set — the public inputs would change and
   verification fails. (Tampering the clearing price → `InvalidProof` on-chain.)
4. **Proof-of-funds.** `availBal` is pinned to `band_max` and that escrow is
   actually transferred from the bidder; the transfer must succeed, so the bidder
   provably holds ≥ `band_max` ≥ their hidden bid.
5. **Sybil resistance.** `nullifier = Poseidon(idSecret, rfqId)` — one bid per
   allow-listed identity per RFQ; duplicates are rejected (`NullifierUsed`).
6. **Allow-list compliance.** A bid proves membership in the ASP Merkle allow-list
   (`Poseidon(idSecret)` ∈ root) without revealing which member.
7. **Custody safety.** Escrow can only leave via `settle` (winner pays clearing to
   maker, surplus + losers refunded) or `cancel_expired` (everyone refunded). The
   contract binds the released amounts; `clearing` is range-checked to
   `[band_min, band_max]` — the `band_min` lower bound is a reserve, so a
   single-bidder auction (Vickrey runner-up = padded 0) cannot clear at 0.
8. **Verifier fail-closed.** `verify` asserts the returned bool, so a verifier that
   returns `false` can never make a proof check a silent no-op.
9. **Un-griefable refunds.** `settle`/`cancel_expired` refund each bidder with a
   non-reverting transfer; if one fails (e.g. a bidder dropped their USDC trustline),
   the amount is credited as a **claimable** balance and pulled later via `claim()`,
   so no single bidder can revert the batch and lock everyone's escrow. State is
   written before any transfer (checks-effects-interactions).

## Tested

- **22/22 unit tests** (`contracts/otc/src/test.rs`): escrow lock, duplicate
  nullifier, deadline, capacity (N=8), winner payout + refunds, bad clearing,
  double-settle, no-bids, cancel-before-deadline, unknown RFQ, on-chain Poseidon,
  the `band_min` reserve (single-bid clears rejected), the claimable-refund
  fallback (a blocked refund is credited, then `claim()`-ed once the bidder can
  receive again), and DvP delivery (winner receives the sell-side lot at settle /
  maker gets it back on cancel).
- **On-chain:** both verifiers return `true` for valid proofs; a tampered
  clearing-price public input is rejected (`Error(Contract,#0)`).
- **Live e2e** (`scripts/e2e-testnet.mjs`): post a 20 XLM lot → 3 sealed bids →
  Vickrey settle with delivery (desk XLM balance proven to go 0→20→0).

## Known limits (honest)

- **The settle prover sees the openings.** A sealed-bid settler must know all bids
  to compute the result (normal for an auctioneer). Segel hides losers from the
  **public/chain**; hiding them from the auctioneer too needs MPC (future work).
- **Demo identity.** In the no-wallet demo one key plays maker + several bidders
  via distinct ZK identities; the ASP allow-list is 16 deterministic test secrets,
  not real KYC.
- **DvP delivery is a hard transfer.** Unlike loser refunds (non-reverting +
  claimable fallback), `settle` delivers the lot to the winner with a hard
  transfer — a winner who can't receive only hurts themselves, so it's not a
  griefing vector. The leg key is cleared on delivery/refund (no double-delivery).
- **Trusted setup.** phase-1 is a local Powers-of-Tau (2^14); production needs the
  Hermez ceremony + multi-party phase-2.
- **Early settle.** `settle` is gated on maker auth + status, *not* the deadline, so
  a maker can settle as soon as bids land (cutting off later competition) — bidders
  get no on-chain run-to-deadline guarantee. (The related single-bidder-clears-at-0
  flaw and the refund-batching DoS are now **fixed** — see properties 7 and 9.)
