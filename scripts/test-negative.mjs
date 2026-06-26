// QA: circuit SOUNDNESS. Each case feeds a *bad* witness and asserts the circuit
// rejects it (witness generation fails because a constraint is violated). If any
// bad witness produced a proof, the circuit would be unsound — that's a failure.
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import { buildAsp } from "./asp.mjs";

const W = "circuits/build";
const poseidon = await buildPoseidon();
const F = poseidon.F;
const pos = (a) => F.toObject(poseidon(a.map((x) => BigInt(x))));
let pass = 0, fail = 0;

async function mustReject(name, circuit, input) {
  try {
    await snarkjs.groth16.fullProve(input, `${W}/${circuit}_js/${circuit}.wasm`, `${W}/${circuit}_final.zkey`);
    fail++; console.log("  ✗", name, "— UNSOUND: bad witness was accepted!");
  } catch (e) {
    // A genuine soundness rejection fails during witness generation on a VIOLATED
    // CONSTRAINT. A bare catch would also pass on a missing .wasm/.zkey, a malformed
    // input shape, or any other crash — masking a broken test as a "rejection".
    // So we require the error to look like a circom constraint failure.
    const msg = String((e && e.message) || e);
    if (/Assert Failed|Error in template|constraint|line:\s*\d+/i.test(msg)) {
      pass++; console.log("  ✓", name, "— rejected (constraint caught it)");
    } else {
      fail++; console.log("  ✗", name, "— INCONCLUSIVE: rejected for a NON-constraint reason:", msg.slice(0, 140));
    }
  }
}

const asp = await buildAsp();
const bidder = pos([314159n]).toString();

console.log("test:negative — bidValidity soundness");
function bidInput(over) {
  const bid = over.bid ?? 4200n, nonce = over.nonce ?? 7n, rfqId = over.rfqId ?? 9n;
  const m = asp.witness(over.aspIdx ?? 2);
  const commit = over.commit ?? pos([bid, nonce, bidder]).toString();
  const nullifier = over.nullifier ?? pos([m.idSecret, rfqId]).toString();
  return {
    commit, bandMin: "3000", bandMax: "5000", availBal: over.availBal ?? "5000", bidder: over.bidder ?? bidder,
    aspRoot: over.aspRoot ?? asp.root.toString(), rfqId: String(rfqId), nullifier,
    bid: bid.toString(), nonce: String(nonce), idSecret: m.idSecret.toString(),
    pathElements: m.pathElements.map((x) => x.toString()), leafIndex: String(m.leafIndex),
  };
}
await mustReject("bid above band (6000 > 5000)", "bidValidity", bidInput({ bid: 6000n }));
await mustReject("bid below band (1000 < 3000)", "bidValidity", bidInput({ bid: 1000n }));
await mustReject("proof-of-funds violated (bid 4900 > availBal 4000)", "bidValidity", bidInput({ bid: 4900n, availBal: "4000" }));
await mustReject("wrong commitment (mismatched)", "bidValidity", bidInput({ commit: "12345" }));
await mustReject("forged nullifier", "bidValidity", bidInput({ nullifier: "999" }));
await mustReject("not in allow-list (fake root)", "bidValidity", bidInput({ aspRoot: "424242" }));

console.log("test:negative — auctionResult soundness");
function auctionInput(over) {
  const N = 8, bdrV = pos([1000n]);
  const amounts = over.bids ?? [4200n, 4900n, 3800n, 0n, 0n, 0n, 0n, 0n];
  const bid = [], nonce = [], bdr = [], commit = [];
  for (let i = 0; i < N; i++) { bid[i] = amounts[i]; nonce[i] = BigInt(100 + i); bdr[i] = i < 3 ? bdrV : 0n; commit[i] = pos([bid[i], nonce[i], bdr[i]]); }
  return {
    rfqId: "9", winnerAddr: bdr[over.winnerIdx ?? 1].toString(),
    clearingPrice: over.clearingPrice ?? "4200",
    commit: commit.map((x) => x.toString()), bidder: bdr.map((x) => x.toString()),
    bid: bid.map((x) => x.toString()), nonce: nonce.map((x) => x.toString()),
    winnerIdx: String(over.winnerIdx ?? 1), runnerIdx: String(over.runnerIdx ?? 0),
  };
}
await mustReject("wrong winner (claims idx 0, not the max)", "auctionResult", auctionInput({ winnerIdx: 0, runnerIdx: 1 }));
await mustReject("wrong clearing price (4900 first-price, not 4200)", "auctionResult", auctionInput({ clearingPrice: "4900" }));
await mustReject("clearing price too low (3800, not second-highest)", "auctionResult", auctionInput({ clearingPrice: "3800", runnerIdx: 2 }));
await mustReject("winner == runner (same index)", "auctionResult", auctionInput({ winnerIdx: 1, runnerIdx: 1 }));

console.log(`\n${fail ? "❌" : "✅"} test:negative — ${pass} rejected as expected, ${fail} UNSOUND`);
process.exit(fail ? 1 : 0);
