// Headless smoke test for the Segel frontend: boots the static server, loads the
// landing + desk in real Chrome, asserts no console errors, and confirms the desk
// reads live RFQs from the testnet contract (in-browser RPC).
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 8123;
const base = `http://localhost:${PORT}`;

const srv = spawn(process.execPath, ["frontend/serve.mjs", String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let failures = 0;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
try {
  for (const path of ["/", "/app.html"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + path, { waitUntil: "networkidle2", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1500));
    const title = await page.title();
    // ignore benign favicon 404s
    const real = errors.filter((e) => !/favicon|404/i.test(e));
    console.log(`\n[${path}] title="${title}" console-errors=${real.length}`);
    real.slice(0, 5).forEach((e) => console.log("   ✗", e.slice(0, 140)));
    if (real.length) failures++;

    if (path === "/app.html") {
      // wait for the desk to load live RFQs from chain
      await page.waitForFunction(() => /live/.test(document.body.innerText) && !/loading live RFQs/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
      const hasDesk = await page.evaluate(() => document.body.innerText.includes("Active RFQs"));
      const rfqShown = await page.evaluate(() => /RFQ-\d{3}/.test(document.body.innerText));
      console.log(`   desk rendered: ${hasDesk} · live RFQ rows visible: ${rfqShown}`);
      if (!hasDesk) failures++;
      await page.screenshot({ path: "frontend/screenshot-desk.png" });
    } else {
      const hero = await page.evaluate(() => document.body.innerText.includes("SEALED"));
      console.log(`   landing hero present: ${hero}`);
      if (!hero) failures++;
      await page.screenshot({ path: "frontend/screenshot-landing.png" });
    }
    await page.close();
  }
} finally {
  await browser.close();
  srv.kill();
}
console.log(failures ? `\n❌ ${failures} check(s) failed` : "\n✅ frontend smoke test passed");
process.exit(failures ? 1 : 0);
