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
  await wait(2200);
  await smoothScroll(page, 720); await wait(1600);
  await smoothScroll(page, 1500); await wait(2000);
  await smoothScroll(page, 2350); await wait(2000);
  await smoothScroll(page, 3200); await wait(1800);
  await page.evaluate(() => window.scrollTo(0, 0)); await wait(900);

  // DESK
  await page.goto(base + "/app.html", { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForFunction(() => !/loading live RFQs/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
  // stable attribute selectors (text labels drift; these don't)
  const clk = (sel) => page.click(sel).catch(() => {});
  await wait(2200);
  await clk('[data-act="connect"]'); await wait(1200);
  await clk('[data-act="conn:demo"]');
  await page.waitForFunction(() => /USDC/.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
  await wait(2000);
  // CREATE — show the DvP lot field by filling the form
  await clk('[data-nav="create"]'); await wait(1800);
  await clk('[data-act="mode:0"]'); await wait(1300);
  await clk('[data-act="mode:1"]'); await wait(1300);
  await page.evaluate(() => { const f = document.querySelector('[data-form="lot"]'); if (f) { f.scrollIntoView({ block: "center" }); } }); await wait(1600);
  await clk('[data-nav="docs"]'); await wait(2600);
  await clk('[data-nav="audit"]'); await wait(1600);
  await clk('[data-act="poseidon"]'); await wait(3000);
  await clk('[data-nav="active"]'); await wait(2400); // dwell on the DvP lot chips
  // bid on a DvP RFQ (its row carries the delivery-leg chip) so the modal shows the
  // "you receive N XLM" banner; prefer a fresh-nullifier one
  const bid = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[data-act^="bid:"]')];
    const dvps = btns.filter((b) => b.closest(".rfq-grid")?.querySelector('[title*="delivery leg"]'));
    const el = dvps[dvps.length - 1] || btns[btns.length - 1]; // newest DvP = freshest nullifier
    if (el) { el.scrollIntoView({ block: "center" }); el.click(); return true; } return false;
  });
  if (bid) {
    await wait(2600); // dwell on the bid modal + DvP delivery banner
    await clk('[data-act="sealbid"]');
    await wait(7000); // in-browser proving spinner + result toast
  }
  await wait(1200);

  // SELECTIVE DISCLOSURE beat — an auditor verifies a HIDDEN winner bid (4.90 USDC,
  // never on-chain since Vickrey pays the second price) against the on-chain commitment.
  await clk('[data-nav="portfolio"]'); await wait(1800);
  await clk('[data-act="verifyopen"]'); await wait(1600);
  await page.evaluate(() => {
    const t = document.querySelector('[data-disc="input"]');
    if (t) t.value = JSON.stringify({ rfqId: 13, bidder: "GBJSZAEYQW5GQVJV77KGBPIN246HALRBWZINOQXE7DZ4NNHRVCSZMHAQ", bid: 4.90, nonce: "123456888" });
  });
  await wait(1300);
  await clk('[data-act="verifydisc"]'); await wait(4500); // verify on-chain -> "Verified: … bid 4.90 USDC"
  await wait(1500);

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
