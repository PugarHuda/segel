// Seed a RICH set of live on-chain RFQs for the demo desk — various cases AND real
// sealed bids on them (so the list shows bid counts, directed labels, "for me", etc.).
// Throwaway makers (friendbot XLM) post the RFQs; the funded demo key places real
// bidValidity-proven sealed bids on the open auctions. Idempotent-ish: each run adds
// a fresh batch. Needs the demo key funded with Circle USDC (≥ ~20 for the escrows).
import * as Sdk from "@stellar/stellar-sdk";
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import sha3 from "js-sha3";
import { buildAsp } from "./asp.mjs";

const keccak256 = sha3.keccak256;
const FIELD_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const RPC = "https://soroban-testnet.stellar.org";
const PASS = "Test SDF Network ; September 2015";
const OTC = "CBAJVX6XPPGCMIQRWABO6ZOGQH7PJXTF4XB3MTAC35M4SBRLSIYXBBZM";
const DEMO_SECRET = "SALVZ6CF5CLAPV2FBPJ4SSW3QWCB6N2IPY4AEHQH4LKNWWNNVIGHN2KQ";
const XLM_SAC = Sdk.Asset.native().contractId(PASS);
const W = "circuits/build";

const demo = Sdk.Keypair.fromSecret(DEMO_SECRET);
const DEMO = demo.publicKey();
const server = new Sdk.rpc.Server(RPC);
const demoSigner = Sdk.contract.basicNodeSigner(demo, PASS);

const addrField = (a) => (BigInt("0x" + keccak256(Sdk.nativeToScVal(a, { type: "address" }).toXDR())) % FIELD_R).toString();
const buf = (hex) => Uint8Array.from(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
const buf32 = (dec) => buf(BigInt(dec).toString(16).padStart(64, "0"));
const fe = (d) => BigInt(d).toString(16).padStart(64, "0");
const g1 = (p) => fe(p[0]) + fe(p[1]);
const g2 = (p) => fe(p[0][1]) + fe(p[0][0]) + fe(p[1][1]) + fe(p[1][0]);
const scProof = (p) => ({ a: buf(g1(p.pi_a)), b: buf(g2(p.pi_b)), c: buf(g1(p.pi_c)) });

async function send(build, label) {
  for (let attempt = 1; ; attempt++) {
    try { const at = await build(); const res = await at.signAndSend(); return { res, at }; }
    catch (e) {
      const msg = String(e?.message || e);
      if (attempt <= 6 && /TRY_AGAIN_LATER|TIMEOUT|txTooLate|ERROR|timed? ?out|50\d|429/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 1500 * attempt)); continue;
      }
      throw e;
    }
  }
}
async function clientFor(kp) {
  const s = Sdk.contract.basicNodeSigner(kp, PASS);
  return Sdk.contract.Client.from({ contractId: OTC, networkPassphrase: PASS, rpcUrl: RPC, publicKey: kp.publicKey(), signTransaction: s.signTransaction, signAuthEntry: s.signAuthEntry });
}
async function maker(label) {
  const kp = Sdk.Keypair.random();
  const r = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  if (!r.ok) throw new Error("friendbot failed for " + label);
  return kp;
}

let asp, bidderField, pos;
async function postRfq(kp, { pair, side, mode, lot = 0, taker = null }) {
  const c = await clientFor(kp);
  const { at } = await send(() => c.post_rfq_dvp({
    maker: kp.publicKey(), pair, side, mode, band_min: 30000000n, band_max: 50000000n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
    base: lot > 0 ? { token: XLM_SAC, amount: BigInt(lot) * 10000000n, symbol: "XLM" } : null,
    taker,
  }), "post");
  return at.result;
}
const demoClientP = clientFor(demo);
async function bid(rfqId, aspIndex, amountUsdc) {
  const c = await demoClientP;
  const bidv = BigInt(Math.round(amountUsdc * 1e7));
  const nonce = (700000000n + BigInt(rfqId) * 1000n + BigInt(aspIndex)).toString();
  const m = asp.witness(aspIndex);
  const commit = pos([bidv, BigInt(nonce), BigInt(bidderField)]).toString();
  const nullifier = pos([m.idSecret, BigInt(rfqId)]).toString();
  const input = {
    commit, bandMin: "30000000", bandMax: "50000000", availBal: "50000000",
    bidder: bidderField, aspRoot: asp.root.toString(), rfqId: String(rfqId), nullifier,
    bid: bidv.toString(), nonce, idSecret: m.idSecret.toString(),
    pathElements: m.pathElements.map((x) => x.toString()), leafIndex: String(m.leafIndex),
  };
  const { proof } = await snarkjs.groth16.fullProve(input, `${W}/bidValidity_js/bidValidity.wasm`, `${W}/bidValidity_final.zkey`);
  await send(() => c.commit_bid({ from: DEMO, rfq_id: rfqId, commit: buf32(commit), nullifier: buf32(nullifier), proof: scProof(proof) }), "bid");
}

async function main() {
  const poseidon = await buildPoseidon(); const F = poseidon.F;
  pos = (arr) => F.toObject(poseidon(arr.map((x) => BigInt(x))));
  asp = await buildAsp();
  bidderField = addrField(DEMO);
  console.log("seeding rich scenarios as bidder", DEMO, "\n");

  // 1) OPEN DvP auction (XLM/USDC, 20 XLM lot) + 2 sealed bids from the demo
  const m1 = await maker("m1");
  const r1 = await postRfq(m1, { pair: "XLMUSDC", side: "SELL", mode: 1, lot: 20 });
  await bid(r1, 0, 4.20); await bid(r1, 1, 4.80);
  console.log(`✓ RFQ #${r1}: open DvP auction (20 XLM lot) with 2 sealed bids`);

  // 2) DvP RFQ DIRECTED to the demo key (shows "→ YOU" + sidebar badge; left open to bid)
  const m2 = await maker("m2");
  const r2 = await postRfq(m2, { pair: "XLMUSDC", side: "SELL", mode: 0, lot: 15, taker: DEMO });
  console.log(`✓ RFQ #${r2}: directed to YOU (the demo key) — open, biddable`);

  // 3) OPEN quote-only auction + 1 sealed bid
  const m3 = await maker("m3");
  const r3 = await postRfq(m3, { pair: "XLMUSDC", side: "BUY", mode: 1, lot: 0 });
  await bid(r3, 2, 3.90);
  console.log(`✓ RFQ #${r3}: open quote-only auction with 1 sealed bid`);

  // 4) DvP RFQ directed to a RANDOM third party (shows "reserved")
  const m4 = await maker("m4");
  const other = Sdk.Keypair.random().publicKey();
  const r4 = await postRfq(m4, { pair: "XLMUSDC", side: "SELL", mode: 0, lot: 10, taker: other });
  console.log(`✓ RFQ #${r4}: directed to someone else (${other.slice(0, 6)}…) — shows "reserved"`);

  console.log("\n✅ seeded:");
  console.log(`   #${r1} open auction +2 bids · #${r2} directed-to-you · #${r3} quote-only +1 bid · #${r4} reserved`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("SEED FAILED:", e.message || e); process.exit(1); });
