// Sample witness for auctionResult.circom (N=8).
// Builds a sealed auction with mixed real/empty bids, then derives the correct
// Vickrey outcome (winner = argmax, clearingPrice = second-highest) off-chain so
// the circuit just *verifies* it.
import { makePoseidon } from "./merkle.mjs";

const N = 8;
const { h1, h3 } = await makePoseidon();

const rfqId = 42n;

// Real bids in the first 5 slots, last 3 are empty (padded with 0).
const rawBids = [4200n, 3800n, 4900n, 0n, 4500n, 0n, 0n, 0n];
const bidder = [];
const nonce = [];
const bid = [];
const commit = [];
for (let i = 0; i < N; i++) {
  bidder[i] = h1(1000n + BigInt(i));
  nonce[i] = 700000n + BigInt(i);
  bid[i] = rawBids[i];
  commit[i] = h3(bid[i], nonce[i], bidder[i]);
}

// Winner = global max; runner-up = max of the rest (Vickrey clearing price).
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
  rfqId: rfqId.toString(),
  winnerAddr: winnerAddr.toString(),
  clearingPrice: clearingPrice.toString(),
  commit: commit.map((x) => x.toString()),
  bidder: bidder.map((x) => x.toString()),
  bid: bid.map((x) => x.toString()),
  nonce: nonce.map((x) => x.toString()),
  winnerIdx: winnerIdx.toString(),
  runnerIdx: runnerIdx.toString(),
};

console.log(JSON.stringify(input, null, 2));
