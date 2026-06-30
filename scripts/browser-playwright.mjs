// End-to-end UI test with REAL user clicks (Playwright). Drives the actual desk
// like a person would: navigates every view, connects the embedded key, exercises
// the create-RFQ form + validation, opens the bid modal, runs the live Audit
// probes + on-chain Poseidon check — all by clicking, against the live testnet
// contract. The on-chain WRITE flow (post→bid→settle) is covered by
// scripts/e2e-testnet.mjs; set E2E_WRITE=1 to also post a real RFQ here.
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 8125;
const base = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ["frontend/serve.mjs", String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let fail = 0, n = 0;
const ok = (c, m) => { n++; console.log(c ? "  ✓ " + m : "  ✗ " + m); if (!c) fail++; };
const hasText = (page, re, t = 15000) =>
  page.waitForFunction((s) => new RegExp(s).test(document.body.innerText), re.source, { timeout: t }).then(() => true).catch(() => false);
const innerText = (page) => page.evaluate(() => document.body.innerText);

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const errs = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404|Failed to load resource/i.test(m.text())) errs.push(m.text()); });

  // ---- Case 1: boot + live RFQ read ----
  console.log("\n[1] boot");
  // domcontentloaded, not networkidle: the app pulls ESM deps from esm.sh which can
  // keep the network "busy" past the timeout (flaky); the explicit hasText wait below
  // is the real readiness signal.
  await page.goto(base + "/app.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await hasText(page, /Active RFQs/, 45000);
  await page.waitForFunction(() => !/loading live RFQs/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
  const boot = await innerText(page);
  ok(/Active RFQs/.test(boot), "desk renders 'Active RFQs'");
  ok(/\d+ live/.test(boot), `live RFQ count shown (${(boot.match(/(\d+) live/) || [])[1]} live)`);
  // money-logic self-check: USDC<->stroops round-trip must be exact
  const conv = await page.evaluate(async () => {
    const c = await import("./stellar.js");
    return { s: c.toStroops("4.20").toString(), u: c.toUsdc("50000000"), rt: c.toUsdc(c.toStroops("3.33")) };
  });
  ok(conv.s === "42000000" && conv.u === 5 && Math.abs(conv.rt - 3.33) < 1e-9, `USDC↔stroops exact (4.20→${conv.s}, 50000000→${conv.u})`);

  // ---- Case 2: navigate every view by clicking the sidebar ----
  console.log("[2] navigation (real clicks through every view)");
  const nav = [["create", /Create RFQ/], ["activity", /My Activity/], ["portfolio", /Portfolio/],
    ["audit", /Audit/], ["faucet", /Testnet Faucet/], ["docs", /How it works|Docs/], ["active", /Active RFQs/]];
  for (const [k, re] of nav) {
    await page.click(`[data-nav="${k}"]`);
    ok(await hasText(page, re, 8000), `nav → ${k} renders`);
  }

  // ---- Case 3: connect the embedded demo key (real balance read) ----
  console.log("[3] connect wallet");
  await page.click('[data-act="connect"]');
  ok(await hasText(page, /Choose a wallet/, 6000), "connect modal opens");
  await page.click('[data-act="conn:demo"]');
  ok(await hasText(page, /DEMO KEY/, 15000), "embedded key connected (wallet box shows DEMO KEY)");
  // wait for the async refreshBalance() to land a real (non-zero) funded balance
  await page.waitForFunction(() => { const m = (document.querySelector(".wbal")?.innerText || "").match(/[\d,]+/); return m && Number(m[0].replace(/,/g, "")) > 0; }, null, { timeout: 20000 }).catch(() => {});
  const bal = (await page.evaluate(() => document.querySelector(".wbal")?.innerText || "")).match(/[\d,]+/);
  ok(!!bal && Number(bal[0].replace(/,/g, "")) > 0, `funded balance shown from chain (${bal ? bal[0] : "?"})`);

  // ---- Case 4: create-RFQ form — mode/side toggles + validation ----
  console.log("[4] create form + validation");
  await page.click('[data-nav="create"]');
  await page.click('[data-act="mode:0"]');
  ok(/DIRECT OTC/.test(await innerText(page)), "mode toggle → Direct OTC selected");
  await page.click('[data-act="mode:1"]');
  ok(/RFQ AUCTION/.test(await innerText(page)), "mode toggle → RFQ Auction selected");
  await page.click('[data-act="side:BUY"]'); await page.click('[data-act="side:SELL"]'); // both toggle without error
  // negative case: max <= min must be rejected client-side
  await page.fill('[data-form="min"]', "5000");
  await page.fill('[data-form="max"]', "3000");
  await page.click('[data-act="post"]');
  ok(await hasText(page, /Max must be greater than min/, 5000), "invalid band (max≤min) rejected with toast");

  // ---- Case 5: bid modal opens on an open RFQ ----
  console.log("[5] bid modal");
  await page.click('[data-nav="active"]');
  await hasText(page, /Active RFQs/, 8000);
  const bidBtn = await page.$('[data-act^="bid:"]');
  if (bidBtn) {
    await bidBtn.click();
    ok(await hasText(page, /SEAL A BID/, 6000), "bid modal opens (Prove & seal)");
    const m = await innerText(page);
    ok(/Poseidon\(bid, nonce, addr\)/.test(m), "commitment scheme shown in modal");
    ok(/range proof will pass|in band/i.test(m), "default mid-band amount marked valid");
    ok(/3\.00|4\.00|5\.00/.test(m), "bid modal shows USDC band (e.g. 3.00–5.00)");
    await page.click('button[data-act="closemodal"]'); // the × button (backdrop div has same attr but is covered)
    await page.waitForFunction(() => !/SEAL A BID/.test(document.body.innerText), { timeout: 5000 }).catch(() => {});
    ok(!/SEAL A BID/.test(await innerText(page)), "modal closes");
  } else {
    ok(true, "no open RFQ to bid on (skipped) — none currently OPEN on-chain");
  }

  // ---- Case 6: Audit — live integration health + on-chain Poseidon (real reads via clicks) ----
  console.log("[6] audit: live probes + on-chain poseidon");
  await page.click('[data-nav="audit"]');
  await hasText(page, /INTEGRATION HEALTH/, 8000);
  // wait for the async health probe to FULLY resolve + render its ✓/✗ marks — the
  // probe's late render() rebuilds the DOM, so clicking poseidon before it lands
  // would get wiped. Wait for marks, then let the tree settle.
  await page.waitForFunction(() => /[✓✗]/.test(document.body.innerText) && !/checking/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(600);
  const health = await page.evaluate(() => {
    const t = document.body.innerText;
    return { ticks: (t.match(/✓/g) || []).length, crosses: (t.match(/✗/g) || []).length };
  });
  ok(health.crosses === 0 && health.ticks >= 6, `integration health all green (${health.ticks} ✓, ${health.crosses} ✗)`);
  // a late-resolving health render can wipe the output node, so retry the click
  // until the on-chain result lands (bounded).
  let posOk = false, posTxt = "(empty)";
  for (let i = 0; i < 4 && !posOk; i++) {
    await page.click('[data-act="poseidon"]').catch(() => {});
    posOk = await page.waitForFunction(() => /matches circomlib/.test(document.getElementById("poseidon-out")?.innerText || ""), null, { timeout: 12000 }).then(() => true).catch(() => false);
  }
  posTxt = await page.evaluate(() => document.getElementById("poseidon-out")?.innerText || "(empty)");
  ok(posOk, `on-chain poseidon_hash(1,2) matches circomlib (live click) — "${posTxt.slice(0, 60)}"`);

  // ---- Case 7: faucet copy is honest for the demo key ----
  console.log("[7] faucet");
  await page.click('[data-nav="faucet"]');
  const fz = await innerText(page);
  ok(/pre-funded/.test(fz), "faucet tells the truth for demo key (pre-funded)");
  ok(/Refresh balance/.test(fz), "faucet button = 'Refresh balance' (not fake request)");

  // ---- Case 8 (opt-in): real on-chain RFQ post via clicks ----
  if (process.env.E2E_WRITE === "1") {
    console.log("[8] WRITE: posting a real 3–5 USDC RFQ on-chain via the UI (demo seed)");
    await page.click('[data-nav="create"]');
    await page.fill('[data-form="min"]', "3");
    await page.fill('[data-form="max"]', "5");
    await page.fill('[data-form="deadlineMin"]', "10080"); // 7-day deadline: stays open for judges
    await page.click('[data-act="post"]');
    ok(await hasText(page, /RFQ posted/, 60000), "real RFQ posted on-chain via UI clicks");
    await page.click('[data-nav="active"]');
    await hasText(page, /3\.00/, 20000); // wait for the post-refresh to render the new row
    ok(/3\.00.{0,4}5\.00/.test(await innerText(page)), "new RFQ displays band as 3.00–5.00 USDC (decimal scaling)");
  } else {
    console.log("[8] WRITE flow skipped (set E2E_WRITE=1 to post a real RFQ; on-chain writes covered by e2e-testnet.mjs)");
  }

  // ---- Case 9: no console errors across the whole journey ----
  if (errs.length) errs.slice(0, 4).forEach((e) => console.log("    error:", String(e).slice(0, 160)));
  ok(errs.length === 0, "no uncaught/console errors across the full click-through");
} catch (e) {
  console.log("  ✗ exception:", e.message); fail++;
} finally {
  await browser.close();
  srv.kill();
}
console.log(`\n${fail ? "❌ " + fail : "✅ 0"} of ${n} checks failed`);
process.exit(fail ? 1 : 0);
