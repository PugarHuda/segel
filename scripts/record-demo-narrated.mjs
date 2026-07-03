// Record a NARRATED walkthrough of Segel with a natural English voice-over.
// Pipeline: (1) edge-tts generates one neural-voice mp3 per beat, (2) we drive the
// real desk in Chrome grabbing frames, each beat dwelling >= its narration length,
// (3) build one audio track that partitions the timeline exactly, (4) ffmpeg muxes
// audio+frames -> mp4. The VO lines are the honest ones from docs/DEMO_SCRIPT.md.
//
//   node scripts/record-demo-narrated.mjs        (VOICE=en-US-AndrewNeural default)
//
// ponytail: sequential-beat audio (each seg = clip + silence to fill the beat's wall
// time) instead of per-clip adelay/amix — beats are sequential so a concat lines up.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const FFMPEG = process.env.FFMPEG || "C:\\Hackathons\\Hackathon Stellar Real World ZK\\tools\\bin\\ffmpeg.exe";
const VOICE = process.env.VOICE || "en-US-AndrewNeural"; // warm, natural US male
const TMP = process.env.TEMP + "\\segel-narrated";
const FRAMES = TMP + "\\frames";
const AUD = TMP + "\\audio";
const OUT = "frontend/segel-demo-narrated.mp4";
const PORT = 8132;
const base = `http://localhost:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the walkthrough: one VO line + the on-screen action it plays over ───────────
// `do(page,h)` gets the puppeteer page + a helpers object; keep actions using the
// same stable data-* selectors the silent recorder uses (text labels drift).
const BEATS = [
  { t: "This is Segel — a confidential, sealed-bid OTC desk on Stellar. A ten-million-dollar block trade leaks the moment its bids are visible, so the market front-runs you.",
    do: async (p, h) => { await h.scroll(720); } },
  { t: "Segel runs that auction on-chain. Every bid is sealed, the fair clearing price is proven in zero-knowledge, and the losing bids are never revealed — not to the public, not to rival desks.",
    do: async (p, h) => { await h.scroll(1600); await h.scroll(2400); } },
  { t: "Here is the live desk. These RFQs are read straight from a Soroban contract. The size bands are public, but the bid amounts are encrypted.",
    do: async (p, h) => { await h.desk(); } },
  { t: "I'll connect — Freighter, or a no-install demo key for this walkthrough.",
    do: async (p, h) => { await h.clk('[data-act="connect"]'); await wait(1100); await h.clk('[data-act="conn:demo"]');
      await p.waitForFunction(() => /USDC/.test(document.body.innerText), { timeout: 20000 }).catch(() => {}); } },
  { t: "Anyone can post an RFQ. Make it a directed Direct-OTC, and only one invited address is allowed to bid — enforced on-chain, in the contract, not just in the interface.",
    do: async (p, h) => { await h.clk('[data-nav="create"]'); await wait(1200); await h.clk('[data-act="mode:0"]'); await wait(700);
      await p.evaluate(() => { const f = document.querySelector('[data-form="taker"]'); if (f) { f.scrollIntoView({ block: "center" }); f.value = "GA…the one invited counterparty"; f.style.outline = "2px solid #7585e4"; } }); } },
  { t: "Or leave it open to everyone and escrow a delivery lot, so settlement is a real two-asset delivery-versus-payment swap.",
    do: async (p, h) => { await h.clk('[data-act="mode:1"]'); await wait(700);
      await p.evaluate(() => { const f = document.querySelector('[data-form="lot"]'); if (f) f.scrollIntoView({ block: "center" }); }); } },
  { t: "Don't trust the interface — check the chain. The contract computes Poseidon on-chain, bit-for-bit identical to the circuit.",
    do: async (p, h) => { await h.clk('[data-nav="audit"]'); await wait(1200); await h.clk('[data-act="poseidon"]'); await wait(2000); } },
  { t: "Every one of these bids is an amount hidden behind a Poseidon commitment.",
    do: async (p, h) => { await h.clk('[data-nav="active"]'); await wait(1600); } },
  { t: "When I place a bid, my browser generates a zero-knowledge proof: that the bid is in band, that I hold the funds, that I'm on the K-Y-C allow-list, and that I haven't bid before — without ever revealing the amount.",
    do: async (p, h) => { await h.bid(); await wait(1500); } },
  { t: "I seal it. The proof is made in-browser, then a real commit-bid lands on-chain recording only the commitment. The amount never leaves my device.",
    do: async (p, h) => { await h.clk('[data-act="sealbid"]'); await wait(6500); } },
  { t: "At settlement, one auction proof shows the winner and the Vickrey second-highest price are correct — computed inside the circuit over exactly these sealed commitments. The winner pays, the lot is delivered, the losers are refunded. And the losing amounts are simply not there: not in storage, not in the calldata. Mathematically gone.",
    do: async (p, h) => { await wait(1500); } },
  { t: "But privacy isn't secrecy from a regulator. With selective disclosure, the winner here bid four-ninety but paid the Vickrey price of four-twenty — so four-ninety is not on the chain.",
    do: async (p, h) => { await h.clk('[data-nav="portfolio"]'); await wait(1500); await h.clk('[data-act="verifyopen"]'); await wait(1200);
      await p.evaluate(() => { const t = document.querySelector('[data-disc="input"]'); if (t) t.value = JSON.stringify({ rfqId: 13, bidder: "GBJSZAEYQW5GQVJV77KGBPIN246HALRBWZINOQXE7DZ4NNHRVCSZMHAQ", bid: 4.90, nonce: "123456888" }); }); } },
  { t: "Yet they can prove it to an auditor, against the on-chain commitment. Verified. Change a single digit, and it fails. Private, but provable.",
    do: async (p, h) => { await h.clk('[data-act="verifydisc"]'); await wait(3500); } },
  { t: "In the interest of honesty: the settler does see the openings to compute the result, like any auctioneer — Segel hides the losers from the chain and the public. And the oracle price-guard is a fat-finger check, not an anti-manipulation control. The proof is what binds the price.",
    do: async (p, h) => { await h.clk('[data-nav="audit"]'); await wait(2500); } },
  { t: "Two Circom Groth16 circuits, verified on-chain through Stellar's BN254 host functions. Real Circle USDC escrow, a Reflector oracle read at settlement, and an MCP server so an AI agent can read the outcome. Segel: bids sealed, settlement proven, losers never seen — real zero-knowledge, real money, on Stellar.",
    do: async (p, h) => { await wait(2500); } },
];

// ── 1) synth every VO line, measure its duration ────────────────────────────────
rmSync(TMP, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(AUD, { recursive: true });

const durOf = (file) => {
  const r = spawnSync(FFMPEG, ["-i", file], { encoding: "utf8" });
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(r.stderr || "");
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
};

console.log(`synthesizing ${BEATS.length} VO clips with ${VOICE}…`);
for (let i = 0; i < BEATS.length; i++) {
  const mp3 = `${AUD}\\clip${String(i).padStart(2, "0")}.mp3`;
  const r = spawnSync("python", ["-m", "edge_tts", "--voice", VOICE, "--text", BEATS[i].t, "--write-media", mp3], { encoding: "utf8" });
  if (r.status !== 0) { console.error("edge-tts failed:", r.stderr); process.exit(1); }
  BEATS[i].mp3 = mp3;
  BEATS[i].clipDur = durOf(mp3);
  process.stdout.write(`  clip ${i} ${BEATS[i].clipDur.toFixed(1)}s\n`);
}

// ── 2) drive the desk, capturing frames; each beat dwells >= its narration ──────
const srv = spawn(process.execPath, ["frontend/serve.mjs", String(PORT)], { stdio: "ignore" });
await wait(800);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  defaultViewport: { width: 1280, height: 800 }, args: ["--no-sandbox"],
});
const page = await browser.newPage();

// caption overlay (kept — a spoken line + on-screen subtitle reads best)
await page.evaluateOnNewDocument(() => {
  function ensure() {
    if (document.getElementById("democap")) return;
    const d = document.createElement("div");
    d.id = "democap";
    d.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:linear-gradient(180deg,rgba(11,11,14,0),rgba(11,11,14,.93) 45%);color:#fff;padding:34px 44px 24px;font:600 22px/1.45 'Segoe UI',-apple-system,Roboto,sans-serif;text-align:center;pointer-events:none;text-shadow:0 2px 10px rgba(0,0,0,.6)";
    (document.body || document.documentElement).appendChild(d);
  }
  window.__cap = (t) => { ensure(); const d = document.getElementById("democap"); if (d) d.textContent = t || ""; };
  if (document.readyState !== "loading") ensure(); else document.addEventListener("DOMContentLoaded", ensure);
});
const cap = (t) => page.evaluate((x) => window.__cap && window.__cap(x), t).catch(() => {});
const clk = (sel) => page.click(sel).catch(() => {});
const helpers = {
  clk,
  scroll: async (to, steps = 26) => { for (let i = 1; i <= steps; i++) { await page.evaluate((y) => window.scrollTo(0, y), (to * i) / steps); await wait(45); } },
  desk: async () => {
    await page.goto(base + "/app.html", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => !/loading live RFQs/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
  },
  bid: async () => page.evaluate(() => {
    const btns = [...document.querySelectorAll('[data-act^="bid:"]')];
    const dvps = btns.filter((b) => b.closest(".rfq-grid")?.querySelector('[title*="delivery leg"]'));
    const el = dvps[dvps.length - 1] || btns[btns.length - 1];
    if (el) { el.scrollIntoView({ block: "center" }); el.click(); return true; } return false;
  }),
};

let n = 0, recording = true;
async function grab() {
  while (recording) {
    const s = Date.now();
    try { await page.screenshot({ path: `${FRAMES}\\f${String(n).padStart(5, "0")}.png` }); n++; } catch (_) {}
    await wait(Math.max(0, 110 - (Date.now() - s))); // ~9 fps
  }
}

const starts = []; // ms-from-grab-start of each beat, for exact audio placement
let tGrab = 0, tEnd = 0;
try {
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await wait(1200);
  const grabber = grab();
  tGrab = Date.now();

  for (const b of BEATS) {
    starts.push(Date.now() - tGrab);
    const t0 = Date.now();
    await cap(b.t);
    try { await b.do(page, helpers); } catch (e) { console.error("beat warn:", e.message); }
    const minMs = b.clipDur * 1000 + 550;           // narration + a short breath
    const spent = Date.now() - t0;
    if (spent < minMs) await wait(minMs - spent);
  }
  tEnd = Date.now() - tGrab;
  recording = false; await grabber;
} catch (e) {
  recording = false; console.error("record error:", e.message);
} finally {
  await browser.close();
  srv.kill();
}

// ── 3) build one narration track that partitions the timeline exactly ───────────
// seg i spans [starts[i], starts[i+1]); pad each clip with trailing silence to fill
// its beat, prepend the lead-in silence before beat 0. Concat -> narration.wav.
const bounds = [...starts, tEnd];
const segList = [];
for (let i = 0; i < BEATS.length; i++) {
  const segMs = bounds[i + 1] - bounds[i];
  const seg = `${AUD}\\seg${String(i).padStart(2, "0")}.wav`;
  const lead = i === 0 ? bounds[0] : 0; // silence before the first spoken word
  spawnSync(FFMPEG, ["-y", "-i", BEATS[i].mp3,
    "-af", `adelay=${lead}|${lead},apad,atrim=0:${(segMs / 1000).toFixed(3)}`,
    "-ar", "44100", "-ac", "2", seg], { stdio: "ignore" });
  segList.push(`file '${seg.replace(/\\/g, "/")}'`);
}
const listFile = `${AUD}\\concat.txt`;
writeFileSync(listFile, segList.join("\n"));
const narration = `${AUD}\\narration.wav`;
spawnSync(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", narration], { stdio: "ignore" });

// ── 4) mux frames + narration -> mp4 ────────────────────────────────────────────
const count = readdirSync(FRAMES).filter((f) => f.endsWith(".png")).length;
const fps = Math.max(2, Math.min(12, +(count / (tEnd / 1000)).toFixed(2)));
console.log(`captured ${count} frames over ${(tEnd / 1000).toFixed(1)}s -> ${fps} fps; muxing narration…`);
const r = spawnSync(FFMPEG, ["-y",
  "-framerate", String(fps), "-i", `${FRAMES}\\f%05d.png`,
  "-i", narration,
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=1280:-2",
  "-c:a", "aac", "-b:a", "160k", "-shortest", OUT], { stdio: "ignore" });
console.log(r.status === 0 ? `✅ wrote ${OUT}` : "❌ ffmpeg mux failed: " + r.status);
process.exit(r.status === 0 ? 0 : 1);
