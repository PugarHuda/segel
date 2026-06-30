// On-chain soundness proof: generate a REAL auctionResult proof, verify it against
// the LIVE deployed verifier (-> true), then flip ONE public input (the clearing
// price) and re-verify (-> false). Demonstrates that the on-chain Groth16 verifier
// genuinely rejects a tampered statement — not asserted, checked on Stellar testnet.
// Read-only (simulate), free, repeatable. Backs the README "tampered -> InvalidProof".
import * as Sdk from "@stellar/stellar-sdk";
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";

const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const AUCTION_VERIFIER = "CCEZVOKXYPUH67KAVVQ6ZZAPUUXSE7ENBO3OLTTLHCVKDMJHOLGGJEBY";
const SOURCE = "GBJSZAEYQW5GQVJV77KGBPIN246HALRBWZINOQXE7DZ4NNHRVCSZMHAQ";
const W = "circuits/build";

const buf = (hex) => Uint8Array.from(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
const buf32 = (dec) => buf(BigInt(dec).toString(16).padStart(64, "0"));
const fe = (d) => BigInt(d).toString(16).padStart(64, "0");
const g1 = (p) => fe(p[0]) + fe(p[1]);
const g2 = (p) => fe(p[0][1]) + fe(p[0][0]) + fe(p[1][1]) + fe(p[1][0]);
const scProof = (p) => ({ a: buf(g1(p.pi_a)), b: buf(g2(p.pi_b)), c: buf(g1(p.pi_c)) });

let vClient;
async function getClient() {
  if (!vClient) vClient = await Sdk.contract.Client.from({ contractId: AUCTION_VERIFIER, networkPassphrase: PASSPHRASE, rpcUrl: RPC, publicKey: SOURCE });
  return vClient;
}
// Call the verifier's verify(proof, public_inputs) read-only and return the bool.
// The contract Client converts {a,b,c: bytes} -> Groth16Proof and bytes[] -> Vec<Bn254Fr>
// from the on-chain spec — exactly how e2e-testnet.mjs passes a proof to settle.
async function verifyOnChain(proof, publicSignals) {
  const c = await getClient();
  try {
    const at = await c.verify({ proof: scProof(proof), public_inputs: publicSignals.map((s) => BigInt(s)) }); // Vec<U256>
    const r = at.result;
    const accepted = r === true || r?.value === true;
    return { accepted, detail: accepted ? "verifier returned true" : (r?.error?.message || JSON.stringify(r)) };
  } catch (e) {
    // a tampered proof makes the on-chain pairing check fail — that IS the rejection
    return { accepted: false, detail: String(e?.message || e).slice(0, 90) };
  }
}

async function main() {
  const poseidon = await buildPoseidon(), F = poseidon.F;
  const pos = (arr) => F.toObject(poseidon(arr.map((x) => BigInt(x))));

  // Build a minimal valid auction (N=8): 3 real bids, rest padded zeros.
  const N = 8, rfqId = 42n, bidderField = 12345n;
  const amounts = [4200000n, 4900000n, 3800000n];
  const bid = [], nonce = [], bidder = [], commit = [];
  for (let i = 0; i < N; i++) {
    if (i < amounts.length) { bid[i] = amounts[i]; nonce[i] = 100n + BigInt(i); bidder[i] = bidderField; }
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
  console.log("generating a real auctionResult proof (winner = 4900000, Vickrey clearing = 4200000)…");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, `${W}/auctionResult_js/auctionResult.wasm`, `${W}/auctionResult_final.zkey`);

  // 1) honest proof vs the live verifier
  const honest = await verifyOnChain(proof, publicSignals);
  console.log(`\n[1] honest proof          -> accepted=${honest.accepted}  (${honest.detail})`);

  // 2) tamper the clearing-price public input (index 2) and re-verify the SAME proof
  const tampered = [...publicSignals];
  tampered[2] = (BigInt(tampered[2]) + 700000n).toString(); // claim first-price (4900000) instead of Vickrey
  const bad = await verifyOnChain(proof, tampered);
  console.log(`[2] tampered clearing ${publicSignals[2]}->${tampered[2]} -> accepted=${bad.accepted}  (${bad.detail})`);

  const pass = honest.accepted === true && bad.accepted === false;
  console.log(`\n${pass ? "✅" : "❌"} on-chain soundness: the deployed auctionResult verifier ${pass ? "ACCEPTS the true Vickrey statement and REJECTS the tampered clearing price — checked live on Stellar testnet, not asserted." : "did NOT behave as expected."}`);
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
