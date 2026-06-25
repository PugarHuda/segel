// Sample witness for bidValidity.circom (levels=10).
// Produces a fully valid sealed bid: in-band, funded, allowlisted, fresh nullifier.
import { makePoseidon, buildTree } from "./merkle.mjs";

const LEVELS = 10;
const { h1, h2, h3 } = await makePoseidon();

// --- public-ish context (the contract pins bidder/availBal/rfqId/aspRoot) ---
const bidder = h1(314159n); // field(from) stand-in
const rfqId = 42n;
const bandMin = 3000n;
const bandMax = 5000n;
const availBal = 1_000_000n; // bidder's on-chain USDC balance (stroops)

// --- the secret bid ---
const bid = 4200n; // in band, <= availBal
const nonce = 987654321n;
const commit = h3(bid, nonce, bidder);

// --- hidden identity in the allow-list ---
const idSecret = 555_000_111n;
const idLeaf = h1(idSecret);
const members = [h1(11n), h1(22n), h1(33n), idLeaf, h1(44n)];
const leaves = [];
members.forEach((m, i) => (leaves[i] = m));
const IDX = 3;
const tree = buildTree(h2, leaves, LEVELS);
const { pathElements, leafIndex } = tree.proof(IDX);

const nullifier = h2(idSecret, rfqId);

const input = {
  commit: commit.toString(),
  bandMin: bandMin.toString(),
  bandMax: bandMax.toString(),
  availBal: availBal.toString(),
  bidder: bidder.toString(),
  aspRoot: tree.root.toString(),
  rfqId: rfqId.toString(),
  nullifier: nullifier.toString(),
  bid: bid.toString(),
  nonce: nonce.toString(),
  idSecret: idSecret.toString(),
  pathElements: pathElements.map((x) => x.toString()),
  leafIndex: leafIndex.toString(),
};

console.log(JSON.stringify(input, null, 2));
