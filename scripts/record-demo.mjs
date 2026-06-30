// Record an automated screen-capture walkthrough of Segel (silent — the hackathon
// allows a no-narration walkthrough). Grabs PNG frames at ~5fps while driving the
// real desk in Chrome, then assembles them into an mp4 with ffmpeg.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, readdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
// ffmpeg ships in V1's tools/bin; override with FFMPEG=... if it lives elsewhere.
const FFMPEG = process.env.FFMPEG || "C:\\Hackathons\\Hackathon Stellar Real World ZK\\tools\\bin\\ffmpeg.exe";
const FRAMES = process.env.TEMP + "\\segel-demo-frames";
const OUT = "frontend/segel-demo.mp4";
const PORT = 8131;
const base = `http://localhost:${PORT}`;

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
const srv = spawn(process.execPath, ["frontend/serve.mjs", String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = (page, sel, text) => page.evaluate((sel, text) => {
  const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text));
  if (el) { el.scrollIntoView({ block: "center" }); el.click(); return true; } return false;
}, sel, text);
const smoothScroll = async (page, to, steps = 28) => {
  for (let i = 1; i <= steps; i++) { await page.evaluate((y) => window.scrollTo(0, y), (to * i) / steps); await wait(45); }
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  defaultViewport: { width: 1280, height: 800 }, args: ["--no-sandbox"],
});
const page = await browser.newPage();

// Burned-in caption overlay so the silent walkthrough explains itself (no voice needed).
// Injected on every document (survives navigations) and captured in each screenshot.
await page.evaluateOnNewDocument(() => {
  function ensure() {
    if (document.getElementById("democap")) return;
    const d = document.createElement("div");
    d.id = "democap";
    d.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:linear-gradient(180deg,rgba(11,11,14,0),rgba(11,11,14,.93) 45%);color:#fff;padding:34px 44px 24px;font:600 23px/1.45 'Segoe UI',-apple-system,Roboto,sans-serif;text-align:center;pointer-events:none;text-shadow:0 2px 10px rgba(0,0,0,.6);transition:opacity .25s";
    (document.body || document.documentElement).appendChild(d);
  }
  window.__cap = (t) => { ensure(); const d = document.getElementById("democap"); if (d) d.innerHTML = t || ""; };
  if (document.readyState !== "loading") ensure(); else document.addEventListener("DOMContentLoaded", ensure);
});
const cap = (t) => page.evaluate((x) => window.__cap && window.__cap(x), t).catch(() => {});

let n = 0, recording = true, t0 = 0;
async function grab() {
  t0 = Date.now();
  while (recording) {
    const s = Date.now();
    try { await page.screenshot({ path: `${FRAMES}\\f${String(n).padStart(5, "0")}.png` }); n++; }
    catch (_) {}
    const dt = Date.now() - s;
    await wait(Math.max(0, 110 - dt)); // aim ~8–9 fps
  }
}

try {
  await page.goto(base + "/", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(300);
  const grabber = grab();

  // LANDING tour
  await cap("Segel — a confidential sealed-bid OTC desk on Stellar");
  await wait(2200);
  await cap("OTC desks leak: when bids are visible, the market front-runs you"); await smoothScroll(page, 720); await wait(1800);
  await cap("Bids sealed · the fair Vickrey price proven in zero-knowledge"); await smoothScroll(page, 1500); await wait(2000);
  await cap("Losing bids are never revealed — on-chain, to the public, or to rivals"); await smoothScroll(page, 2350); await wait(2000);
  await smoothScroll(page, 3200); await wait(1600);
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(800);

  // DESK
  await page.goto(base + "/app.html", { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForFunction(() => !/loading live RFQs/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
  // stable attribute selectors (text labels drift; these don't)
  const clk = (sel) => page.click(sel).catch(() => {});
  await cap("Live RFQs read from the Soroban contract — bands public, bid amounts encrypted"); await wait(2400);
  await cap("Connect Freighter — or a no-install demo key");
  await clk('[data-act="connect"]'); await wait(1300);
  await clk('[data-act="conn:demo"]');
  await page.waitForFunction(() => /USDC/.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
  await wait(1800);
  // CREATE — open auction vs directed Direct-OTC
  await cap("Post an RFQ — a multi-bidder auction, or a directed Direct-OTC"); await clk('[data-nav="create"]'); await wait(1800);
  await cap("Direct OTC: invite ONE counterparty — only they may bid (enforced on-chain)");
  await clk('[data-act="mode:0"]'); await wait(900);
  await page.evaluate(() => { const f = document.querySelector('[data-form="taker"]'); if (f) { f.scrollIntoView({ block: "center" }); f.value = "GA…the invited counterparty"; f.style.outline = "2px solid #7585e4"; } }); await wait(2200);
  await cap("…or leave it open to anyone, and escrow a delivery lot (two-asset DvP)");
  await clk('[data-act="mode:1"]'); await wait(900);
  await page.evaluate(() => { const f = document.querySelector('[data-form="lot"]'); if (f) f.scrollIntoView({ block: "center" }); }); await wait(1600);
  await cap("Don't trust the deck — check the chain. On-chain Poseidon, bit-identical to the circuit");
  await clk('[data-nav="audit"]'); await wait(1500);
  await clk('[data-act="poseidon"]'); await wait(3000);
  await cap("Sealed bids — each amount hidden behind a Poseidon commitment"); await clk('[data-nav="active"]'); await wait(2400); // dwell on the DvP lot chips
  // bid on a DvP RFQ (its row carries the delivery-leg chip) so the modal shows the
  // "you receive N XLM" banner; prefer a fresh-nullifier one
  const bid = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[data-act^="bid:"]')];
    const dvps = btns.filter((b) => b.closest(".rfq-grid")?.querySelector('[title*="delivery leg"]'));
    const el = dvps[dvps.length - 1] || btns[btns.length - 1]; // newest DvP = freshest nullifier
    if (el) { el.scrollIntoView({ block: "center" }); el.click(); return true; } return false;
  });
  if (bid) {
    await cap("Your bid is proven in zero-knowledge in your browser — the amount never leaves your device");
    await wait(2800); // dwell on the bid modal + DvP delivery banner
    await clk('[data-act="sealbid"]');
    await cap("Proving in-browser… then a real commit_bid on-chain — only the commitment is recorded");
    await wait(7000); // in-browser proving spinner + result toast
  }
  await wait(1000);

  // SELECTIVE DISCLOSURE beat — an auditor verifies a HIDDEN winner bid (4.90 USDC,
  // never on-chain since Vickrey pays the second price) against the on-chain commitment.
  await cap("Compliance, not leakage: selective disclosure"); await clk('[data-nav="portfolio"]'); await wait(1800);
  await clk('[data-act="verifyopen"]'); await wait(1600);
  await page.evaluate(() => {
    const t = document.querySelector('[data-disc="input"]');
    if (t) t.value = JSON.stringify({ rfqId: 13, bidder: "GBJSZAEYQW5GQVJV77KGBPIN246HALRBWZINOQXE7DZ4NNHRVCSZMHAQ", bid: 4.90, nonce: "123456888" });
  });
  await cap("The winner bid 4.90 but paid the Vickrey price of 4.20 — 4.90 is NOT on-chain…");
  await wait(1600);
  await clk('[data-act="verifydisc"]');
  await cap("…yet they can prove it to an auditor, against the on-chain commitment. Verified ✓"); await wait(4800);
  await cap("Bids sealed · settlement proven · losers never seen — real ZK, real USDC, real delivery, on Stellar");
  await wait(2600);

  recording = false; await grabber;
} catch (e) {
  recording = false; console.error("record warning:", e.message);
} finally {
  await browser.close();
  srv.kill();
}

const elapsed = (Date.now() - t0) / 1000;
const count = readdirSync(FRAMES).length;
const fps = Math.max(2, Math.min(12, +(count / elapsed).toFixed(2)));
console.log(`captured ${count} frames over ${elapsed.toFixed(1)}s -> ${fps} fps; encoding…`);
const r = spawnSync(FFMPEG, ["-y", "-framerate", String(fps), "-i", `${FRAMES}\\f%05d.png`,
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=1280:-2", OUT], { stdio: "ignore" });
console.log(r.status === 0 ? `✅ wrote ${OUT}` : "❌ ffmpeg failed: " + r.status);
process.exit(r.status === 0 ? 0 : 1);
