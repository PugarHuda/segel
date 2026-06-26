// Segel — full end-to-end on testnet, mirroring the browser flow in Node:
//   post_rfq -> 3 sealed bids (real bidValidity proofs) -> settle (real
//   auctionResult proof, Vickrey). Proves the circuits + contract integrate
//   live. Uses the public throwaway demo key (funded with testnet USDC).
import * as Sdk from "@stellar/stellar-sdk";
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import sha3 from "js-sha3";
import { buildAsp } from "./asp.mjs";

const keccak256 = sha3.keccak256;
const FIELD_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const OTC = "CBAJVX6XPPGCMIQRWABO6ZOGQH7PJXTF4XB3MTAC35M4SBRLSIYXBBZM";
const USDC_SAC = "CAT6F6HX4B2DBPSS4SIZ257IYSMKDKRJSEGIQTKBDS7LOFRMDXVGFVA2";
const DEMO_SECRET = "SALVZ6CF5CLAPV2FBPJ4SSW3QWCB6N2IPY4AEHQH4LKNWWNNVIGHN2KQ";

const kp = Sdk.Keypair.fromSecret(DEMO_SECRET);
const ADDR = kp.publicKey();
const server = new Sdk.rpc.Server(RPC);
const signer = Sdk.contract.basicNodeSigner(kp, PASSPHRASE);

const addrField = (a) => (BigInt("0x" + keccak256(Sdk.nativeToScVal(a, { type: "address" }).toXDR())) % FIELD_R).toString();
const buf = (hex) => Uint8Array.from(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
const buf32 = (dec) => buf(BigInt(dec).toString(16).padStart(64, "0"));
const fe = (d) => BigInt(d).toString(16).padStart(64, "0");
const g1 = (p) => fe(p[0]) + fe(p[1]);
const g2 = (p) => fe(p[0][1]) + fe(p[0][0]) + fe(p[1][1]) + fe(p[1][0]);
const scProof = (p) => ({ a: buf(g1(p.pi_a)), b: buf(g2(p.pi_b)), c: buf(g1(p.pi_c)) });
const tx = (h) => `https://stellar.expert/explorer/testnet/tx/${h}`;

// testnet RPC occasionally bounces a submit (TRY_AGAIN_LATER on congestion).
// `build` is a thunk that RE-ASSEMBLES the tx (fresh simulation + time bounds) on
// every attempt — resubmitting the same signed tx would expire its 30s window and
// fail txTooLate, so we rebuild instead. A rejected submit never consumes the seq.
async function send(build, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      const at = await build();
      const res = await at.signAndSend();
      return { res, at };
    } catch (e) {
      const msg = String(e?.message || e) + " " + JSON.stringify(e?.status ?? "");
      if (attempt <= 6 && /TRY_AGAIN_LATER|TIMEOUT|txTooLate|ERROR|timed? ?out|50\d|429/i.test(msg)) {
        const wait = 1500 * attempt;
        console.log(`   …${label} transient send error (${attempt}/6), rebuilding + retrying in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
}

const W = "circuits/build";
let poseidon, F;
const pos = (arr) => F.toObject(poseidon(arr.map((x) => BigInt(x))));

async function client() {
  return Sdk.contract.Client.from({
    contractId: OTC, networkPassphrase: PASSPHRASE, rpcUrl: RPC,
    publicKey: ADDR, signTransaction: signer.signTransaction, signAuthEntry: signer.signAuthEntry,
  });
}
async function simulate(method, ...args) {
  const acct = await server.getAccount(ADDR);
  const c = new Sdk.Contract(USDC_SAC);
  const t = new Sdk.TransactionBuilder(acct, { fee: "100", networkPassphrase: PASSPHRASE })
    .addOperation(c.call(method, ...args)).setTimeout(30).build();
  const sim = await server.simulateTransaction(t);
  return Sdk.scValToNative(sim.result.retval);
}

async function main() {
  poseidon = await buildPoseidon(); F = poseidon.F;
  const asp = await buildAsp();
  const bidderField = addrField(ADDR);
  console.log("demo address:", ADDR);

  // balance (display only); proof-of-funds availBal is pinned to band_max below
  const bal = await simulate("balance", Sdk.nativeToScVal(ADDR, { type: "address" }));
  console.log("USDC balance (stroops):", bal.toString());

  const c = await client();

  // 1. post RFQ
  const bandMin = 3000n, bandMax = 5000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const { res: postRes, at: postAt } = await send(() => c.post_rfq({
    maker: ADDR, pair: "XLMUSDC", side: "SELL", mode: 1,
    band_min: bandMin, band_max: bandMax, deadline,
  }), "post_rfq");
  const rfqId = postAt.result;
  console.log(`\n[1] post_rfq -> RFQ #${rfqId}  ${tx(postRes.sendTransactionResponse?.hash)}`);

  // 2. three sealed bids (distinct ASP identities)
  const amounts = [4200n, 4900n, 3800n];
  const openings = [];
  for (let i = 0; i < amounts.length; i++) {
    const bid = amounts[i], nonce = (123456789n + BigInt(i) * 99n).toString();
    const m = asp.witness(i);
    const commit = pos([bid, nonce, bidderField]).toString();
    const nullifier = pos([m.idSecret, BigInt(rfqId)]).toString();
    const input = {
      commit, bandMin: bandMin.toString(), bandMax: bandMax.toString(), availBal: bandMax.toString(),
      bidder: bidderField, aspRoot: asp.root.toString(), rfqId: String(rfqId), nullifier,
      bid: bid.toString(), nonce, idSecret: m.idSecret.toString(),
      pathElements: m.pathElements.map((x) => x.toString()), leafIndex: String(m.leafIndex),
    };
    const { proof } = await snarkjs.groth16.fullProve(input, `${W}/bidValidity_js/bidValidity.wasm`, `${W}/bidValidity_final.zkey`);
    const { res: r } = await send(() => c.commit_bid({ from: ADDR, rfq_id: Number(rfqId), commit: buf32(commit), nullifier: buf32(nullifier), proof: scProof(proof) }), `commit_bid ${i + 1}`);
    openings.push({ bid: bid.toString(), nonce, bidderField, commit });
    console.log(`[2.${i + 1}] commit_bid (amount hidden) -> ${tx(r.sendTransactionResponse?.hash)}`);
  }

  // 3. settle (Vickrey): winner = 4900, clearing = 4200 (second-highest)
  const N = 8;
  const bid = [], nonce = [], bidder = [], commit = [];
  for (let i = 0; i < N; i++) {
    if (i < openings.length) { bid[i] = BigInt(openings[i].bid); nonce[i] = BigInt(openings[i].nonce); bidder[i] = BigInt(bidderField); }
    else { bid[i] = 0n; nonce[i] = 0n; bidder[i] = 0n; }
    commit[i] = pos([bid[i], nonce[i], bidder[i]]);
  }
  let wi = 0; for (let i = 1; i < N; i++) if (bid[i] > bid[wi]) wi = i;
  let ri = -1; for (let i = 0; i < N; i++) { if (i === wi) continue; if (ri === -1 || bid[i] > bid[ri]) ri = i; }
  const input = {
    rfqId: String(rfqId), winnerAddr: bidder[wi].toString(), clearingPrice: bid[ri].toString(),
    commit: commit.map((x) => x.toString()), bidder: bidder.map((x) => x.toString()),
    bid: bid.map((x) => x.toString()), nonce: nonce.map((x) => x.toString()),
    winnerIdx: String(wi), runnerIdx: String(ri),
  };
  const { proof } = await snarkjs.groth16.fullProve(input, `${W}/auctionResult_js/auctionResult.wasm`, `${W}/auctionResult_final.zkey`);
  const { res: r } = await send(() => c.settle({ rfq_id: Number(rfqId), proof: scProof(proof), winner: ADDR, clearing: bid[ri] }), "settle");
  console.log(`\n[3] settle (Vickrey) winner=#${wi} clearing=${bid[ri]} (losers hidden) -> ${tx(r.sendTransactionResponse?.hash)}`);
  console.log("\n✅ Full sealed-bid OTC flow verified live on Stellar testnet.");
}

// snarkjs leaves WASM workers on the event loop; exit explicitly so the test
// terminates cleanly instead of hanging after the flow succeeds.
main().then(() => process.exit(0)).catch((e) => { console.error("E2E FAILED:", e); process.exit(1); });
