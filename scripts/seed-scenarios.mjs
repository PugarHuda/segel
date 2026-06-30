// Seed a RICH set of live on-chain RFQs for the demo desk — various cases AND real
// sealed bids/settlements on them (so the list shows bid counts, directed labels,
// "for me", a SETTLED auction with a clearing price in history, BUY+SELL sides, DvP
// + quote-only, varied pairs). Throwaway makers (friendbot XLM) post the RFQs; the
// funded demo key places real bidValidity-proven sealed bids and, for the settled
// case, a real auctionResult (Vickrey) proof. Each run adds a fresh batch.
// Needs the demo key funded with Circle USDC (≈ 20 for the escrows + one clearing).
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
const BAND_MIN = 30000000n, BAND_MAX = 50000000n; // 3.00–5.00 USDC; escrow per bid = band_max

const demo = Sdk.Keypair.fromSecret(DEMO_SECRET);
const DEMO = demo.publicKey();
const server = new Sdk.rpc.Server(RPC);

const addrField = (a) => (BigInt("0x" + keccak256(Sdk.nativeToScVal(a, { type: "address" }).toXDR())) % FIELD_R).toString();
const buf = (hex) => Uint8Array.from(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
const buf32 = (dec) => buf(BigInt(dec).toString(16).padStart(64, "0"));
const fe = (d) => BigInt(d).toString(16).padStart(64, "0");
const g1 = (p) => fe(p[0]) + fe(p[1]);
const g2 = (p) => fe(p[0][1]) + fe(p[0][0]) + fe(p[1][1]) + fe(p[1][0]);
const scProof = (p) => ({ a: buf(g1(p.pi_a)), b: buf(g2(p.pi_b)), c: buf(g1(p.pi_c)) });
const tx = (h) => (h ? `https://stellar.expert/explorer/testnet/tx/${h}` : "");

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
    maker: kp.publicKey(), pair, side, mode, band_min: BAND_MIN, band_max: BAND_MAX,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
    base: lot > 0 ? { token: XLM_SAC, amount: BigInt(lot) * 10000000n, symbol: "XLM" } : null,
    taker,
  }), "post");
  return at.result;
}
const demoClientP = clientFor(demo);
// Places a real sealed bid from the demo key (distinct ASP identity per aspIndex for
// the nullifier) and RETURNS its opening, so a later settle can prove over the set.
async function bid(rfqId, aspIndex, amountUsdc) {
  const c = await demoClientP;
  const bidv = BigInt(Math.round(amountUsdc * 1e7));
  const nonce = (700000000n + BigInt(rfqId) * 1000n + BigInt(aspIndex));
  const m = asp.witness(aspIndex);
  const commit = pos([bidv, nonce, BigInt(bidderField)]).toString();
  const nullifier = pos([m.idSecret, BigInt(rfqId)]).toString();
  const input = {
    commit, bandMin: BAND_MIN.toString(), bandMax: BAND_MAX.toString(), availBal: BAND_MAX.toString(),
    bidder: bidderField, aspRoot: asp.root.toString(), rfqId: String(rfqId), nullifier,
    bid: bidv.toString(), nonce: nonce.toString(), idSecret: m.idSecret.toString(),
    pathElements: m.pathElements.map((x) => x.toString()), leafIndex: String(m.leafIndex),
  };
  const { proof } = await snarkjs.groth16.fullProve(input, `${W}/bidValidity_js/bidValidity.wasm`, `${W}/bidValidity_final.zkey`);
  await send(() => c.commit_bid({ from: DEMO, rfq_id: rfqId, commit: buf32(commit), nullifier: buf32(nullifier), proof: scProof(proof) }), "bid");
  return { bid: bidv, nonce, bidder: BigInt(bidderField) };
}
// Settle an auction with a real Vickrey auctionResult proof over the recorded set
// (padded to N=8 with Poseidon(0,0,0)). winner = argmax bid, clearing = 2nd-highest.
async function settle(rfqId, openings) {
  const c = await demoClientP;
  const N = 8, b = [], nn = [], bd = [], cm = [];
  for (let i = 0; i < N; i++) {
    if (i < openings.length) { b[i] = openings[i].bid; nn[i] = openings[i].nonce; bd[i] = openings[i].bidder; }
    else { b[i] = 0n; nn[i] = 0n; bd[i] = 0n; }
    cm[i] = pos([b[i], nn[i], bd[i]]);
  }
  let wi = 0; for (let i = 1; i < N; i++) if (b[i] > b[wi]) wi = i;
  let ri = -1; for (let i = 0; i < N; i++) { if (i === wi) continue; if (ri === -1 || b[i] > b[ri]) ri = i; }
  const input = {
    rfqId: String(rfqId), winnerAddr: bd[wi].toString(), clearingPrice: b[ri].toString(),
    commit: cm.map((x) => x.toString()), bidder: bd.map((x) => x.toString()),
    bid: b.map((x) => x.toString()), nonce: nn.map((x) => x.toString()),
    winnerIdx: String(wi), runnerIdx: String(ri),
  };
  const { proof } = await snarkjs.groth16.fullProve(input, `${W}/auctionResult_js/auctionResult.wasm`, `${W}/auctionResult_final.zkey`);
  await send(() => c.settle({ rfq_id: rfqId, proof: scProof(proof), winner: DEMO, clearing: b[ri] }), "settle");
  return { clearing: b[ri] };
}

async function main() {
  const poseidon = await buildPoseidon(); const F = poseidon.F;
  pos = (arr) => F.toObject(poseidon(arr.map((x) => BigInt(x))));
  asp = await buildAsp();
  bidderField = addrField(DEMO);
  console.log("seeding rich scenarios as bidder", DEMO, "\n");
  const done = [], skipped = [];
  // each scenario is independent: if the demo runs out of USDC mid-batch, log + keep
  // going rather than aborting (so partial funding still seeds what it can).
  const step = async (fn) => {
    try { const msg = await fn(); done.push(msg); console.log("✓ " + msg); }
    catch (e) { const m = String(e?.message || e); const code = (m.match(/Error\(Contract, #(\d+)\)/) || [])[1]; skipped.push(code ? "#" + code : m.slice(0, 40)); console.log("⚠ skipped:", code === "10" ? "demo out of USDC for the escrow" : (code ? "err #" + code : m.slice(0, 50))); }
  };

  // SETTLED auctions (demo is maker+settler so the clearing payout lands — demo holds a
  // Circle-USDC trustline; a friendbot throwaway maker would have none and settle would
  // revert). Real auctionResult (Vickrey) proofs; losing bid amounts stay hidden.
  await step(async () => { const id = await postRfq(demo, { pair: "XLMUSDC", side: "SELL", mode: 1, lot: 0 }); const c = (await settle(id, [await bid(id, 0, 4.20), await bid(id, 1, 4.90), await bid(id, 2, 3.80)])).clearing; return `#${id} SETTLED XLMUSDC auction — 3 sealed bids, Vickrey clearing ${Number(c) / 1e7} USDC (losers hidden)`; });
  await step(async () => { const id = await postRfq(demo, { pair: "ETHUSDC", side: "SELL", mode: 1, lot: 0 }); const c = (await settle(id, [await bid(id, 6, 4.60), await bid(id, 7, 4.00)])).clearing; return `#${id} SETTLED ETHUSDC auction — 2 bids, clearing ${Number(c) / 1e7} USDC`; });
  await step(async () => { const id = await postRfq(demo, { pair: "BTCUSDC", side: "BUY", mode: 1, lot: 20 }); const c = (await settle(id, [await bid(id, 8, 4.30), await bid(id, 9, 3.50), await bid(id, 10, 4.95)])).clearing; return `#${id} SETTLED BTCUSDC (DvP 20 XLM) — 3 bids, clearing ${Number(c) / 1e7} USDC`; });

  // OPEN, varied (throwaway makers post; the demo bids)
  await step(async () => { const id = await postRfq(await maker("m1"), { pair: "XLMUSDC", side: "SELL", mode: 1, lot: 20 }); await bid(id, 3, 4.10); await bid(id, 4, 4.70); return `#${id} open XLMUSDC DvP auction (20 XLM lot) + 2 sealed bids`; });
  await step(async () => { const id = await postRfq(await maker("m2"), { pair: "ETHUSDC", side: "SELL", mode: 0, lot: 15, taker: DEMO }); return `#${id} ETHUSDC directed to YOU (the demo key) — open, biddable`; });
  await step(async () => { const id = await postRfq(await maker("m3"), { pair: "BTCUSDC", side: "BUY", mode: 1, lot: 0 }); await bid(id, 5, 3.95); return `#${id} open BUY-side quote-only auction (BTCUSDC) + 1 sealed bid`; });
  await step(async () => { const other = Sdk.Keypair.random().publicKey(); const id = await postRfq(await maker("m4"), { pair: "XLMUSDC", side: "SELL", mode: 0, lot: 10, taker: other }); return `#${id} XLMUSDC directed to someone else (${other.slice(0, 6)}…) — "reserved"`; });

  console.log(`\n✅ seeded ${done.length} live on-chain cases${skipped.length ? ` (${skipped.length} skipped: ${skipped.join(", ")} — top up the demo's USDC and re-run)` : ""}.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("SEED FAILED:", e.message || e); process.exit(1); });
