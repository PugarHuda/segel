// QA: re-prove BOTH circuits off-chain with fresh witnesses and assert the
// Groth16 proof verifies against the committed verification key. Exercises the
// exact in-browser proving path (Poseidon commit + snarkjs) without any network.
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import { readFileSync } from "node:fs";
import { buildAsp } from "./asp.mjs";

const W = "circuits/build";
const poseidon = await buildPoseidon();
const F = poseidon.F;
const pos = (a) => F.toObject(poseidon(a.map((x) => BigInt(x))));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

async function proveVerify(name, input) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input, `${W}/${name}_js/${name}.wasm`, `${W}/${name}_final.zkey`);
  const vk = JSON.parse(readFileSync(`${W}/${name}_vk.json`, "utf8"));
  const v = await snarkjs.groth16.verify(vk, publicSignals, proof);
  return { v, publicSignals };
}

console.log("test:proving — bidValidity");
{
  const asp = await buildAsp();
  const bidder = pos([314159n]).toString();
  const bid = 4200n, nonce = 7n, rfqId = 9n;
  const m = asp.witness(2);
  const commit = pos([bid, nonce, bidder]).toString();
  const nullifier = pos([m.idSecret, rfqId]).toString();
  const input = {
    commit, bandMin: "3000", bandMax: "5000", availBal: "5000", bidder,
    aspRoot: asp.root.toString(), rfqId: String(rfqId), nullifier,
    bid: bid.toString(), nonce: String(nonce), idSecret: m.idSecret.toString(),
    pathElements: m.pathElements.map((x) => x.toString()), leafIndex: String(m.leafIndex),
  };
  const { v, publicSignals } = await proveVerify("bidValidity", input);
  ok(v, "valid bidValidity proof verifies");
  ok(publicSignals[0] === commit, "public commit matches");
  ok(publicSignals.length === 8, "8 public signals");
}

console.log("test:proving — auctionResult");
{
  const N = 8, bidder = pos([1000n]);
  const amounts = [4200n, 4900n, 3800n, 0n, 0n, 0n, 0n, 0n];
  const bid = [], nonce = [], bdr = [], commit = [];
  for (let i = 0; i < N; i++) { bid[i] = amounts[i]; nonce[i] = BigInt(100 + i); bdr[i] = i < 3 ? bidder : 0n; commit[i] = pos([bid[i], nonce[i], bdr[i]]); }
  const input = {
    rfqId: "9", winnerAddr: bdr[1].toString(), clearingPrice: "4200",
    commit: commit.map((x) => x.toString()), bidder: bdr.map((x) => x.toString()),
    bid: bid.map((x) => x.toString()), nonce: nonce.map((x) => x.toString()),
    winnerIdx: "1", runnerIdx: "0",
  };
  const { v, publicSignals } = await proveVerify("auctionResult", input);
  ok(v, "valid auctionResult proof verifies");
  ok(publicSignals[2] === "4200", "clearing price = second-highest (4200)");
  ok(publicSignals.length === 19, "19 public signals");
}

console.log(`\n${fail ? "❌" : "✅"} test:proving — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
