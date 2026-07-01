// Deep frontend QA — validate that REAL zero-knowledge proving works IN THE
// BROWSER. Loads the desk in headless Chrome, then (in page context) imports the
// app's own prover.js, generates a bidValidity proof with snarkjs/WASM, and
// verifies it against the verification key — entirely in the browser. This is the
// browser-specific risk (esm.sh modules + WASM proving in Chrome); the proof ->
// on-chain verify path is already covered by scripts/e2e-testnet.mjs.
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 8124;
const base = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ["frontend/serve.mjs", String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let fail = 0;
const ok = (c, m) => { console.log(c ? "  ✓ " + m : "  ✗ " + m); if (!c) fail++; };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|404/i.test(m.text())) errs.push(m.text()); });
  // domcontentloaded, not networkidle2: esm.sh keeps the network "busy" past the
  // timeout (flaky); the explicit waitForFunction calls below are the real readiness signal.
  await page.goto(base + "/app.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  // wait for the app to actually render (modules load from esm.sh, then render()),
  // then for the live RFQ read to settle — avoids a flaky check before first paint.
  await page.waitForFunction(() => /Active RFQs/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
  await page.waitForFunction(() => !/loading live RFQs/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
  ok(await page.evaluate(() => document.body.innerText.includes("Active RFQs")), "desk renders + reads live RFQs from testnet");

  console.log("    …generating a bidValidity proof in the browser (snarkjs/WASM)…");
  const res = await page.evaluate(async () => {
    const prover = await import("./prover.js");
    const chain = await import("./stellar.js");
    const snarkjs = await import("https://esm.sh/snarkjs@0.7.5");
    const t0 = performance.now();
    const bidderField = chain.addrField(chain.DEMO_ADDRESS);
    const out = await prover.proveBid({
      bid: 4200, nonce: "12345", bidderField, rfqId: 0,
      bandMin: 3000, bandMax: 5000, availBal: 5000, aspIndex: 1,
    });
    const ms = Math.round(performance.now() - t0);
    const vk = await (await fetch("./circuit/bidValidity_vk.json")).json();
    const verified = await snarkjs.groth16.verify(vk, out.publicSignals, out.rawProof);
    return { ms, verified, commit: out.commit, nPub: out.publicSignals.length,
             hasProof: !!(out.proof && out.proof.a && out.proof.b && out.proof.c) };
  });
  ok(res.hasProof, `proof generated in-browser (${res.ms}ms) with a/b/c components`);
  ok(res.nPub === 8, "8 public signals");
  ok(res.verified === true, "in-browser proof verifies against the verification key");

  console.log("    …generating an auctionResult proof in the browser…");
  const res2 = await page.evaluate(async () => {
    const prover = await import("./prover.js");
    const chain = await import("./stellar.js");
    const snarkjs = await import("https://esm.sh/snarkjs@0.7.5");
    const bf = chain.addrField(chain.DEMO_ADDRESS);
    const bids = [
      { bid: 4200, nonce: "11", bidderField: bf },
      { bid: 4900, nonce: "22", bidderField: bf },
      { bid: 3800, nonce: "33", bidderField: bf },
    ];
    const out = await prover.proveAuction({ rfqId: 0, bids });
    const vk = await (await fetch("./circuit/auctionResult_vk.json")).json();
    const verified = await snarkjs.groth16.verify(vk, out.publicSignals, out.rawProof);
    return { verified, clearing: out.clearingPrice, nPub: out.publicSignals.length };
  });
  ok(res2.verified === true, "in-browser auctionResult proof verifies");
  ok(res2.clearing === "4200", `Vickrey clearing computed in-browser = ${res2.clearing} (second-highest)`);

  if (errs.length) errs.slice(0, 4).forEach((e) => console.log("    error:", String(e).slice(0, 160)));
  ok(errs.length === 0, "no uncaught errors / console errors during proving");
} catch (e) {
  console.log("  ✗ exception:", e.message); fail++;
} finally {
  await browser.close();
  srv.kill();
}
console.log(fail ? `\n❌ ${fail} check(s) failed` : "\n✅ browser ZK proving e2e passed");
process.exit(fail ? 1 : 0);
