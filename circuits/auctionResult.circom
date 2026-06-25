pragma circom 2.1.6;

// Segel — auctionResult circuit  (the heart: this is impossible without ZK)
// -----------------------------------------------------------------------------
// At settlement the prover takes ALL sealed bids and produces ONE proof that
// the announced winner and clearing price are correct — while every LOSING bid
// stays hidden forever. The public outputs are only: who won and what they pay.
//
// Proven (for N fixed bid slots, empty slots padded with bid=0):
//   * BINDING       each commit[i] = Poseidon(bid[i], nonce[i], bidder[i]) —
//                   the proof is over exactly the commitments recorded on-chain.
//   * WINNER = MAX  winnerBid >= bid[i] for every i (global maximum).
//   * SECOND-PRICE  clearingPrice = the highest bid among the NON-winners
//                   (Vickrey). Computed in-circuit by masking out the winner
//                   and proving the runner-up is the max of the rest.
//   * WINNER ADDR   winnerAddr = bidder[winnerIdx], so the contract knows who to
//                   pay — without learning any losing bid.
//
// Public  : rfqId, winnerAddr, clearingPrice, commit[N], bidder[N]
// Private : bid[N], nonce[N], winnerIdx, runnerIdx
//
// To switch to a first-price auction, replace the final `clearingPrice ===
// runnerBid;` with `clearingPrice === winnerBid;`.
// -----------------------------------------------------------------------------

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

// Selects arr[idx] and exposes the one-hot mask of idx over [0, N).
template Selector(N) {
    signal input idx;
    signal input arr[N];
    signal output out;
    signal output onehot[N];

    component eq[N];
    for (var i = 0; i < N; i++) {
        eq[i] = IsEqual();
        eq[i].in[0] <== idx;
        eq[i].in[1] <== i;
        onehot[i] <== eq[i].out;
    }
    // exactly one position selected (also forces idx in range)
    var s = 0;
    for (var i = 0; i < N; i++) { s += onehot[i]; }
    s === 1;

    signal partial[N + 1];
    partial[0] <== 0;
    for (var i = 0; i < N; i++) {
        partial[i + 1] <== partial[i] + onehot[i] * arr[i];
    }
    out <== partial[N];
}

template AuctionResult(N) {
    // ---- PUBLIC ----
    signal input rfqId;
    signal input winnerAddr;
    signal input clearingPrice;
    signal input commit[N];
    signal input bidder[N];

    // ---- PRIVATE ----
    signal input bid[N];
    signal input nonce[N];
    signal input winnerIdx;
    signal input runnerIdx;

    // 1. Bind every commitment to its hidden (bid, nonce, bidder).
    component cm[N];
    for (var i = 0; i < N; i++) {
        cm[i] = Poseidon(3);
        cm[i].inputs[0] <== bid[i];
        cm[i].inputs[1] <== nonce[i];
        cm[i].inputs[2] <== bidder[i];
        commit[i] === cm[i].out;
    }

    // 2. Every bid is a 64-bit value (comparators below need bounded inputs).
    component rb[N];
    for (var i = 0; i < N; i++) {
        rb[i] = Num2Bits(64);
        rb[i].in <== bid[i];
    }

    // 3. Winner selection + global-max proof.
    component wSel = Selector(N);
    wSel.idx <== winnerIdx;
    for (var i = 0; i < N; i++) { wSel.arr[i] <== bid[i]; }
    signal winnerBid;
    winnerBid <== wSel.out;

    component wAddr = Selector(N);
    wAddr.idx <== winnerIdx;
    for (var i = 0; i < N; i++) { wAddr.arr[i] <== bidder[i]; }
    winnerAddr === wAddr.out;

    component wge[N];
    for (var i = 0; i < N; i++) {
        wge[i] = GreaterEqThan(64);
        wge[i].in[0] <== winnerBid;
        wge[i].in[1] <== bid[i];
        wge[i].out === 1;
    }

    // 4. Mask out the winner, then prove the runner-up is the max of the rest.
    signal masked[N];
    for (var i = 0; i < N; i++) {
        masked[i] <== bid[i] * (1 - wSel.onehot[i]);
    }

    component rSel = Selector(N);
    rSel.idx <== runnerIdx;
    for (var i = 0; i < N; i++) { rSel.arr[i] <== masked[i]; }
    signal runnerBid;
    runnerBid <== rSel.out;

    // runnerIdx must differ from winnerIdx (their one-hots cannot overlap).
    signal overlap[N + 1];
    overlap[0] <== 0;
    for (var i = 0; i < N; i++) {
        overlap[i + 1] <== overlap[i] + wSel.onehot[i] * rSel.onehot[i];
    }
    overlap[N] === 0;

    component rge[N];
    for (var i = 0; i < N; i++) {
        rge[i] = GreaterEqThan(64);
        rge[i].in[0] <== runnerBid;
        rge[i].in[1] <== masked[i];
        rge[i].out === 1;
    }

    // 5. Vickrey: the price is the second-highest bid.
    clearingPrice === runnerBid;
}

component main { public [ rfqId, winnerAddr, clearingPrice, commit, bidder ] } = AuctionResult(8);
