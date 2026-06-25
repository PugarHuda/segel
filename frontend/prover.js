// Segel — in-browser zero-knowledge proving.
//   * Poseidon commitments + nullifiers (circomlibjs, identical to the circuits
//     and the on-chain poseidon_hash).
//   * Groth16 proofs for bidValidity (sealing a bid) and auctionResult (settling),
//     generated entirely client-side with snarkjs. Bid amounts never leave the
//     device — only the commitment and the proof go on-chain.
import * as snarkjs from "https://esm.sh/snarkjs@0.7.5";
import { buildPoseidon } from "https://esm.sh/circomlibjs@0.1.7";

const N = 8; // auctionResult fixed bid slots

let _poseidon, _F, _asp;
async function poseidon() {
  if (!_poseidon) {
    _poseidon = await buildPoseidon();
    _F = _poseidon.F;
  }
  return _poseidon;
}
function pos(arr) {
  return _F.toObject(_poseidon(arr.map((x) => BigInt(x))));
}
export async function loadAsp() {
  if (!_asp) _asp = await (await fetch("./circuit/asp.json")).json();
  return _asp;
}

// snarkjs proof -> Soroban contract args (G2 uses c1||c0 ordering).
const fe = (d) => BigInt(d).toString(16).padStart(64, "0");
const g1 = (pt) => fe(pt[0]) + fe(pt[1]);
const g2 = (pt) => fe(pt[0][1]) + fe(pt[0][0]) + fe(pt[1][1]) + fe(pt[1][0]);
const buf = (hex) => Uint8Array.from(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
export const buf32 = (dec) => buf(BigInt(dec).toString(16).padStart(64, "0"));
export const toHex32 = (dec) => fe(dec);
export const scProof = (p) => ({ a: buf(g1(p.pi_a)), b: buf(g2(p.pi_b)), c: buf(g1(p.pi_c)) });

/** Poseidon(bid, nonce, bidderField) — the sealed-bid commitment. */
export async function commitOf(bid, nonce, bidderField) {
  await poseidon();
  return pos([bid, nonce, bidderField]).toString();
}
/** Poseidon(idSecret, rfqId) — the one-bid-per-identity nullifier. */
export async function nullifierOf(idSecret, rfqId) {
  await poseidon();
  return pos([idSecret, rfqId]).toString();
}

/**
 * Build a bidValidity proof for one sealed bid. Returns the Soroban proof plus
 * the commitment + nullifier (decimal) the contract will record.
 */
export async function proveBid({ bid, nonce, bidderField, rfqId, bandMin, bandMax, availBal, aspIndex }) {
  await poseidon();
  const asp = await loadAsp();
  const m = asp.members[aspIndex];
  const commit = pos([bid, nonce, bidderField]).toString();
  const nullifier = pos([m.idSecret, rfqId]).toString();
  const input = {
    commit, bandMin: String(bandMin), bandMax: String(bandMax), availBal: String(availBal),
    bidder: String(bidderField), aspRoot: asp.root, rfqId: String(rfqId), nullifier,
    bid: String(bid), nonce: String(nonce), idSecret: m.idSecret,
    pathElements: m.pathElements, leafIndex: m.leafIndex,
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input, "./circuit/bidValidity.wasm", "./circuit/bidValidity_final.zkey",
  );
  return { proof: scProof(proof), rawProof: proof, publicSignals, commit, nullifier };
}

/**
 * Build an auctionResult proof from the full set of bid openings. Pads to N with
 * the canonical empty slot (bid=0, nonce=0, bidder=0). Derives the Vickrey
 * outcome (winner=argmax, clearingPrice=second-highest) and proves it.
 * `bids` = [{ bid, nonce, bidderField }] in on-chain order.
 */
export async function proveAuction({ rfqId, bids }) {
  await poseidon();
  const bid = [], nonce = [], bidder = [], commit = [];
  for (let i = 0; i < N; i++) {
    if (i < bids.length) {
      bid[i] = BigInt(bids[i].bid);
      nonce[i] = BigInt(bids[i].nonce);
      bidder[i] = BigInt(bids[i].bidderField);
    } else {
      bid[i] = 0n; nonce[i] = 0n; bidder[i] = 0n;
    }
    commit[i] = pos([bid[i], nonce[i], bidder[i]]);
  }
  // winner = global max; runner = max of the rest (Vickrey clearing price)
  let winnerIdx = 0;
  for (let i = 1; i < N; i++) if (bid[i] > bid[winnerIdx]) winnerIdx = i;
  let runnerIdx = -1;
  for (let i = 0; i < N; i++) {
    if (i === winnerIdx) continue;
    if (runnerIdx === -1 || bid[i] > bid[runnerIdx]) runnerIdx = i;
  }
  const winnerAddr = bidder[winnerIdx];
  const clearingPrice = bid[runnerIdx];
  const input = {
    rfqId: String(rfqId), winnerAddr: winnerAddr.toString(), clearingPrice: clearingPrice.toString(),
    commit: commit.map((x) => x.toString()), bidder: bidder.map((x) => x.toString()),
    bid: bid.map((x) => x.toString()), nonce: nonce.map((x) => x.toString()),
    winnerIdx: String(winnerIdx), runnerIdx: String(runnerIdx),
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input, "./circuit/auctionResult.wasm", "./circuit/auctionResult_final.zkey",
  );
  return {
    proof: scProof(proof), rawProof: proof, publicSignals,
    winnerIdx, runnerIdx, clearingPrice: clearingPrice.toString(),
    winnerField: winnerAddr.toString(),
  };
}
