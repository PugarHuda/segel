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

- **29/29 unit tests** (`contracts/otc/src/test.rs`): escrow lock, duplicate
  nullifier, deadline, capacity (N=8), winner payout + refunds, bad clearing,
  double-settle, no-bids, cancel-before-deadline, unknown RFQ, on-chain Poseidon,
  the `band_min` reserve (single-bid clears rejected), the claimable-refund
  fallback (a blocked refund is credited, then `claim()`-ed once the bidder can
  receive again), DvP delivery (winner receives the sell-side lot at settle /
  maker gets it back on cancel), the base≠quote-token guard, the base-claimable
  fallback (a winner who can't receive the lot is credited + `claim_base()`-es it),
  the oracle price-guard (clearing near the Reflector mark passes / off-market
  rejected), and directed Direct-OTC access control (only the invited taker may bid;
  an outsider is rejected `#15`; an open RFQ accepts anyone).
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
- **DvP pricing is per-lot, not per-unit.** `clearing` is the TOTAL quote (USDC)
  the winner pays for the WHOLE escrowed lot — bidders bid a total price for the
  lot, not a unit rate. The maker sizes both the band and the lot, so a misconfig
  only harms the maker's own auction. The oracle price-guard (below) backstops it.
- **Oracle price-guard (admin circuit-breaker) — honest scope.** When armed
  (`set_price_guard`), `settle` reads the live Reflector mark and rejects a clearing
  total outside ±bps of the lot's market value (`mark_price(base) × base_amount`).
  It is a **fat-finger / honest-misconfiguration net**, *not* an anti-manipulation
  control: the maker supplies the band, the base symbol, and the lot size, so an
  adversarial maker can widen or skip it (e.g. choose a symbol with no feed). The
  real binding on `clearing` is the `auctionResult` proof (clearing = second-highest
  *sealed* bid, proven). The guard's value is catching an honest mistake and making
  the oracle read part of the money path (proven live: an off-market clearing is
  rejected `#14` before proof verification; a near-market one passes the guard). It
  **fails open** — never bricks settle — when disabled, when an RFQ has no base
  symbol, when the feed returns no/zero price, or if the product would overflow; and
  `cancel_expired` bypasses it entirely, so it can never lock funds. Live band: ±50%.
  No staleness check (a ±50% band tolerates far more than XLM moves between feed
  updates); production with a tight band wants one.
- **DvP delivery + refunds are un-griefable.** Both loser refunds and the winner's
  base-lot delivery use a non-reverting transfer; a recipient who can't receive is
  credited (`claim()` for quote, `claim_base()` for the lot) instead of bricking
  the batch. The base asset must differ from the quote token (enforced), so the lot
  and bidders' escrow can't commingle. The leg key clears on delivery/refund.
- **Self-trade allowed.** A maker may win their own RFQ via a distinct ZK identity
  (the no-wallet demo does exactly this); it nets to a no-op plus one forfeited
  escrow and is not treated as an error.
- **Decimal parity assumed.** Quote and base SACs are assumed 7-decimal (Circle
  USDC + native XLM both are). Pointing `set_token` at a non-7-dp asset would need
  a scaling pass — an admin responsibility, not a user path.
- **Trusted setup.** phase-1 is a local Powers-of-Tau (2^14); production needs the
  Hermez ceremony + multi-party phase-2.
- **Early settle.** `settle` is gated on maker auth + status, *not* the deadline, so
  a maker can settle as soon as bids land (cutting off later competition) — bidders
  get no on-chain run-to-deadline guarantee. (The related single-bidder-clears-at-0
  flaw and the refund-batching DoS are now **fixed** — see properties 7 and 9.)
- **Circuit range checks lean on the contract (defense-in-depth).** A deep circuit
  audit confirmed both circuits are sound (winner = true argmax, clearing = exact
  second price, all 8 commitments bound, Merkle + nullifier fully constrained, no
  unconstrained signals, no field-wrap on bid comparisons). One defensive note:
  `bandMin`/`bandMax`/`availBal` feed 64-bit comparators without an *in-circuit*
  `Num2Bits`, so their safety relies on the contract pinning them into `(0, 2^64)`
  (it does: `create_rfq` rejects bands outside that, and `availBal = band_max`).
  Not exploitable in the deployed system; a standalone circuit reuse would want
  three explicit `Num2Bits(64)` to be self-contained.
