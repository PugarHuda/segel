// Selective disclosure — Segel's analog of the Confidential-Token compliance
// primitive, using the commitment scheme it already has. A sealed bid is
// commit = Poseidon(bid, nonce, bidder), recorded on-chain. The bidder can later
// PROVE to a specific party (auditor, counterparty, regulator) the exact value they
// bid — by revealing the opening — WITHOUT it ever being public, and without being
// able to lie (any other claimed value yields a different commitment).
//
// This is powerful precisely because the WINNER's true bid is hidden on-chain: in a
// Vickrey auction the winner pays the SECOND price, so their own (highest) bid never
// appears. Here we disclose it against the real on-chain commitments of RFQ #13
// (the live DvP settlement: 3 bids 4.90 / 4.20 / 3.80 USDC, clearing 4.20).
//
// Demo openings are the deterministic ones e2e-testnet.mjs used; in production the
// nonce is the bidder's secret, so only they can open their commitment.
import * as Sdk from "@stellar/stellar-sdk";
import { buildPoseidon } from "circomlibjs";
import sha3 from "js-sha3";

const keccak256 = sha3.keccak256;
const FIELD_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const OTC = "CBAJVX6XPPGCMIQRWABO6ZOGQH7PJXTF4XB3MTAC35M4SBRLSIYXBBZM";
const ADDR = "GBJSZAEYQW5GQVJV77KGBPIN246HALRBWZINOQXE7DZ4NNHRVCSZMHAQ"; // the e2e bidder
const RFQ_ID = Number(process.argv[2] ?? 13);

const server = new Sdk.rpc.Server(RPC);
const addrField = (a) => (BigInt("0x" + keccak256(Sdk.nativeToScVal(a, { type: "address" }).toXDR())) % FIELD_R).toString();
const u32 = (n) => Sdk.nativeToScVal(n, { type: "u32" });
const bytesToBig = (u8) => BigInt("0x" + Buffer.from(u8).toString("hex"));

async function onChainCommits(rfqId) {
  const acct = await server.getAccount(ADDR);
  const c = new Sdk.Contract(OTC);
  const tx = new Sdk.TransactionBuilder(acct, { fee: "100", networkPassphrase: PASSPHRASE })
    .addOperation(c.call("bids", u32(rfqId))).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (Sdk.rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return Sdk.scValToNative(sim.result.retval).map((b) => bytesToBig(b)); // array of commitments (as bigints)
}

async function main() {
  const poseidon = await buildPoseidon(), F = poseidon.F;
  const pos = (arr) => F.toObject(poseidon(arr.map((x) => BigInt(x))));
  const bidderField = BigInt(addrField(ADDR));

  // the deterministic e2e openings for the 3 sealed bids on this RFQ
  const amounts = [42000000n, 49000000n, 38000000n];
  const openings = amounts.map((bid, i) => ({ bid, nonce: 123456789n + BigInt(i) * 99n, bidderField }));

  console.log(`Selective disclosure against on-chain commitments of RFQ #${RFQ_ID}\n  bidder ${ADDR}\n`);
  const commits = await onChainCommits(RFQ_ID);
  console.log(`  ${commits.length} sealed commitments read from the contract (amounts hidden on-chain)\n`);

  let allOk = true;
  for (const o of openings) {
    const recomputed = pos([o.bid, o.nonce, o.bidderField]);
    const match = commits.some((c) => c === recomputed);
    allOk &&= match;
    console.log(`  disclose bid = ${(Number(o.bid) / 1e7).toFixed(2)} USDC  ->  Poseidon(bid,nonce,addr) ${match ? "MATCHES an on-chain commitment ✓" : "no match ✗"}`);
  }

  // binding / non-repudiation: you cannot disclose a value you didn't commit to
  const lie = pos([openings[1].bid + 10000000n, openings[1].nonce, bidderField]); // claim +1.00 USDC
  const forged = commits.some((c) => c === lie);
  console.log(`\n  forgery test: claim a DIFFERENT bid (5.90 USDC) with the same nonce -> ${forged ? "MATCHED (BAD)" : "no on-chain commitment matches ✗ — the disclosure is binding, you can't lie"}`);

  const winner = openings.reduce((a, b) => (b.bid > a.bid ? b : a));
  console.log(`\nReal-world point: the WINNER bid ${(Number(winner.bid) / 1e7).toFixed(2)} USDC but paid the Vickrey clearing 4.20 USDC — the 4.90 is NOT on-chain, yet the winner can prove it to a chosen counterparty/auditor here, privately and bindingly. This is selective disclosure on Segel's own commitments (no Confidential-Token wrapper needed).`);

  const pass = allOk && !forged;
  console.log(`\n${pass ? "✅" : "❌"} selective disclosure ${pass ? "verified against live on-chain commitments, and forgery-resistant" : "did not behave as expected"}.`);
  await new Promise((r) => setTimeout(r, 300)); // let circomlibjs's WASM worker finish closing before exit
  return pass;
}
// exit from OUTSIDE main (circomlibjs leaves a WASM worker on the loop; exiting
// inside the async context trips a libuv teardown assert — mirror e2e-testnet.mjs).
main().then((pass) => process.exit(pass ? 0 : 1)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
