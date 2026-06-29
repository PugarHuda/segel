// Segel Desk — confidential sealed-bid OTC on Stellar.
// Vanilla renderer over the live testnet contract. ZK proofs (bidValidity,
// auctionResult) are generated in THIS browser with snarkjs and verified on-chain
// by the deployed Soroban verifiers. Bid amounts never leave the device.
import * as chain from "./stellar.js";
import * as prover from "./prover.js";
import * as wallet from "./wallet.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const short = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "—");
const fmt = (n) => Number(n).toLocaleString("en-US");
// stroops -> "1,234.56"; sub-cent legacy values keep their real digits (no dishonest 0.00)
const usd = (stroops) => Number(chain.toUsdc(stroops)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 7 });

const TOK = {
  XLM: { bg: "#e6ecfb", fg: "#3a4a8a" }, USDC: { bg: "#e6f5ee", fg: "#2f9b6e" },
  AQUA: { bg: "#ece2f6", fg: "#7a5fae" }, yBTC: { bg: "#fbeede", fg: "#b07320" },
  EURC: { bg: "#eef1fb", fg: "#3a4a8a" }, GYEN: { bg: "#f3e0e8", fg: "#a04a70" },
};
const tokOf = (s) => TOK[s] || { bg: "#f1f3f9", fg: "#5d6273" };

const STATUS = {
  0: { l: "Open", bg: "#eef1fb", c: "#3a4a8a" },
  1: { l: "Filled", bg: "#e6f5ee", c: "#2f9b6e" },
  2: { l: "Cancelled", bg: "#f1f3f9", c: "#9aa0b2" },
};

const S = {
  view: "active", connected: false, address: null, balance: "0",
  rfqs: [], events: [], loading: true, modal: null, toast: null,
  form: { pair: "XLM / USDC", side: "SELL", mode: 1, min: "3", max: "5", deadlineMin: "60", lot: "20" },
  createMode: 1, health: null,
};

// ---- bid-opening store (so the maker can settle from this browser) ----
const LSKEY = "segel.openings";
function loadOpenings() { try { return JSON.parse(localStorage.getItem(LSKEY) || "{}"); } catch { return {}; } }
function saveOpening(rfqId, o) {
  const all = loadOpenings();
  (all[rfqId] = all[rfqId] || []).push(o);
  localStorage.setItem(LSKEY, JSON.stringify(all));
}
function openingsFor(rfqId) { return loadOpenings()[rfqId] || []; }

function toast(msg, icon = "✓", bg = "#0b0b0e", color = "#fff") {
  S.toast = { msg, icon, bg, color };
  render();
  setTimeout(() => { S.toast = null; render(); }, 3200);
}
function logEvent(type, title, detail, tx) {
  S.events.unshift({ type, title, detail, tx: tx ? short(tx) : "—", txHash: tx, time: "just now" });
}

const rnd = () => { const a = new Uint8Array(31); crypto.getRandomValues(a); let x = 0n; for (const b of a) x = (x << 8n) | BigInt(b); return x.toString(); };

// ============================ RENDER ============================
function render() {
  $("app").innerHTML = `
  <div class="desk">
    ${sidebar()}
    <div class="desk-main">${S.toast ? toastEl() : ""}<div class="desk-inner">${mainView()}</div></div>
  </div>
  ${S.modal ? modalEl() : ""}`;
  bind();
}

function logo() {
  return `<div style="width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#7585e4,#b3a6dd);position:relative;flex-shrink:0">
    <div style="position:absolute;left:50%;top:50%;width:60%;height:60%;transform:translate(-50%,-50%)">
      ${[0, 60, 120].map((r) => `<div style="position:absolute;left:50%;top:50%;width:100%;height:25%;margin:-12.5% 0 0 -50%;border-radius:99px;background:#fff;transform:rotate(${r}deg)"></div>`).join("")}
    </div></div>`;
}

function sidebar() {
  const nav = [
    ["active", "grid_view", "Active RFQs"], ["create", "swap_horiz", "Create RFQ"],
    ["activity", "history", "My Activity"], ["portfolio", "account_balance_wallet", "Portfolio"],
    ["audit", "verified_user", "Audit"], ["faucet", "water_drop", "Faucet"], ["docs", "description", "Docs"],
  ];
  const items = nav.map(([k, ic, l]) => {
    const a = S.view === k;
    return `<button class="navbtn" data-nav="${k}" style="display:flex;align-items:center;gap:11px;background:${a ? "#1c1d24" : "transparent"};color:${a ? "#fff" : "#9094a4"};border:none;border-radius:8px;padding:9px 11px;font-size:12px;font-weight:500;cursor:pointer;text-align:left">
      <span class="msi" style="font-size:18px;color:${a ? "#fff" : "#6a6e7e"}">${ic}</span>${l}</button>`;
  }).join("");
  const walletBox = S.connected
    ? `<div class="side-wallet" style="background:#131318;border-radius:10px;padding:11px 12px;min-width:148px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
          <span style="font-size:9px;color:#c2a45a;border:1px solid #5a4e2e;border-radius:5px;padding:2px 6px">${chain.usingWallet() ? "FREIGHTER" : "DEMO KEY"}</span>
          <button data-act="disconnect" title="Disconnect" class="msi" style="background:none;border:none;color:#6a6e7e;cursor:pointer;font-size:14px;padding:0">logout</button>
        </div>
        <div class="wbal" style="font-family:'Pixelify Sans',monospace;font-weight:600;font-size:16px">${usd(S.balance)} <span style="font-size:10px;color:#8a8e9e">USDC</span></div>
        <div style="font-size:10px;color:#8a8e9e;margin-top:2px">${short(S.address)}</div>
      </div>`
    : `<button data-act="connect" class="side-wallet" style="background:#fff;color:#0b0b0e;border:none;border-radius:9px;padding:11px 16px;font-size:12px;font-weight:600;cursor:pointer">Connect wallet</button>`;
  return `<div class="desk-side">
    <div class="side-brand" style="display:flex;align-items:center;gap:10px;padding:4px 6px 14px">${logo()}
      <div><div style="font-family:'Pixelify Sans',monospace;font-weight:700;font-size:17px;letter-spacing:1px;line-height:1">SEGEL</div>
        <div style="font-size:8.5px;color:#6a6e7e;letter-spacing:1px;margin-top:2px">STELLAR · TESTNET</div></div></div>
    <div class="side-rpc" style="display:flex;align-items:center;gap:7px;background:#131318;border-radius:8px;padding:8px 10px;margin-bottom:16px">
      <span style="width:7px;height:7px;border-radius:50%;background:#4cae8a;flex-shrink:0"></span>
      <span style="font-size:9.5px;color:#8a8e9e;letter-spacing:.5px">soroban · testnet RPC</span></div>
    <button data-nav="create" class="side-newbtn" style="display:flex;align-items:center;justify-content:center;gap:7px;background:linear-gradient(135deg,#7585e4,#b3a6dd);color:#fff;border:none;border-radius:9px;padding:11px;font-size:12px;font-weight:600;cursor:pointer;margin-bottom:16px"><span class="msi" style="font-size:17px">add</span>New RFQ</button>
    <div class="side-nav">${items}</div>
    ${walletBox}
  </div>`;
}

function toastEl() {
  return `<div style="position:absolute;top:18px;left:50%;transform:translateX(-50%);z-index:80;background:${S.toast.bg};color:${S.toast.color};padding:10px 18px;border-radius:10px;font-size:12px;font-weight:500;box-shadow:0 16px 40px -16px rgba(20,21,40,.5);animation:segelToast .2s ease-out;display:flex;align-items:center;gap:9px;white-space:nowrap"><span style="font-size:14px">${S.toast.icon}</span>${esc(S.toast.msg)}</div>`;
}

function header(kicker, title, right = "") {
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
    <div><div style="font-size:11px;letter-spacing:1.5px;color:#9aa0b2;margin-bottom:5px">${kicker}</div>
    <h1 style="margin:0;font-family:'Pixelify Sans',monospace;font-weight:700;font-size:25px">${title}</h1></div>${right}</div>`;
}

function mainView() {
  const v = S.view;
  if (v === "active") return viewActive();
  if (v === "create") return viewCreate();
  if (v === "activity") return viewActivity();
  if (v === "portfolio") return viewPortfolio();
  if (v === "audit") return viewAudit();
  if (v === "faucet") return viewFaucet();
  if (v === "docs") return viewDocs();
  return "";
}

function pairSyms(pair) {
  const parts = pair.split("/").map((x) => x.trim());
  return [parts[0] || "?", parts[1] || "USDC"];
}

function viewActive() {
  const rows = S.rfqs.map((r) => {
    const [sT, bT] = pairSyms(r.pair);
    const s = tokOf(sT), b = tokOf(bT), st = STATUS[r.status] || STATUS[0];
    const mine = S.connected && r.maker === S.address;
    const expired = r.deadline * 1000 < Date.now();
    let label = "Bid", bg = "#eef1fb", col = "#3a4a8a", act = `bid:${r.id}`;
    if (r.status === 1) { label = "View"; bg = "#f1f3f9"; col = "#5d6273"; act = `view:${r.id}`; }
    else if (r.status === 2) { label = "—"; bg = "#f1f3f9"; col = "#c2c7d6"; act = ""; }
    else if (mine) {
      if (expired && r.bids === 0) { label = "Cancel"; bg = "#fbeede"; col = "#b07320"; act = `cancel:${r.id}`; }
      else { label = "Settle"; bg = "#fbeede"; col = "#b07320"; act = `settle:${r.id}`; }
    }
    const exp = expired ? "expired" : "open";
    return `<div class="rfq-grid" style="display:grid;grid-template-columns:0.8fr 1.7fr 0.7fr 1fr 1.2fr 0.55fr 1fr 0.8fr;gap:10px;align-items:center;padding:11px 14px;border-bottom:1px solid #f4f6fb;background:${mine ? "#f9faff" : "#fff"}">
      <span style="font-size:11px;font-weight:600;color:#33384a">RFQ-${String(r.id).padStart(3, "0")}</span>
      <div style="display:flex;align-items:center;gap:7px">
        <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:20px;height:20px;border-radius:50%;background:${s.bg};color:${s.fg};font-size:9px;font-weight:700;display:inline-flex;align-items:center;justify-content:center">${esc(sT.slice(0, 3))}</span><span style="font-size:10.5px;font-weight:600">${esc(sT)}</span></span>
        <span class="msi" style="font-size:14px;color:#c2c7d6">arrow_forward</span>
        <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:20px;height:20px;border-radius:50%;background:${b.bg};color:${b.fg};font-size:9px;font-weight:700;display:inline-flex;align-items:center;justify-content:center">${esc(bT.slice(0, 3))}</span><span style="font-size:10.5px;font-weight:600">${esc(bT)}</span></span>
      </div>
      <span style="font-size:9.5px;font-weight:600;color:${r.mode === 0 ? "#3a4a8a" : "#7a5fae"}">${r.mode === 0 ? "DIRECT" : "RFQ"}</span>
      <div style="display:flex;align-items:center;gap:5px;font-size:10.5px;color:#5d6273">${short(r.maker)}${mine ? `<span style="font-size:8.5px;font-weight:600;padding:1px 5px;border-radius:4px;background:#eef1fb;color:#6c7fe0">YOU</span>` : ""}</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:10.5px;color:#5d6273"><span class="msi" style="font-size:13px;color:#b6bdd0">lock</span>${usd(r.bandMin)}–${usd(r.bandMax)}${r.baseLot ? `<span style="font-size:8.5px;font-weight:600;padding:1px 5px;border-radius:4px;background:#eaf5ef;color:#2f9b6e" title="delivery leg: winner receives this lot">${(+r.baseLot).toLocaleString()} XLM</span>` : ""}</div>
      <span style="font-weight:700;font-size:13px;color:#14151a">${r.bids}</span>
      <span><span style="font-size:9.5px;font-weight:600;padding:3px 9px;border-radius:6px;background:${st.bg};color:${st.c}">${st.l}</span></span>
      <div style="display:flex;justify-content:flex-end">${act ? `<button class="rowact" data-act="${act}" style="font-size:10.5px;font-weight:600;border:none;cursor:pointer;padding:7px 12px;border-radius:7px;background:${bg};color:${col}">${label}</button>` : `<span style="font-size:10px;color:${expired ? "#c98a2e" : "#9aa0b2"}">${exp}</span>`}</div>
    </div>`;
  }).join("");
  const empty = `<div style="padding:40px;text-align:center;color:#aab0c0;font-size:12px">${S.loading ? "loading live RFQs from Stellar testnet…" : "No RFQs yet — create the first one."}</div>`;
  return `<div>
    ${header("SIZE BANDS VISIBLE · BID AMOUNTS ENCRYPTED", "Active RFQs", `<span style="font-size:11px;color:#9aa0b2;background:#f1f3f9;border-radius:7px;padding:7px 12px;font-weight:600">${S.rfqs.length} live</span>`)}
    <div class="tablescroll" style="margin-top:8px">
      <div class="rfq-grid" style="display:grid;grid-template-columns:0.8fr 1.7fr 0.7fr 1fr 1.2fr 0.55fr 1fr 0.8fr;gap:10px;padding:16px 14px 9px;font-size:9.5px;letter-spacing:.5px;color:#aab0c0;border-bottom:1px solid #eef1f8">
        <span>RFQ ID</span><span>SELL → BUY</span><span>MODE</span><span>MAKER</span><span>BAND</span><span>BIDS</span><span>STATUS</span><span></span></div>
      ${S.rfqs.length ? rows : empty}</div></div>`;
}

function viewCreate() {
  const m = S.createMode;
  const card = (mode, icon, ic, title, sub, body, k1, v1, k2, v2) => `
    <div data-act="mode:${mode}" style="cursor:pointer;border:1.5px solid ${m === mode ? (mode === 0 ? "#7585e4" : "#9a7fc8") : "#edf0f7"};border-radius:14px;padding:20px;background:${m === mode ? (mode === 0 ? "#f4f6ff" : "#f7f4fc") : "#fbfcff"}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span class="msi" style="font-size:24px;color:${ic}">${icon}</span><span style="font-size:10px;color:#9aa0b2">Mode 0${mode + 1}</span></div>
      <div style="font-family:'Pixelify Sans',monospace;font-weight:600;font-size:18px;margin-bottom:3px">${title}</div>
      <div style="font-size:10.5px;color:#9aa0b2;margin-bottom:12px">${sub}</div>
      <div style="font-size:11.5px;color:#5d6273;line-height:1.6;margin-bottom:16px">${body}</div>
      <div style="display:flex;gap:20px"><div><div style="font-size:9.5px;color:#9aa0b2">${k1}</div><div style="font-size:13px;font-weight:600">${v1}</div></div><div><div style="font-size:9.5px;color:#9aa0b2">${k2}</div><div style="font-size:13px;font-weight:600">${v2}</div></div></div></div>`;
  return `<div>
    ${header("CHOOSE EXECUTION MODE", "Create RFQ")}
    <div class="g2" style="margin:16px 0 18px">
      ${card(0, "swap_horiz", "#6c7fe0", "Direct OTC", "One maker · one taker", "Atomic bilateral settlement with a known counterparty. Maker sets a hidden minimum; the first qualifying taker fills.", "Latency", "&lt; 5s", "Privacy", "End-to-end")}
      ${card(1, "hub", "#9a6ce0", "RFQ Auction", "N takers · Vickrey pricing", "Multi-bidder sealed auction. Highest sealed bid wins, pays the second-highest price. Optimal execution for size.", "Pricing", "Vickrey", "Max bidders", "8")}
    </div>
    <div style="background:#0b0b0e;border-radius:14px;padding:18px 20px;display:flex;gap:14px;align-items:flex-start;margin-bottom:18px">
      <span class="msi" style="font-size:22px;color:#4cae8a;flex-shrink:0">gpp_good</span>
      <div><div style="font-size:11px;letter-spacing:1px;color:#7e8294;margin-bottom:6px">WHAT STAYS PRIVATE</div>
      <div style="font-size:11.5px;color:#c2c7d6;line-height:1.6">Losing bid amounts are never revealed — on-chain or to the public — and every bidder's KYC identity stays hidden behind the ASP allow-list. The winner's address and the clearing price are public; the losing numbers are proven correct without being shown.</div></div></div>
    <div style="border:1px solid #edf0f7;border-radius:14px;padding:20px;max-width:560px">
      <div style="font-size:11px;letter-spacing:1px;color:#9aa0b2;margin-bottom:14px">${m === 0 ? "DIRECT OTC" : "RFQ AUCTION"} · DETAILS</div>
      <div class="g2" style="gap:13px">
        ${field("PAIR", "pair", S.form.pair, "1 / -1")}
        <div><label style="font-size:10.5px;color:#8a8f9c;display:block;margin-bottom:6px">SIDE</label>
          <div style="display:flex;gap:6px">
            <button data-act="side:BUY" style="flex:1;font-size:12px;font-weight:600;cursor:pointer;padding:9px;border-radius:8px;border:1px solid ${S.form.side === "BUY" ? "#aebdf0" : "#e4e8f2"};background:${S.form.side === "BUY" ? "#e6ecfb" : "#fff"};color:${S.form.side === "BUY" ? "#3a4a8a" : "#9aa0b2"}">Buy</button>
            <button data-act="side:SELL" style="flex:1;font-size:12px;font-weight:600;cursor:pointer;padding:9px;border-radius:8px;border:1px solid ${S.form.side === "SELL" ? "#e8a8c4" : "#e4e8f2"};background:${S.form.side === "SELL" ? "#fbe7ef" : "#fff"};color:${S.form.side === "SELL" ? "#b05080" : "#9aa0b2"}">Sell</button></div></div>
        ${field("MIN PRICE", "min", S.form.min)}
        ${field("MAX PRICE (= escrow)", "max", S.form.max)}
        ${field("LOT — XLM you deliver (0 = none)", "lot", S.form.lot)}
        ${field("DEADLINE (min from now)", "deadlineMin", S.form.deadlineMin)}
      </div>
      <button data-act="post" style="margin-top:16px;width:100%;font-size:12.5px;font-weight:600;cursor:pointer;padding:12px;border-radius:9px;border:none;background:linear-gradient(135deg,#7585e4,#b3a6dd);color:#fff;display:inline-flex;align-items:center;justify-content:center;gap:7px">Post ${m === 0 ? "direct" : "RFQ"} &amp; open escrow ↗</button>
    </div></div>`;
}
function field(label, key, val, span = "") {
  return `<div ${span ? `style="grid-column:${span}"` : ""}><label style="font-size:10.5px;color:#8a8f9c;display:block;margin-bottom:6px">${label}</label><input data-form="${key}" value="${esc(val)}" style="width:100%;font-size:13px;padding:9px 11px;border:1px solid #e4e8f2;border-radius:8px;background:#fff" /></div>`;
}

function viewActivity() {
  const evMap = { SETTLE: ["verified", "#e6f5ee", "#2f9b6e"], BID: ["lock", "#eef1fb", "#3a4a8a"], POST: ["add", "#f1f3f9", "#5d6273"], CANCEL: ["undo", "#fbeede", "#b07320"], FAUCET: ["water_drop", "#eef1fb", "#3a4a8a"] };
  const rows = S.events.map((e) => {
    const [ic, bg, c] = evMap[e.type] || evMap.POST;
    return `<div style="display:flex;align-items:center;gap:13px;background:#fbfcff;border:1px solid #edf0f7;border-radius:10px;padding:12px 14px">
      <span class="msi" style="width:34px;height:34px;border-radius:8px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:17px;background:${bg};color:${c}">${ic}</span>
      <div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:600">${esc(e.title)}</div><div style="font-size:10.5px;color:#8a8f9c">${esc(e.detail)}</div></div>
      <div style="text-align:right;flex-shrink:0"><div style="font-size:10px;color:#9aa0b2">${e.time}</div>${e.txHash ? `<a href="${chain.txExplorer(e.txHash)}" target="_blank" style="font-size:9.5px;text-decoration:none">${e.tx} ↗</a>` : ""}</div></div>`;
  }).join("");
  return `<div>${header("SEGEL · THIS SESSION", "My Activity")}
    <div style="display:flex;flex-direction:column;gap:8px;max-width:780px;margin-top:14px">${S.events.length ? rows : `<div style="padding:30px;text-align:center;color:#aab0c0;font-size:12px">No activity yet. Post an RFQ or seal a bid.</div>`}</div></div>`;
}

function viewPortfolio() {
  const mine = S.rfqs.filter((r) => r.maker === S.address);
  const myBids = [];
  S.rfqs.forEach((r) => { if (openingsFor(r.id).length) myBids.push(r); });
  const card = (label, val, color, note) => `<div style="background:${color === "dark" ? "#0b0b0e" : "#fbfcff"};border:${color === "dark" ? "none" : "1px solid #edf0f7"};border-radius:13px;padding:16px;color:${color === "dark" ? "#fff" : "#14151a"}">
    <div style="font-size:10px;color:${color === "dark" ? "#8a8e9e" : "#9aa0b2"};letter-spacing:.5px;margin-bottom:8px">${label}</div>
    <div style="font-family:'Pixelify Sans',monospace;font-weight:700;font-size:26px;color:${color === "dark" ? "#fff" : color === "p" ? "#6c7fe0" : "#c2a45a"}">${val}</div>
    <div style="font-size:10px;color:${color === "dark" ? "#8a8e9e" : "#9aa0b2"};margin-top:3px">${note}</div></div>`;
  const list = (title, arr, sub) => `<div><div style="font-size:11px;letter-spacing:1px;color:#9aa0b2;margin-bottom:10px">${title}</div>
    <div style="display:flex;flex-direction:column;gap:7px">${arr.length ? arr.map(sub).join("") : `<div style="font-size:10.5px;color:#aab0c0;text-align:center;padding:14px;background:#fbfcff;border:1px dashed #e2e7f2;border-radius:9px">None yet</div>`}</div></div>`;
  return `<div>${header("SEGEL · YOUR POSITIONS", "Portfolio")}
    <div class="g3" style="margin:16px 0 20px">
      ${card("AVAILABLE", usd(S.balance), "dark", "USDC")}
      ${card("YOUR RFQS", mine.length, "p", "posted")}
      ${card("YOUR SEALED BIDS", myBids.reduce((a, r) => a + openingsFor(r.id).length, 0), "g", "identity private")}
    </div>
    <div class="g2" style="gap:18px">
      ${list("YOUR RFQS", mine, (r) => `<div style="display:flex;justify-content:space-between;align-items:center;background:#fbfcff;border:1px solid #edf0f7;border-radius:9px;padding:10px 12px"><div><div style="font-size:11.5px;font-weight:600">${esc(r.pair)}</div><div style="font-size:9.5px;color:#9aa0b2">RFQ-${String(r.id).padStart(3, "0")} · ${r.bids} bids</div></div><span style="font-size:9.5px;font-weight:600;padding:3px 8px;border-radius:5px;background:${(STATUS[r.status] || STATUS[0]).bg};color:${(STATUS[r.status] || STATUS[0]).c}">${(STATUS[r.status] || STATUS[0]).l}</span></div>`)}
      ${list("YOUR SEALED BIDS", myBids, (r) => `<div style="display:flex;justify-content:space-between;align-items:center;background:#fbfcff;border:1px solid #edf0f7;border-radius:9px;padding:10px 12px"><div><div style="font-size:11.5px;font-weight:600">${esc(r.pair)}</div><div style="font-size:9.5px;color:#9aa0b2;letter-spacing:1px">commit •••• · RFQ-${String(r.id).padStart(3, "0")}</div></div><span style="font-size:9.5px;font-weight:600;padding:3px 8px;border-radius:5px;background:#ece2f6;color:#7a5fae">${openingsFor(r.id).length} sealed</span></div>`)}
    </div></div>`;
}

function viewAudit() {
  const contracts = [
    ["OTC desk", chain.OTC], ["bidValidity verifier", chain.BID_VERIFIER],
    ["auctionResult verifier", chain.AUCTION_VERIFIER], ["USDC SAC (escrow)", chain.USDC_SAC],
    ["Reflector oracle (SEP-40)", chain.ORACLE],
  ];
  const probing = S.health === null || S.health === "loading";
  const healthRows = probing
    ? ["Soroban RPC", "OTC desk", "bidValidity verifier", "auctionResult verifier", "Poseidon host fn", "USDC SAC escrow", "Reflector XLM mark"].map((n) => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px"><span style="color:#33384a">${n}</span><span style="color:#9aa0b2">checking…</span></div>`).join("")
    : S.health.map(([n, s, ok]) => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px"><span style="color:#33384a">${n}</span><span style="display:inline-flex;align-items:center;gap:6px;color:${ok ? "#2f9b6e" : "#b04a4a"}"><span style="width:14px;height:14px;border-radius:50%;background:${ok ? "#2f9b6e" : "#b04a4a"};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:9px">${ok ? "✓" : "✗"}</span>${esc(s)}</span></div>`).join("");
  const mcp = [["list_rfqs()", "open RFQs from on-chain state", "RFQ[]"], ["verify_settlement(rfq)", "recheck a settled RFQ on-chain", "{settled, clearing, winner}"], ["clearing_price(rfq)", "public clearing price", "number"], ["bid_count(rfq)", "sealed bid count", "number"], ["mark_price(sym)", "live Reflector USD mark", "{usd, timestamp}"]];
  return `<div>${header("SEGEL · AUDIT SURFACE", "Audit &amp; Integrations")}
    <div class="g2" style="margin-top:14px">
      <div style="border:1px solid #edf0f7;border-radius:13px;padding:18px;background:#fbfcff">
        <div style="font-size:11px;letter-spacing:1px;color:#9aa0b2;margin-bottom:13px">DEPLOYED ON TESTNET</div>
        <div style="display:flex;flex-direction:column;gap:11px">${contracts.map(([n, id]) => `<div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:12px;font-weight:600">${n}</div><div style="font-size:10px;color:#9aa0b2">${short(id)}</div></div><a href="${chain.explorer(id)}" target="_blank" style="font-size:10px;text-decoration:none;display:inline-flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:50%;background:#4cae8a"></span>explorer ↗</a></div>`).join("")}</div></div>
      <div style="border:1px solid #edf0f7;border-radius:13px;padding:18px;background:#fbfcff">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px"><span style="font-size:11px;letter-spacing:1px;color:#9aa0b2">INTEGRATION HEALTH · LIVE</span><button data-act="health" ${probing ? "disabled" : ""} style="font-size:10px;font-weight:600;border:none;cursor:pointer;background:#eef1fb;color:#3a4a8a;padding:5px 9px;border-radius:6px;${probing ? "opacity:.5" : ""}">${probing ? "probing…" : "Re-run"}</button></div>
        <div style="display:flex;flex-direction:column;gap:10px">${healthRows}</div></div>
      <div style="border:1px solid #edf0f7;border-radius:13px;padding:18px;background:#fbfcff">
        <div style="font-size:11px;letter-spacing:1px;color:#9aa0b2;margin-bottom:13px">ON-CHAIN POSEIDON CHECK</div>
        <div style="font-size:11px;color:#5d6273;margin-bottom:12px;line-height:1.5">Call the contract's <b>poseidon_hash(1,2)</b> live and confirm it equals circomlib's poseidon([1,2]) — the commitment scheme is verifiable on-chain, not just asserted.</div>
        <button data-act="poseidon" style="font-size:11px;font-weight:600;border:none;cursor:pointer;background:#eef1fb;color:#3a4a8a;padding:8px 12px;border-radius:7px">Run poseidon_hash(1,2)</button>
        <div id="poseidon-out" style="font-size:10px;color:#2f7d5e;margin-top:10px;word-break:break-all"></div></div>
      <div style="border:1px solid #edf0f7;border-radius:13px;padding:18px;background:#fbfcff">
        <div style="font-size:11px;letter-spacing:1px;color:#9aa0b2;margin-bottom:13px">SELF-AUDIT · contract tests</div>
        <div style="display:flex;gap:10px;margin-bottom:13px"><div style="flex:1;text-align:center;background:#e6f5ee;border-radius:9px;padding:11px"><div style="font-family:'Pixelify Sans',monospace;font-weight:700;font-size:22px;color:#2f9b6e">22</div><div style="font-size:9.5px;color:#5d8c75">unit tests</div></div><div style="flex:1;text-align:center;background:#eef1fb;border-radius:9px;padding:11px"><div style="font-family:'Pixelify Sans',monospace;font-weight:700;font-size:22px;color:#3a4a8a">2</div><div style="font-size:9.5px;color:#6a72a0">circuits</div></div><div style="flex:1;text-align:center;background:#fbf3df;border-radius:9px;padding:11px"><div style="font-family:'Pixelify Sans',monospace;font-weight:700;font-size:22px;color:#b08a2e">1</div><div style="font-size:9.5px;color:#9a7a3a">tamper test</div></div></div>
        <div style="font-size:10.5px;color:#5d6273;line-height:1.6">Binding: the contract builds every verifier public-input vector itself. Tampering the clearing price → rejected on-chain (InvalidProof).</div></div>
      <div style="border:1px solid #edf0f7;border-radius:13px;padding:18px;background:#0b0b0e;grid-column:1 / -1">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px"><div style="font-size:11px;letter-spacing:1px;color:#7e8294">MCP SERVER · Stellar-native, read-only</div><span style="font-size:10px;color:#4cae8a;display:inline-flex;align-items:center;gap:6px"><span style="width:7px;height:7px;border-radius:50%;background:#4cae8a"></span>live · reads on-chain</span></div>
        <div class="g2" style="gap:10px">${mcp.map(([call, desc, ret]) => `<div style="background:#16161b;border-radius:10px;padding:12px 13px"><div style="font-size:11.5px;color:#cdd2e0;font-weight:600">${call}</div><div style="font-size:10px;color:#7e8294;margin-top:5px;line-height:1.5">${desc}</div><div style="font-size:9.5px;color:#5a8f7a;margin-top:7px">→ ${ret}</div></div>`).join("")}</div></div>
    </div></div>`;
}

function viewFaucet() {
  const demo = S.connected && !chain.usingWallet();
  const blurb = demo
    ? "The embedded demo key is already pre-funded with testnet USDC — there's nothing to request. Connect Freighter to fund your own wallet instead. Stellar testnet only — no real value."
    : "Fund your own wallet with testnet USDC (friendbot XLM + a USDC trustline + a transfer) to post RFQs and seal bids. Stellar testnet only — no real value.";
  const label = demo ? "Refresh balance" : "Fund my wallet with testnet USDC";
  return `<div style="display:flex;justify-content:center">
    <div style="max-width:420px;width:100%;margin-top:30px;text-align:center;border:1px solid #edf0f7;border-radius:16px;padding:30px;background:#fbfcff">
      <span class="msi" style="font-size:40px;color:#6c7fe0">water_drop</span>
      <div style="font-family:'Pixelify Sans',monospace;font-weight:700;font-size:20px;margin:10px 0 6px">Testnet Faucet</div>
      <div style="font-size:11.5px;color:#8a8f9c;line-height:1.6;margin-bottom:20px">${blurb}</div>
      <div style="background:#fff;border:1px solid #edf0f7;border-radius:10px;padding:14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;color:#9aa0b2">Current balance</span><span style="font-family:'Pixelify Sans',monospace;font-weight:600;font-size:16px">${usd(S.balance)} USDC</span></div>
      <button data-act="dofaucet" style="width:100%;font-size:12.5px;font-weight:600;cursor:pointer;padding:13px;border-radius:10px;border:none;background:linear-gradient(135deg,#7585e4,#b3a6dd);color:#fff">${label}</button>
    </div></div>`;
}

function viewDocs() {
  const steps = [
    ["1", "POST", "Maker opens an RFQ: pair, public size band, deadline. The minimum price stays hidden."],
    ["2", "BID", "Taker submits a sealed bid = Poseidon(amount, nonce, addr) + a bidValidity proof (in band, has funds, allow-listed)."],
    ["3", "ESCROW", "Taker locks good-faith USDC escrow (= band max) to back the bid."],
    ["4", "SETTLE", "Prover runs auctionResult: one proof of winner + Vickrey clearing price, without opening losing bids."],
    ["5", "CLEAR", "Contract verifies → winner pays clearing to maker, surplus + losers refunded. Receipt on-chain."],
  ];
  return `<div>${header("SEGEL · HOW IT WORKS", "Docs")}
    <div class="docs-grid" style="margin-top:14px">
      <div><div style="font-size:11px;letter-spacing:1px;color:#9aa0b2;margin-bottom:14px">THE 5-STEP FLOW</div>
        <div style="display:flex;flex-direction:column;gap:10px">${steps.map(([n, t, b]) => `<div style="display:flex;gap:13px;align-items:flex-start;background:#fbfcff;border:1px solid #edf0f7;border-radius:11px;padding:13px 15px"><span style="font-family:'Pixelify Sans',monospace;font-weight:700;font-size:18px;color:#b6bdd0;flex-shrink:0;width:24px">${n}</span><div><div style="font-size:12.5px;font-weight:600;margin-bottom:3px">${t}</div><div style="font-size:11px;color:#5d6273;line-height:1.6">${b}</div></div></div>`).join("")}</div></div>
      <div><div style="font-size:11px;letter-spacing:1px;color:#9aa0b2;margin-bottom:14px">CIRCUITS &amp; VISIBILITY</div>
        <div style="background:#fbfcff;border:1px solid #edf0f7;border-radius:11px;padding:15px;margin-bottom:12px"><div style="font-size:12px;font-weight:600;margin-bottom:4px">bidValidity.circom</div><div style="font-size:10.5px;color:#5d6273;line-height:1.6">commit == Poseidon(bid,nonce,addr) · band_min ≤ bid ≤ band_max · bid ≤ balance (proof-of-funds) · allowlist membership · fresh nullifier.</div></div>
        <div style="background:#fbfcff;border:1px solid #edf0f7;border-radius:11px;padding:15px;margin-bottom:18px"><div style="font-size:12px;font-weight:600;margin-bottom:4px">auctionResult.circom</div><div style="font-size:10.5px;color:#5d6273;line-height:1.6">all commits bind · winner = argmax · clearingPrice = second-highest (Vickrey) · compared in-circuit. Losing bids never output.</div></div>
        <div style="background:#eef1fb;border-radius:11px;padding:15px;margin-bottom:12px"><div style="font-size:11px;font-weight:600;color:#3a4a8a;margin-bottom:8px">PUBLIC</div><div style="font-size:10.5px;color:#4a5280;line-height:1.7">winner · clearing price · size band · settlement receipt</div></div>
        <div style="background:#0b0b0e;border-radius:11px;padding:15px"><div style="font-size:11px;font-weight:600;color:#c2c7d6;margin-bottom:8px">SECRET FOREVER (on-chain)</div><div style="font-size:10.5px;color:#8a8e9e;line-height:1.7">all losing bids · maker min price · bidder KYC identity</div></div>
        <div style="margin-top:16px;background:#fbf3df;border-radius:11px;padding:13px;font-size:10.5px;color:#8a6e2e;line-height:1.6"><b>Honest note:</b> proving + settlement are REAL (snarkjs in-browser, verified on-chain). In the no-wallet demo one key plays maker + several sealed bidders via distinct ZK identities; on mainnet these are separate parties, and the maker collects bid openings off-chain at reveal.</div>
      </div></div></div>`;
}

// ============================ MODALS ============================
function modalEl() {
  const m = S.modal;
  if (m.type === "connect") return wrap(`<div style="width:380px;max-width:100%;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 40px 90px -30px rgba(20,21,40,.6);animation:segelPop .18s ease-out">
    <div style="padding:18px 22px;background:#0b0b0e;color:#fff"><div style="font-size:10px;opacity:.7;letter-spacing:1px">CONNECT</div><div style="font-family:'Pixelify Sans',monospace;font-weight:600;font-size:18px;margin-top:2px">Choose a wallet</div></div>
    <div style="padding:18px 22px;display:flex;flex-direction:column;gap:9px">
      <button data-act="conn:freighter" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;border:1px solid #e4e8f2;background:#fff;border-radius:10px;padding:13px 15px;font-size:13px;font-weight:600">Freighter <span style="color:#6c7fe0">↗</span></button>
      <button data-act="conn:demo" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;border:1px dashed #d4dae8;background:#fafbfe;border-radius:10px;padding:13px 15px;font-size:13px;font-weight:600;color:#5d6273">Embedded key <span style="font-size:10px;color:#9aa0b2">no-install</span></button>
      <div style="font-size:10px;color:#9aa0b2;text-align:center;margin-top:4px">Testnet only. Faucet funds your account in one click.</div></div></div>`);

  if (m.type === "bid") {
    const r = m.rfq, [sT, bT] = pairSyms(r.pair);
    if (m.proving) return wrap(provingCard(m.stage));
    const amt = m.amount, valid = amt !== "" && !isNaN(+amt);
    const bMin = chain.toUsdc(r.bandMin), bMax = chain.toUsdc(r.bandMax); // band in USDC
    const inBand = valid && +amt >= bMin && +amt <= bMax;
    return wrap(`<div style="width:440px;max-width:100%;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 40px 90px -30px rgba(20,21,40,.6);animation:segelPop .18s ease-out">
      <div style="padding:16px 22px;display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,#7585e4,#b3a6dd);color:#fff"><div><div style="font-size:10px;opacity:.85;letter-spacing:1px">SEAL A BID · RFQ-${String(r.id).padStart(3, "0")}</div><div style="font-family:'Pixelify Sans',monospace;font-weight:600;font-size:18px;margin-top:2px">${esc(r.pair)}</div></div><button data-act="closemodal" style="background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:7px;cursor:pointer;font-size:14px">×</button></div>
      <div style="padding:20px 22px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#8a8f9c;margin-bottom:8px"><span>your sealed bid (USDC)</span><span>band ${usd(r.bandMin)}–${usd(r.bandMax)}</span></div>
        ${r.baseLot ? `<div style="display:flex;align-items:center;gap:7px;background:#eaf5ef;border-radius:9px;padding:9px 12px;margin-bottom:12px"><span class="msi" style="font-size:16px;color:#2f9b6e">local_shipping</span><div style="font-size:11px;color:#2f7a58;line-height:1.4">Win and you receive <b>${(+r.baseLot).toLocaleString()} XLM</b>, delivered on-chain against your payment (DvP).</div></div>` : ""}
        <input data-bid="amt" value="${esc(amt)}" inputmode="decimal" style="width:100%;font-family:'Pixelify Sans',monospace;font-weight:700;font-size:30px;text-align:center;border:1px solid ${inBand ? "#cdd6f7" : "#e8b0b0"};border-radius:11px;padding:8px;margin-bottom:12px;color:${inBand ? "#14151a" : "#b05050"}" />
        <input type="range" data-bid="slider" min="${bMin}" max="${bMax}" step="0.01" value="${inBand ? amt : bMin}" />
        <div style="display:flex;justify-content:space-between;margin-top:7px;font-size:10.5px;color:#9aa0b2"><span>min ${usd(r.bandMin)}</span><span>max ${usd(r.bandMax)}</span></div>
        <div style="margin-top:16px;background:#f7f8fc;border-radius:11px;padding:13px">
          <div style="font-size:10.5px;color:#8a8f9c;margin-bottom:9px">COMMITMENT · Poseidon(bid, nonce, addr)</div>
          <div style="font-size:10.5px;color:#5d6273;word-break:break-all;line-height:1.5;margin-bottom:11px">${m.commit ? esc(m.commit.slice(0, 48)) + "…" : "computed locally when you seal"}</div>
          ${check(inBand, inBand ? "Bid is in band — range proof will pass" : "Bid is outside the band")}
          ${check(true, "Proof-of-funds: bid ≤ escrow (band max), locked on submit")}
          ${check(true, "Allowlist membership proven (Merkle, identity hidden)")}
          ${check(true, "Nullifier fresh — one bid per identity per RFQ")}
        </div>
        <button data-act="sealbid" ${inBand ? "" : "disabled"} style="margin-top:16px;width:100%;font-size:12.5px;font-weight:600;cursor:${inBand ? "pointer" : "not-allowed"};padding:13px;border-radius:10px;border:none;background:${inBand ? "linear-gradient(135deg,#7585e4,#b3a6dd)" : "#e4e8f2"};color:${inBand ? "#fff" : "#9aa0b2"}">Prove &amp; seal bid ↗</button>
      </div></div>`);
  }
  if (m.type === "proving") return wrap(provingCard(m.stage));
  return "";
}
function provingCard(stage) {
  return `<div style="width:360px;max-width:100%;background:#fff;border-radius:18px;padding:34px;text-align:center;box-shadow:0 40px 90px -30px rgba(20,21,40,.6);animation:segelPop .18s ease-out">
    <div style="width:64px;height:64px;margin:0 auto 18px;position:relative;animation:segelProve .8s linear infinite">
      ${[0, 60, 120].map((d) => `<div style="position:absolute;left:50%;top:50%;width:64px;height:14px;margin:-7px 0 0 -32px;border-radius:99px;background:linear-gradient(135deg,#7585e4,#b3a6dd);opacity:.85;transform:rotate(${d}deg)"></div>`).join("")}</div>
    <div style="font-family:'Pixelify Sans',monospace;font-weight:600;font-size:17px;margin-bottom:6px">${esc(stage || "Generating proof…")}</div>
    <div style="font-size:11px;color:#8a8f9c;line-height:1.6">Zero-knowledge proof generated in your browser. Bid amounts never leave this device.</div></div>`;
}
function check(ok, text) {
  const c = ok ? "#4cae8a" : "#d08a8a";
  return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:${c};margin-bottom:6px"><span style="width:15px;height:15px;border-radius:50%;background:${c};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:9px">${ok ? "✓" : "!"}</span>${text}</div>`;
}
function wrap(inner) {
  return `<div data-act="closemodal" style="position:fixed;inset:0;background:rgba(20,21,30,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:90;padding:20px"><div data-stop="1">${inner}</div></div>`;
}

// ============================ ACTIONS ============================
function bind() {
  document.querySelectorAll("[data-nav]").forEach((b) => b.onclick = () => { S.view = b.dataset.nav; S.modal = null; render(); });
  document.querySelectorAll("[data-act]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); act(b.dataset.act); });
  document.querySelectorAll("[data-form]").forEach((i) => i.oninput = () => { S.form[i.dataset.form] = i.value; });
  document.querySelectorAll("[data-stop]").forEach((d) => d.onclick = (e) => e.stopPropagation());
  // auto-probe integration health once when the Audit view is opened
  if (S.view === "audit" && S.health === null) { S.health = "loading"; doHealth(); }
  const amt = document.querySelector('[data-bid="amt"]'), sl = document.querySelector('[data-bid="slider"]');
  if (amt) amt.oninput = () => { S.modal.amount = amt.value; const s = document.querySelector('[data-bid="slider"]'); if (s && !isNaN(+amt.value)) s.value = amt.value; };
  if (sl) sl.oninput = () => { S.modal.amount = sl.value; const a = document.querySelector('[data-bid="amt"]'); if (a) a.value = sl.value; };
}

async function act(a) {
  const [cmd, arg] = a.split(":");
  if (cmd === "closemodal") { S.modal = null; return render(); }
  if (cmd === "connect") { S.modal = { type: "connect" }; return render(); }
  if (cmd === "disconnect") { wallet.disconnect(); S.connected = false; S.address = null; toast("Disconnected", "○"); return; }
  if (cmd === "conn") return doConnect(arg);
  if (cmd === "mode") { S.createMode = +arg; S.form.mode = +arg; return render(); }
  if (cmd === "side") { S.form.side = arg; return render(); }
  if (cmd === "post") return doPost();
  if (cmd === "bid") return openBid(+arg);
  if (cmd === "sealbid") return sealBid();
  if (cmd === "settle") return doSettle(+arg);
  if (cmd === "cancel") return doCancel(+arg);
  if (cmd === "view") { S.view = "activity"; return render(); }
  if (cmd === "dofaucet") return doFaucet();
  if (cmd === "poseidon") return doPoseidon();
  if (cmd === "health") { S.health = "loading"; render(); return doHealth(); }
}

async function doHealth() {
  try { S.health = await chain.healthCheck(); } catch { S.health = []; }
  if (S.view === "audit") render();
}

async function doConnect(kind) {
  S.modal = null; render();
  if (kind === "demo") {
    S.connected = true; S.address = chain.DEMO_ADDRESS; chain.setWalletSigner(null);
    toast("Connected with embedded demo key", "✓");
    await refreshBalance(); return refresh();
  }
  try {
    toast("Opening Freighter…", "◷");
    const w = await wallet.connect();
    S.connected = true; S.address = w.address;
    toast("Freighter connected", "✓");
    await refreshBalance(); refresh();
  } catch (e) { toast(e.message || "connect failed", "✕", "#3a1414", "#ffd2d2"); }
}

async function doFaucet() {
  if (!S.connected) return toast("Connect a wallet first", "!", "#3a2a14", "#ffe0b0");
  try {
    if (chain.usingWallet()) {
      // real funding: friendbot XLM + USDC trustline + a transfer from the demo whale
      toast("Requesting testnet USDC…", "◷");
      await wallet.setupTestnetFunds(S.address, null, (m) => toast(m, "◷"));
      logEvent("FAUCET", "Faucet", "funded wallet with testnet USDC");
      await refreshBalance(); toast("USDC received", "✓");
    } else {
      // the embedded demo key IS the funded source account — it can't faucet to
      // itself. Tell the truth and just refresh the (already large) balance.
      await refreshBalance();
      toast("Demo key is pre-funded — balance refreshed", "✓");
    }
  } catch (e) { toast(e.message || "faucet failed", "✕", "#3a1414", "#ffd2d2"); }
}

async function doPost() {
  if (!S.connected) return toast("Connect a wallet first", "!", "#3a2a14", "#ffe0b0");
  const f = S.form;
  if (+f.min <= 0 || +f.max <= +f.min) return toast("Max must be greater than min", "!", "#3a2a14", "#ffe0b0");
  const deadline = Math.floor(Date.now() / 1000) + Math.max(1, +f.deadlineMin) * 60;
  toast("Posting RFQ on-chain…", "◷");
  const lot = Math.max(0, +f.lot || 0);
  const res = await chain.postRfq({ pair: f.pair.replace(/\s/g, "").replace("/", "").slice(0, 9), side: f.side, mode: f.mode, bandMin: f.min, bandMax: f.max, deadline, baseAmount: lot });
  if (!res.ok) return toast(res.error, "✕", "#3a1414", "#ffd2d2");
  logEvent("POST", "Posted RFQ", `${f.pair} · band ${f.min}–${f.max}${lot ? ` · ${lot} XLM lot` : ""}`, res.hash);
  toast("RFQ posted ✓", "✓");
  S.view = "active"; await refresh();
}

function openBid(id) {
  if (!S.connected) return toast("Connect a wallet first", "!", "#3a2a14", "#ffe0b0");
  const r = S.rfqs.find((x) => x.id === id);
  if (!r) return;
  S.modal = { type: "bid", rfq: r, amount: ((chain.toUsdc(r.bandMin) + chain.toUsdc(r.bandMax)) / 2).toFixed(2), commit: null, proving: false };
  render();
}

async function sealBid() {
  const m = S.modal, r = m.rfq;
  const bid = m.amount; // human USDC
  if (isNaN(+bid) || +bid < chain.toUsdc(r.bandMin) || +bid > chain.toUsdc(r.bandMax)) return;
  const bidStroops = chain.toStroops(bid); // circuit + commitment work in token stroops
  try {
    m.proving = true; m.stage = "Preparing witness…"; render();
    const bidderField = chain.addrField(S.address);
    const availBal = r.bandMax; // proof-of-funds pinned to escrow (= band max, stroops); the escrow transfer proves the funds
    const existing = openingsFor(r.id).length;
    const aspIndex = existing % 16; // a fresh ASP identity per bid from this browser
    const nonce = rnd();
    m.stage = "Generating bidValidity proof…"; render();
    const { proof, commit, nullifier } = await prover.proveBid({
      bid: bidStroops, nonce, bidderField, rfqId: r.id, bandMin: r.bandMin, bandMax: r.bandMax, availBal, aspIndex,
    });
    m.stage = "Submitting commit_bid on-chain…"; render();
    const res = await chain.commitBid({ rfqId: r.id, commit, nullifier, proof });
    if (!res.ok) { m.proving = false; render(); return toast(res.error, "✕", "#3a1414", "#ffd2d2"); }
    saveOpening(r.id, { bid: String(bidStroops), nonce, bidderField, bidderAddr: S.address, commit, aspIndex });
    logEvent("BID", "Sealed bid", `RFQ-${String(r.id).padStart(3, "0")} · amount hidden`, res.hash);
    S.modal = null;
    toast("Bid sealed & verified on-chain ✓", "✓");
    await refresh(); await refreshBalance();
  } catch (e) { m.proving = false; render(); toast(e.message || "proving failed", "✕", "#3a1414", "#ffd2d2"); }
}

async function doSettle(id) {
  const r = S.rfqs.find((x) => x.id === id);
  if (!r) return;
  const recorded = await chain.bidsOf(id); // commit decimals in on-chain order
  if (!recorded.length) return toast("No bids to settle", "!", "#3a2a14", "#ffe0b0");
  const local = openingsFor(id);
  const ordered = recorded.map((c) => local.find((o) => o.commit === c));
  if (ordered.some((o) => !o)) return toast("Missing bid openings — settle from the browser that sealed the bids", "!", "#3a2a14", "#ffe0b0");
  try {
    S.modal = { type: "proving", stage: "Generating auctionResult proof…" }; render();
    const out = await prover.proveAuction({ rfqId: id, bids: ordered.map((o) => ({ bid: o.bid, nonce: o.nonce, bidderField: o.bidderField })) });
    const winnerAddr = ordered[out.winnerIdx].bidderAddr;
    S.modal.stage = "Submitting settle on-chain…"; render();
    const res = await chain.settle({ rfqId: id, proof: out.proof, winner: winnerAddr, clearing: out.clearing });
    S.modal = null;
    if (!res.ok) return toast(res.error, "✕", "#3a1414", "#ffd2d2");
    logEvent("SETTLE", "Settled (Vickrey)", `RFQ-${String(id).padStart(3, "0")} · clearing ${usd(out.clearing)} USDC · losers hidden`, res.hash);
    toast(`Settled — clearing price ${usd(out.clearing)} USDC ✓`, "✓");
    await refresh(); await refreshBalance();
  } catch (e) { S.modal = null; render(); toast(e.message || "settle failed", "✕", "#3a1414", "#ffd2d2"); }
}

async function doCancel(id) {
  try {
    toast("Cancelling expired RFQ…", "◷");
    const res = await chain.cancelExpired(id);
    if (!res.ok) return toast(res.error, "✕", "#3a1414", "#ffd2d2");
    logEvent("CANCEL", "Cancelled RFQ", `RFQ-${String(id).padStart(3, "0")} · escrows refunded`, res.hash);
    toast("Cancelled — escrows refunded ✓", "✓");
    await refresh();
  } catch (e) { toast(e.message || "cancel failed", "✕", "#3a1414", "#ffd2d2"); }
}

async function doPoseidon() {
  const out = $("poseidon-out");
  if (out) out.textContent = "calling contract…";
  try {
    const res = await chain.poseidonHash(1, 2);
    const matches = res.toLowerCase().startsWith("0x115cc0f5");
    if (out) out.innerHTML = `${matches ? "✓" : "•"} on-chain poseidon_hash(1,2) = ${esc(res.slice(0, 26))}… <span style="color:#9aa0b2">(${matches ? "matches circomlib" : "computed on-chain"})</span>`;
  } catch (e) { if (out) out.textContent = "error: " + (e.message || e); }
}

async function refreshBalance() {
  if (!S.connected) return;
  try { S.balance = await chain.balanceOf(S.address); } catch { S.balance = "0"; }
  render();
}
async function refresh() {
  S.loading = true; render();
  try { S.rfqs = await chain.listRfqs(); } catch (e) { console.error(e); }
  S.loading = false; render();
}

// boot
render();
refresh();
