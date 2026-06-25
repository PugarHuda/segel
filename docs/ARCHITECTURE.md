# Segel — Architecture

Three layers: **off-chain ZK** (circuits + in-browser proving), **on-chain**
(Soroban desk + two BN254 Groth16 verifiers), and **the client** (landing + desk
UI that proves in the browser and signs real transactions).

```
 maker ──post_rfq──────────────▶ ┌────────────────────────┐
 taker ─commit(C)+bidValidity──▶ │  otc desk (Soroban)    │──verify──▶ bidValidity verifier
 taker ─escrow (USDC)──────────▶ │  RFQ · commit-set ·    │
 maker ─settle+auctionResult──▶  │  escrow · nullifiers   │──verify──▶ auctionResult verifier
                                 └───────────┬────────────┘
                                  pays winner│refunds losers (USDC SAC)
```

## Circuits (Groth16 / BN254)

### bidValidity (8 public inputs)
`[commit, bandMin, bandMax, availBal, bidder, aspRoot, rfqId, nullifier]`

Private: `bid, nonce, idSecret, pathElements[10], leafIndex`. Constraints:
- `commit == Poseidon(bid, nonce, bidder)` — commitment binding
- `bid` is 64-bit; `bandMin ≤ bid ≤ bandMax` — in-band
- `bid ≤ availBal` — proof-of-funds (availBal pinned to the escrow = `band_max`)
- `Poseidon(idSecret)` ∈ Merkle(`aspRoot`) — allow-list membership, identity hidden
- `nullifier == Poseidon(idSecret, rfqId)` — one bid per identity per RFQ

### auctionResult (19 public inputs, N=8 slots)
`[rfqId, winnerAddr, clearingPrice, commit[8], bidder[8]]`

Private: `bid[8], nonce[8], winnerIdx, runnerIdx`. Constraints:
- each `commit[i] == Poseidon(bid[i], nonce[i], bidder[i])` — binds the proof to
  exactly the on-chain commitments
- `winnerBid = bid[winnerIdx]`; `winnerBid ≥ bid[i]` ∀i — winner is the maximum
- mask out the winner, prove `runnerBid` is the max of the rest, and
  `clearingPrice == runnerBid` — **Vickrey second-price**, fully in-circuit
- `winnerAddr == bidder[winnerIdx]` — contract learns who to pay, nothing else

Empty slots are padded with `bid=0, nonce=0, bidder=0` → `commit = Poseidon(0,0,0)`.
The contract pads the recorded commitments identically before verifying.

## On-chain (contracts/otc)

`post_rfq` → `commit_bid` (verify bidValidity, lock escrow, record commit +
nullifier) → `settle` (verify auctionResult, pay winner's clearing to maker,
refund surplus + losers) / `cancel_expired` (refund all).

**Binding.** For each proof the contract builds the public-input `Vec<Bn254Fr>`
itself, in circuit order, from values it controls — the authenticated bidder
(`addr_field(from)`), the RFQ band, the recorded commitments. It never trusts a
caller-supplied input vector, so a valid proof can't be replayed with a different
bid / identity / bid-set.

`field encodings`: integers → 32-byte big-endian → `Bn254Fr::from_bytes` (reduces
mod r). `addr_field` = `keccak256(addr ScVal XDR) mod r`, matched bit-for-bit by
`stellar.js` in the browser.

## Client

- `prover.js` — Poseidon (circomlibjs) + snarkjs `groth16.fullProve` for both
  circuits; converts proofs to Soroban args (G2 c1‖c0 ordering).
- `stellar.js` — RPC reads (rfqs, bids, balances, poseidon_hash) + signed writes
  via `@stellar/stellar-sdk` (Freighter or embedded demo key).
- `app.js` — the desk UI (vanilla, faithful to the Claude Design source).

Bid amounts are computed and proved entirely client-side; only commitments and
proofs go on-chain.
