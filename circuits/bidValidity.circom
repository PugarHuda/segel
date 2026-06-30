pragma circom 2.1.6;

// Segel — bidValidity circuit
// -----------------------------------------------------------------------------
// Proven CLIENT-SIDE when a taker seals a bid, verified ON-CHAIN by Soroban
// before the bid is recorded. It establishes everything the desk needs to trust
// about a sealed bid — WITHOUT ever revealing the bid amount:
//
//   1. BINDING        commit = Poseidon(bid, nonce, bidder)  — the on-chain
//                     commitment really opens to this hidden bid.
//   2. IN-BAND        bandMin <= bid <= bandMax               — a malformed /
//                     out-of-band bid dies on arrival, amount never leaks.
//   3. PROOF-OF-FUNDS bid <= availBal                         — the bidder can
//                     actually honor the bid. The contract pins `availBal` to
//                     `band_max` (the public escrow) and then transfers that
//                     escrow from the bidder, which MUST succeed — so the hidden
//                     bid is bound to real funds (a live-balance read would be
//                     racy; the escrow transfer is the stronger witness).
//   4. ALLOWLIST      Poseidon(idSecret) in the ASP allow-list (Merkle root
//                     public) — compliant access, the KYC identity stays hidden.
//   5. NULLIFIER      nullifier = Poseidon(idSecret, rfqId)   — one bid per
//                     identity per RFQ (Sybil resistance), identity hidden.
//
// Public  : commit, bandMin, bandMax, availBal, bidder, aspRoot, rfqId, nullifier
// Private : bid, nonce, idSecret, pathElements[levels], leafIndex
//
// `bidder` is PUBLIC (the tx is signed by that account); the contract sets it to
// field(from), so the proof shows *this* account's commitment. The bid amount,
// the blinding nonce, and the KYC identity all stay private.
// -----------------------------------------------------------------------------

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "./lib/merkleProof.circom";

template BidValidity(levels) {
    // ---- PUBLIC ----
    signal input commit;
    signal input bandMin;
    signal input bandMax;
    signal input availBal;     // bidder's real on-chain balance (contract-pinned)
    signal input bidder;       // field(from) — public, signs the tx
    signal input aspRoot;      // ASP allow-list Merkle root
    signal input rfqId;        // the RFQ being bid on
    signal input nullifier;    // one-bid-per-identity tag

    // ---- PRIVATE ----
    signal input bid;
    signal input nonce;
    signal input idSecret;     // KYC identity secret (never revealed)
    signal input pathElements[levels];
    signal input leafIndex;

    // 1. Commitment binding.
    component cm = Poseidon(3);
    cm.inputs[0] <== bid;
    cm.inputs[1] <== nonce;
    cm.inputs[2] <== bidder;
    commit === cm.out;

    // 2. bid is a non-negative 64-bit value (no field-wrap), then in-band.
    component rb = Num2Bits(64);
    rb.in <== bid;

    component geMin = GreaterEqThan(64);
    geMin.in[0] <== bid;
    geMin.in[1] <== bandMin;
    geMin.out === 1;

    component leMax = LessEqThan(64);
    leMax.in[0] <== bid;
    leMax.in[1] <== bandMax;
    leMax.out === 1;

    // 3. Proof of funds: bid <= available balance.
    component leBal = LessEqThan(64);
    leBal.in[0] <== bid;
    leBal.in[1] <== availBal;
    leBal.out === 1;

    // 4. Allowlist membership of the hidden identity.
    component idLeaf = Poseidon(1);
    idLeaf.inputs[0] <== idSecret;

    component idxBits = Num2Bits(levels);
    idxBits.in <== leafIndex;

    component tree = MerkleProof(levels);
    tree.leaf <== idLeaf.out;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== idxBits.out[i];
    }
    aspRoot === tree.root;

    // 5. Nullifier binds the hidden identity to this RFQ (one bid per identity).
    component nf = Poseidon(2);
    nf.inputs[0] <== idSecret;
    nf.inputs[1] <== rfqId;
    nullifier === nf.out;
}

component main { public [ commit, bandMin, bandMax, availBal, bidder, aspRoot, rfqId, nullifier ] } = BidValidity(10);
