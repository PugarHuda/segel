// Segel — live Stellar testnet from the browser.
//   * reads (rfqs, bids, balances, verify) are read-only RPC simulations;
//   * post_rfq / commit_bid / settle are real signed writes, signed either by a
//     connected Freighter wallet or an embedded throwaway testnet demo key (so
//     the demo works with no install). Never reuse the demo key for real funds.
const mod = await import("https://esm.sh/@stellar/stellar-sdk@14");
const Sdk = mod.default ?? mod;
import sha3 from "https://esm.sh/js-sha3@0.9.3";
const keccak256 = sha3.keccak256 ?? sha3.default?.keccak256;

const FIELD_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";

// Live testnet deployment (deployments/testnet.json).
export const OTC = "CDN3B3AC6AGNQPLQ2TR654P4YOQBAUJDLQELZXEU42EXZZ6WCHMSD7Y3";
export const BID_VERIFIER = "CAL5XO2NPC2ZFVQSXX7HSS6ARQOX6GL24LCR5SZVEIKENOLN2HUOK7DK";
export const AUCTION_VERIFIER = "CCEZVOKXYPUH67KAVVQ6ZZAPUUXSE7ENBO3OLTTLHCVKDMJHOLGGJEBY";
export const USDC_SAC = "CAT6F6HX4B2DBPSS4SIZ257IYSMKDKRJSEGIQTKBDS7LOFRMDXVGFVA2";
// Testnet USDC-denominated Stellar Asset Contract. NOTE: the issuer below is a
// PROJECT-CONTROLLED mock — not Circle's canonical testnet USDC
// (GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5). The escrow/custody
// mechanics are real; the asset is a stand-in for demo purposes.
const USDC = new Sdk.Asset("USDC", "GC7SWGHRQLMP4SW2AOBRSC2HFKVPNPHBH5A3PX3ZDVEJFMYKLWQ3SY3B");

// Throwaway testnet demo key (non-admin) — only signs demo txs. Public on purpose.
const DEMO_SECRET = "SALVZ6CF5CLAPV2FBPJ4SSW3QWCB6N2IPY4AEHQH4LKNWWNNVIGHN2KQ";
export const DEMO_ADDRESS = Sdk.Keypair.fromSecret(DEMO_SECRET).publicKey();
const SOURCE = DEMO_ADDRESS; // used only to build read-only simulation txs

const server = new Sdk.rpc.Server(RPC);

async function simulate(contractId, method, ...args) {
  const source = await server.getAccount(SOURCE);
  const c = new Sdk.Contract(contractId);
  const tx = new Sdk.TransactionBuilder(source, { fee: "100", networkPassphrase: PASSPHRASE })
    .addOperation(c.call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (Sdk.rpc.Api.isSimulationError(sim)) return { ok: false, error: sim.error };
  return { ok: true, value: Sdk.scValToNative(sim.result.retval) };
}

const bytesToBig = (u8) => { let x = 0n; for (const b of u8) x = (x << 8n) | BigInt(b); return x; };
const u32 = (x) => Sdk.nativeToScVal(x, { type: "u32" });
const addrScVal = (a) => Sdk.nativeToScVal(a, { type: "address" });

// ---------------- reads ----------------
export async function deskState() {
  const [count, bal] = await Promise.all([simulate(OTC, "rfq_count"), simulate(OTC, "balance")]);
  return {
    rfqCount: count.ok ? Number(count.value) : 0,
    escrow: bal.ok ? bal.value.toString() : "?",
  };
}

export async function getRfq(id) {
  const r = await simulate(OTC, "get_rfq_view", u32(id));
  if (!r.ok) return null;
  const v = r.value;
  return {
    id,
    maker: v.maker,
    pair: v.pair,
    side: v.side,
    mode: Number(v.mode),
    bandMin: v.band_min.toString(),
    bandMax: v.band_max.toString(),
    deadline: Number(v.deadline),
    status: Number(v.status),
  };
}

export async function listRfqs() {
  const { rfqCount } = await deskState();
  const out = [];
  for (let i = 0; i < rfqCount; i++) {
    const r = await getRfq(i);
    if (r) {
      const bc = await simulate(OTC, "bid_count", u32(i));
      r.bids = bc.ok ? Number(bc.value) : 0;
      const st = await simulate(OTC, "settlement", u32(i));
      r.settlement = st.ok && st.value ? { clearing: st.value.clearing.toString() } : null;
      out.push(r);
    }
  }
  return out;
}

export async function bidsOf(rfqId) {
  const r = await simulate(OTC, "bids", u32(rfqId));
  if (!r.ok || !Array.isArray(r.value)) return [];
  return r.value.map((b) => bytesToBig(b).toString());
}

export async function balanceOf(address) {
  const r = await simulate(USDC_SAC, "balance", addrScVal(address));
  return r.ok ? r.value.toString() : "0";
}

// field(addr) = keccak256(addr ScVal XDR) mod r — matches the contract's addr_field.
export function addrField(address) {
  const xdr = addrScVal(address).toXDR();
  return (BigInt("0x" + keccak256(xdr)) % FIELD_R).toString();
}

// ---------------- wallet ----------------
let _wallet = null;
let _write = null;
export function setWalletSigner(w) { _wallet = w; _write = null; }
export function activeAddress() { return _wallet ? _wallet.address : DEMO_ADDRESS; }
export function usingWallet() { return !!_wallet; }

async function writeClient() {
  if (_write) return _write;
  if (_wallet) {
    _write = await Sdk.contract.Client.from({
      contractId: OTC, networkPassphrase: PASSPHRASE, rpcUrl: RPC,
      publicKey: _wallet.address, signTransaction: _wallet.signTransaction, signAuthEntry: _wallet.signAuthEntry,
    });
    _write._from = _wallet.address;
  } else {
    const kp = Sdk.Keypair.fromSecret(DEMO_SECRET);
    const signer = Sdk.contract.basicNodeSigner(kp, PASSPHRASE);
    _write = await Sdk.contract.Client.from({
      contractId: OTC, networkPassphrase: PASSPHRASE, rpcUrl: RPC,
      publicKey: kp.publicKey(), signTransaction: signer.signTransaction, signAuthEntry: signer.signAuthEntry,
    });
    _write._from = kp.publicKey();
  }
  return _write;
}

// ---------------- writes ----------------
const OTC_ERRORS = {
  1: "unknown RFQ", 2: "RFQ is closed", 3: "RFQ deadline passed", 4: "RFQ not yet expired",
  5: "you already bid on this RFQ (nullifier used)", 6: "this RFQ is full (max 8 bids)",
  7: "invalid amount", 8: "the zero-knowledge proof was rejected on-chain",
  9: "only the maker can settle", 10: "clearing price out of band", 11: "no bids to settle",
  12: "already settled",
};
function friendly(e) {
  const msg = (e && e.message) || String(e);
  const m = msg.match(/Error\(Contract,\s*#(\d+)\)/);
  if (m && OTC_ERRORS[Number(m[1])]) return OTC_ERRORS[Number(m[1])];
  return msg;
}
const hashOf = (res) => res?.sendTransactionResponse?.hash || res?.getTransactionResponse?.txHash || "";

export async function postRfq({ pair, side, mode, bandMin, bandMax, deadline }) {
  try {
    const c = await writeClient();
    const at = await c.post_rfq({
      maker: c._from,
      pair: pair.slice(0, 9),
      side: side.slice(0, 9),
      mode: Number(mode),
      band_min: BigInt(bandMin),
      band_max: BigInt(bandMax),
      deadline: BigInt(deadline),
    });
    const res = await at.signAndSend();
    return { ok: true, hash: hashOf(res), id: at.result };
  } catch (e) { return { ok: false, error: friendly(e) }; }
}

export async function commitBid({ rfqId, commit, nullifier, proof }) {
  try {
    const c = await writeClient();
    const { buf32 } = await import("./prover.js");
    const at = await c.commit_bid({
      from: c._from,
      rfq_id: Number(rfqId),
      commit: buf32(commit),
      nullifier: buf32(nullifier),
      proof,
    });
    const res = await at.signAndSend();
    return { ok: true, hash: hashOf(res) };
  } catch (e) { return { ok: false, error: friendly(e) }; }
}

export async function settle({ rfqId, proof, winner, clearing }) {
  try {
    const c = await writeClient();
    const at = await c.settle({
      rfq_id: Number(rfqId),
      proof,
      winner,
      clearing: BigInt(clearing),
    });
    const res = await at.signAndSend();
    return { ok: true, hash: hashOf(res) };
  } catch (e) { return { ok: false, error: friendly(e) }; }
}

// ---------------- testnet helpers ----------------
async function submitClassic(tx) {
  const sent = await server.sendTransaction(tx);
  let status = sent.status, hash = sent.hash;
  for (let i = 0; i < 15 && (status === "PENDING" || status === "NOT_FOUND" || status === "TRY_AGAIN_LATER"); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { const g = await server.getTransaction(hash); status = g.status; } catch (_) {}
  }
  if (status !== "SUCCESS") throw new Error("tx " + status);
  return hash;
}

export async function friendbotFund(address) {
  try { await server.getAccount(address); return { ok: true, already: true }; }
  catch (_) { const r = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`); return { ok: r.ok }; }
}

export async function addUsdcTrustline(address, signTransaction) {
  const acct = await server.getAccount(address);
  const tx = new Sdk.TransactionBuilder(acct, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Sdk.Operation.changeTrust({ asset: USDC })).setTimeout(120).build();
  const { signedTxXdr } = await signTransaction(tx.toXDR(), { networkPassphrase: PASSPHRASE, address });
  return submitClassic(Sdk.TransactionBuilder.fromXDR(signedTxXdr, PASSPHRASE));
}

/** Faucet: the demo key sends USDC to `address` (needs a trustline first). */
export async function faucetUsdc(address, amount = "50000") {
  const kp = Sdk.Keypair.fromSecret(DEMO_SECRET);
  const acct = await server.getAccount(kp.publicKey());
  const tx = new Sdk.TransactionBuilder(acct, { fee: Sdk.BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(Sdk.Operation.payment({ destination: address, asset: USDC, amount })).setTimeout(120).build();
  tx.sign(kp);
  return submitClassic(tx);
}

export async function cancelExpired(rfqId) {
  try {
    const c = await writeClient();
    const at = await c.cancel_expired({ rfq_id: Number(rfqId) });
    const res = await at.signAndSend();
    return { ok: true, hash: hashOf(res) };
  } catch (e) { return { ok: false, error: friendly(e) }; }
}

// Live on-chain Poseidon(a,b) via the contract's poseidon_hash (proves the
// commitment scheme runs on-chain). a,b are small integers; returns 0x hex.
export async function poseidonHash(a, b) {
  const b32 = (n) => { const x = BigInt(n).toString(16).padStart(64, "0"); return Uint8Array.from(x.match(/.{2}/g).map((h) => parseInt(h, 16))); };
  const r = await simulate(OTC, "poseidon_hash", Sdk.nativeToScVal(b32(a), { type: "bytes" }), Sdk.nativeToScVal(b32(b), { type: "bytes" }));
  if (!r.ok) throw new Error("poseidon_hash failed");
  const u8 = r.value;
  return "0x" + Array.from(u8).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Live integration health — EVERY row is a real on-chain probe (RPC call, contract
// simulation, or ledger-entry existence check), not a static badge. Returns
// [label, status, ok] triples; ok=false renders red. Failures degrade gracefully.
export async function healthCheck() {
  const rows = [];
  // 1. Soroban RPC actually reachable + healthy
  try { const h = await server.getHealth(); const ok = h?.status === "healthy"; rows.push(["Soroban RPC", ok ? "healthy" : (h?.status || "reachable"), ok]); }
  catch { rows.push(["Soroban RPC", "unreachable", false]); }
  // 2. OTC desk responds and reports its live RFQ count
  try { const c = await simulate(OTC, "rfq_count"); rows.push(["OTC desk", c.ok ? `live · ${Number(c.value)} RFQ` : "no response", c.ok]); }
  catch { rows.push(["OTC desk", "no response", false]); }
  // 3. Both verifier contracts are genuinely deployed on-chain (ledger entry exists)
  for (const [name, id] of [["bidValidity verifier", BID_VERIFIER], ["auctionResult verifier", AUCTION_VERIFIER]]) {
    try { const e = await server.getLedgerEntries(new Sdk.Contract(id).getFootprint()); const ok = !!(e.entries && e.entries.length); rows.push([name, ok ? "deployed" : "missing", ok]); }
    catch { rows.push([name, "unreachable", false]); }
  }
  // 4. On-chain Poseidon host fn matches circomlib (live contract call)
  try { const p = await poseidonHash(1, 2); const ok = p.toLowerCase().startsWith("0x115cc0f5"); rows.push(["Poseidon host fn", ok ? "matches circomlib" : "mismatch", ok]); }
  catch { rows.push(["Poseidon host fn", "unreachable", false]); }
  // 5. USDC SAC escrow held by the OTC contract (real balance read)
  try { const b = await balanceOf(OTC); rows.push(["USDC SAC escrow", b === "0" ? "0 held (no open bids)" : `${b} stroops held`, true]); }
  catch { rows.push(["USDC SAC escrow", "unreadable", false]); }
  return rows;
}

export const txExplorer = (h) => `https://stellar.expert/explorer/testnet/tx/${h}`;
export const explorer = (id) => `https://stellar.expert/explorer/testnet/contract/${id}`;
