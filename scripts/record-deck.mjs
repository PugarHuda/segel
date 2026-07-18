// Record the narrated PITCH video: the /deck slides explained with a natural English
// voice-over + subtitles, then spliced onto the existing live-desk demo so judges get
// one file: "here's the idea" → "here it is actually working on-chain".
//
//   npm run demo:pitch            -> frontend/segel-pitch.mp4 (deck + live demo)
//   DECK_ONLY=1 npm run demo:pitch -> frontend/segel-deck.mp4 only
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { synth, buildTrack, mux, joinClips, wait } from "./narrate-lib.mjs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const VOICE = process.env.VOICE || "en-US-AndrewNeural";
const TMP = process.env.TEMP + "\\segel-deck-rec";
const FRAMES = TMP + "\\frames", AUD = TMP + "\\audio";
const DECK_OUT = "frontend/segel-deck.mp4";
const DEMO = "frontend/segel-demo-narrated.mp4";
const PITCH_OUT = "frontend/segel-pitch.mp4";
const PORT = 8133, base = `http://localhost:${PORT}`;

// One beat per slide. Slide n is shown while its line is spoken; the last line hands
// off to the live-demo footage that gets spliced on after.
const BEATS = [
  { t: "This is Segel — a sealed-bid OTC desk on Stellar, where bids are sealed, the clearing price is proven in zero-knowledge, and the losing bids are never revealed. Look at the ledger: the commitments are public and binding, but those losing amounts were never written to the chain at all." },
  { t: "Here's why that matters. OTC desks leak. The moment a block trade's bids are visible, the market front-runs you. So today you either reveal every bid on a public order book, or you trust a broker to pick the winner and the price honestly. There was no third option." },
  { t: "Segel is that third option. Bids are sealed behind Poseidon commitments. The fair Vickrey second-price clearing price is proven in zero-knowledge. Losing amounts stay hidden forever — and it settles in real Circle USDC as a two-asset delivery-versus-payment swap." },
  { t: "The zero-knowledge here is load-bearing. Two Circom Groth16 circuits, verified on-chain by deployed Soroban contracts using Stellar's BN254 host functions. bidValidity proves the bid is in band, funded, on the allow-list, and not a duplicate — without revealing the amount. auctionResult proves the winner and the Vickrey price. Remove either one and the product cannot exist." },
  { t: "And we don't ask you to take that on faith. One command: a real proof verifies on the live deployed verifier. Flip a single input, and that same proof is rejected on-chain. A false statement has no valid proof." },
  { t: "The flow is four on-chain steps. A maker posts an RFQ. Bidders seal a bid, proven inside their own browser. One settle proof reveals only the winner and the clearing price. Then payment, delivery, and refunds happen atomically." },
  { t: "It is deployed and verifiable on Stellar testnet right now — the desk plus both verifier contracts, escrowing Circle's real testnet USDC, with a Reflector oracle read at settlement." },
  { t: "The Stellar primitives are load-bearing, not name-checked: BN254 host functions, Soroban escrow custody, on-chain Poseidon that is bit-identical to the circuit, real USDC, delivery-versus-payment, and directed OTC enforced by the contract itself." },
  { t: "And the honest limits, stated plainly rather than buried. The settler does see the openings to compute the result, like any auctioneer. The oracle guard is a fat-finger check, not an anti-manipulation control. The demo allow-list is test secrets, not real KYC. But nothing load-bearing is mocked." },
  { t: "Bids sealed. Settlement proven. Losers never seen. Now let's look at the real desk, running live on Stellar." },
];

rmSync(TMP, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(AUD, { recursive: true });
synth(BEATS, VOICE, AUD);

const srv = spawn(process.execPath, ["frontend/serve.mjs", String(PORT)], { stdio: "ignore" });
await wait(800);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  defaultViewport: { width: 1280, height: 800 }, args: ["--no-sandbox"],
});
const page = await browser.newPage();

// subtitle band + hide the deck's own on-screen paging affordances during capture
await page.evaluateOnNewDocument(() => {
  const css = document.createElement("style");
  css.textContent = `.pager,.hint{display:none!important}
    #democap{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;
      background:linear-gradient(180deg,rgba(8,8,12,0),rgba(8,8,12,.94) 45%);color:#fff;
      padding:30px 44px 22px;font:600 21px/1.45 'Segoe UI',-apple-system,Roboto,sans-serif;
      text-align:center;pointer-events:none;text-shadow:0 2px 10px rgba(0,0,0,.65)}`;
  const add = () => {
    (document.head || document.documentElement).appendChild(css);
    if (!document.getElementById("democap")) {
      const d = document.createElement("div");
      d.id = "democap";
      (document.body || document.documentElement).appendChild(d);
    }
  };
  window.__cap = (t) => { const d = document.getElementById("democap"); if (d) d.textContent = t || ""; };
  if (document.readyState !== "loading") add(); else document.addEventListener("DOMContentLoaded", add);
});
const cap = (t) => page.evaluate((x) => window.__cap && window.__cap(x), t).catch(() => {});

let n = 0, recording = true;
async function grab() {
  while (recording) {
    const s = Date.now();
    try { await page.screenshot({ path: `${FRAMES}\\f${String(n).padStart(5, "0")}.png` }); n++; } catch (_) {}
    await wait(Math.max(0, 110 - (Date.now() - s)));
  }
}

const starts = [];
let tEnd = 0;
try {
  await page.goto(base + "/deck", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await wait(900);
  const grabber = grab();
  const t0 = Date.now();

  // The deck's slide 10 (index 9) is the embedded demo video — skip it in the narrated
  // pitch, since the live-demo footage is spliced on right after. One beat per remaining slide.
  const SLIDE_OF = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10];
  for (let i = 0; i < BEATS.length; i++) {
    starts.push(Date.now() - t0);
    const bStart = Date.now();
    await page.evaluate((n) => window.__deckGo && window.__deckGo(n), SLIDE_OF[i]); // slide
    await wait(650); // let the smooth scroll land before the line starts
    await cap(BEATS[i].t);
    const minMs = BEATS[i].clipDur * 1000 + 600;
    const spent = Date.now() - bStart;
    if (spent < minMs) await wait(minMs - spent);
  }
  tEnd = Date.now() - t0;
  recording = false; await grabber;
} catch (e) {
  recording = false; console.error("record error:", e.message);
} finally {
  await browser.close();
  srv.kill();
}

const count = readdirSync(FRAMES).filter((f) => f.endsWith(".png")).length;
const fps = Math.max(2, Math.min(12, +(count / (tEnd / 1000)).toFixed(2)));
console.log(`captured ${count} frames over ${(tEnd / 1000).toFixed(1)}s -> ${fps} fps; muxing narration…`);
const narration = buildTrack(BEATS, starts, tEnd, AUD);
if (!mux(FRAMES, narration, DECK_OUT, fps)) { console.error("❌ deck mux failed"); process.exit(1); }
console.log(`✅ wrote ${DECK_OUT}`);

if (process.env.DECK_ONLY) process.exit(0);
if (!existsSync(DEMO)) {
  console.error(`⚠ ${DEMO} not found — run 'npm run demo:narrated' first to splice the live demo on.`);
  process.exit(1);
}
console.log("splicing deck + live demo…");
console.log(joinClips([DECK_OUT, DEMO], PITCH_OUT, 8) ? `✅ wrote ${PITCH_OUT}` : "❌ splice failed");
