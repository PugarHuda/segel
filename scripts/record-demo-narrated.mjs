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
// VO_LANG=id (or the --id flag) renders the Indonesian VO + subtitles (BEATS[i].id).
const LANG = (process.env.VO_LANG === "id" || process.argv.includes("--id")) ? "id" : "en";
const VOICE = process.env.VOICE || (LANG === "id" ? "id-ID-ArdiNeural" : "en-US-AndrewNeural");
const TXT = (b) => (LANG === "id" && b.id) ? b.id : b.t; // narration + subtitle text for this run
const TMP = process.env.TEMP + "\\segel-narrated-" + LANG;
const FRAMES = TMP + "\\frames";
const AUD = TMP + "\\audio";
const OUT = LANG === "id" ? "frontend/segel-demo-id.mp4" : "frontend/segel-demo-narrated.mp4";
const PORT = 8132;
const base = `http://localhost:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the walkthrough: one VO line + the on-screen action it plays over ───────────
// `do(page,h)` gets the puppeteer page + a helpers object; keep actions using the
// same stable data-* selectors the silent recorder uses (text labels drift).
const BEATS = [
  { t: "This is Segel — a confidential, sealed-bid OTC desk on Stellar. A ten-million-dollar block trade leaks the moment its bids are visible, so the market front-runs you.",
    id: "Ini Segel — meja OTC lelang tertutup yang rahasia di Stellar. Transaksi blok bernilai jutaan dolar langsung bocor begitu penawarannya terlihat, dan pasar pun mendahului Anda.",
    do: async (p, h, ms) => { await wait(1100); await h.pan(0, 0.45, ms - 1100); } },
  { t: "Segel runs that auction on-chain. Every bid is sealed, the fair clearing price is proven in zero-knowledge, and the losing bids are never revealed — not to the public, not to rival desks.",
    id: "Segel menjalankan lelang itu di on-chain. Setiap penawaran disegel, harga kliring yang adil dibuktikan secara zero-knowledge, dan penawaran yang kalah tidak pernah terungkap — tidak ke publik, tidak ke meja pesaing.",
    do: async (p, h, ms) => { await h.pan(0.45, 1, ms - 900); await h.pan(1, 0, 900); } },
  { t: "Here is the live desk. These RFQs are read straight from a Soroban contract. The size bands are public, but the bid amounts are encrypted.",
    id: "Inilah meja langsungnya. RFQ ini dibaca langsung dari kontrak Soroban. Rentang ukuran bersifat publik, tapi nilai penawarannya terenkripsi.",
    do: async (p, h) => { await h.desk(); } },
  { t: "I'll connect — Freighter, or a no-install demo key for this walkthrough.",
    id: "Saya sambungkan dompet — Freighter, atau kunci demo tanpa instalasi untuk panduan ini.",
    do: async (p, h) => { await h.clk('[data-act="connect"]'); await wait(1100); await h.clk('[data-act="conn:demo"]');
      await p.waitForFunction(() => /USDC/.test(document.body.innerText), { timeout: 20000 }).catch(() => {}); } },
  { t: "Anyone can post an RFQ. Make it a directed Direct-OTC, and only one invited address is allowed to bid — enforced on-chain, in the contract, not just in the interface.",
    id: "Siapa pun bisa memposting RFQ. Jadikan Direct-OTC terarah, dan hanya satu alamat yang diundang boleh menawar — dipaksakan di on-chain, di dalam kontrak, bukan sekadar di antarmuka.",
    do: async (p, h) => { await h.clk('[data-nav="create"]'); await wait(1200); await h.clk('[data-act="mode:0"]'); await wait(700);
      await p.evaluate(() => { const f = document.querySelector('[data-form="taker"]'); if (f) { f.scrollIntoView({ block: "center" }); f.value = "GA…the one invited counterparty"; f.style.outline = "2px solid #7585e4"; } }); } },
  { t: "I'll post this one open to everyone, with a twenty-X-L-M delivery lot escrowed — a real two-asset delivery-versus-payment swap. And this is a real transaction: the RFQ posts on-chain now.",
    id: "Yang ini saya posting terbuka untuk semua, dengan jaminan pengiriman dua puluh XLM — swap dua aset delivery-versus-payment yang nyata. Dan ini transaksi sungguhan: RFQ-nya diposting on-chain sekarang.",
    do: async (p, h) => { await h.clk('[data-act="mode:1"]'); await wait(700);
      await p.evaluate(() => { const f = document.querySelector('[data-form="lot"]'); if (f) f.scrollIntoView({ block: "center" }); }); await wait(900);
      await h.post(); } },
  { t: "Don't trust the interface — check the chain. The contract computes Poseidon on-chain, bit-for-bit identical to the circuit.",
    id: "Jangan percaya antarmuka — periksa rantainya. Kontrak menghitung Poseidon di on-chain, identik bit demi bit dengan sirkuit.",
    do: async (p, h) => { await h.clk('[data-nav="audit"]'); await wait(1200); await h.clk('[data-act="poseidon"]'); await wait(2000); } },
  { t: "Every one of these bids is an amount hidden behind a Poseidon commitment.",
    id: "Setiap penawaran ini adalah nilai yang disembunyikan di balik komitmen Poseidon.",
    do: async (p, h) => { await h.clk('[data-nav="active"]'); await wait(1600); } },
  { t: "When I place a bid, my browser generates a zero-knowledge proof: that the bid is in band, that I hold the funds, that I'm on the K-Y-C allow-list, and that I haven't bid before — without ever revealing the amount.",
    id: "Saat saya menawar, browser saya membuat bukti zero-knowledge: bahwa penawaran ada dalam rentang, bahwa dananya cukup, bahwa saya ada di daftar izin KYC, dan bahwa saya belum pernah menawar — tanpa pernah mengungkap nilainya.",
    do: async (p, h) => { await h.bid(); await wait(1500); } },
  { t: "I seal it. The proof is made in-browser, then a real commit-bid lands on-chain recording only the commitment. The amount never leaves my device.",
    id: "Saya segel. Buktinya dibuat di browser, lalu commit-bid sungguhan tercatat di on-chain — hanya komitmennya yang direkam. Nilainya tak pernah meninggalkan perangkat saya.",
    do: async (p, h) => { await h.seal(); } },
  { t: "At settlement, one auction proof shows the winner and the Vickrey second-highest price are correct — computed inside the circuit over exactly these sealed commitments. The winner pays, the lot is delivered, the losers are refunded. And the losing amounts are simply not there: not in storage, not in the calldata. Mathematically gone.",
    id: "Saat penyelesaian, satu bukti lelang menunjukkan pemenang dan harga Vickrey tertinggi kedua sudah benar — dihitung di dalam sirkuit atas komitmen tersegel ini. Pemenang membayar, jaminan dikirim, yang kalah dikembalikan. Dan nilai yang kalah memang tak ada: tidak di penyimpanan, tidak di calldata. Hilang secara matematis.",
    do: async (p, h) => { await wait(1500); } },
  { t: "But privacy isn't secrecy from a regulator. With selective disclosure, the winner here bid four-ninety but paid the Vickrey price of four-twenty — so four-ninety is not on the chain.",
    id: "Tapi privasi bukan berarti menyembunyikan dari regulator. Dengan pengungkapan selektif, pemenang di sini menawar empat koma sembilan puluh tapi membayar harga Vickrey empat koma dua puluh — jadi empat koma sembilan puluh tidak ada di rantai.",
    do: async (p, h) => { await h.clk('[data-nav="portfolio"]'); await wait(1500); await h.clk('[data-act="verifyopen"]'); await wait(1200);
      await p.evaluate(() => { const t = document.querySelector('[data-disc="input"]'); if (t) t.value = JSON.stringify({ rfqId: 13, bidder: "GBJSZAEYQW5GQVJV77KGBPIN246HALRBWZINOQXE7DZ4NNHRVCSZMHAQ", bid: 4.90, nonce: "123456888" }); }); } },
  { t: "Yet they can prove it to an auditor, against the on-chain commitment. Verified. Change a single digit, and it fails. Private, but provable.",
    id: "Namun mereka bisa membuktikannya ke auditor, terhadap komitmen on-chain. Terverifikasi. Ubah satu angka saja, dan gagal. Privat, tapi bisa dibuktikan.",
    do: async (p, h) => { await h.clk('[data-act="verifydisc"]'); await wait(3500); } },
  { t: "In the interest of honesty: the settler does see the openings to compute the result, like any auctioneer — Segel hides the losers from the chain and the public. And the oracle price-guard is a fat-finger check, not an anti-manipulation control. The proof is what binds the price.",
    id: "Demi kejujuran: penyelesai memang melihat pembukaan penawaran untuk menghitung hasilnya, seperti juru lelang mana pun — Segel menyembunyikan yang kalah dari rantai dan publik. Dan penjaga harga oracle hanyalah pengaman salah-ketik, bukan kendali anti-manipulasi. Buktinyalah yang mengikat harga.",
    do: async (p, h) => { await h.clk('[data-nav="audit"]'); await wait(2500); } },
  { t: "Two Circom Groth16 circuits, verified on-chain through Stellar's BN254 host functions. Real Circle USDC escrow, a Reflector oracle read at settlement, and an MCP server so an AI agent can read the outcome. Segel: bids sealed, settlement proven, losers never seen — real zero-knowledge, real money, on Stellar.",
    id: "Dua sirkuit Circom Groth16, diverifikasi on-chain lewat fungsi host BN254 milik Stellar. Escrow USDC Circle sungguhan, pembacaan oracle Reflector saat penyelesaian, dan server MCP agar agen AI bisa membaca hasilnya. Segel: penawaran tersegel, penyelesaian terbukti, yang kalah tak pernah terlihat — zero-knowledge nyata, uang nyata, di Stellar.",
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

console.log(`synthesizing ${BEATS.length} VO clips with ${VOICE} (${LANG})…`);
for (let i = 0; i < BEATS.length; i++) {
  const mp3 = `${AUD}\\clip${String(i).padStart(2, "0")}.mp3`;
  const r = spawnSync("python", ["-m", "edge_tts", "--voice", VOICE, "--text", TXT(BEATS[i]), "--write-media", mp3], { encoding: "utf8" });
  if (r.status !== 0) { console.error("edge-tts failed:", r.stderr); process.exit(1); }
  BEATS[i].mp3 = mp3;
  BEATS[i].clipDur = durOf(mp3);
  process.stdout.write(`  clip ${i} ${BEATS[i].clipDur.toFixed(1)}s\n`);
}

// ── 1b) seed one FRESH non-mine DvP RFQ so the demo key can place a REAL bid on it
// (the UI hides "Bid" on your own RFQs; a brand-new RFQ also means a fresh nullifier).
console.log("seeding a fresh RFQ to bid on (scripts/seed-rfq.mjs)…");
const seed = spawnSync("node", ["scripts/seed-rfq.mjs"], { encoding: "utf8" });
const seedId = (/RFQ #(\d+)/.exec(seed.stdout || "") || [])[1] || null;
console.log(seedId ? `  ✅ will bid on fresh RFQ #${seedId}` : `  ⚠ seed failed (${(seed.stderr || "").trim().slice(0, 120)}); bid falls back to newest DvP`);

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
// read the current toast text (proves the on-chain writes really happened)
const toastText = () => page.evaluate(() => (document.querySelector("[data-toast],.toast,#toast")?.textContent || document.body.innerText.match(/RFQ posted[^\n]*|Bid sealed[^\n]*|posted ✓|sealed[^\n]*✓/i)?.[0] || "")).catch(() => "");
const waitToast = async (re, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const t = await toastText(); if (re.test(t)) return t; await wait(400); }
  return "";
};
const helpers = {
  clk,
  // smooth continuous pan between two fractions of the scrollable height over ~durMs,
  // so the landing never looks abruptly cut ("kepotong") — every section pans through.
  pan: async (fromFrac, toFrac, durMs) => {
    const max = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
    const steps = Math.max(20, Math.round(durMs / 60));
    const a = max * fromFrac, b = max * toFrac;
    for (let i = 0; i <= steps; i++) { await page.evaluate((y) => window.scrollTo(0, y), a + (b - a) * i / steps); await wait(Math.max(30, durMs / steps)); }
  },
  desk: async () => {
    await page.goto(base + "/app.html", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => !/loading live RFQs/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
  },
  // REAL write #1: submit the Create form (default = open XLM/USDC RFQ, 20 XLM lot) → post_rfq on-chain
  post: async () => {
    await clk('[data-act="post"]');
    const t = await waitToast(/posted/i, 35000);
    console.log(t ? `   ✅ real post_rfq: "${t.trim()}"` : "   ⚠ post_rfq toast not seen (bid falls back to newest existing RFQ)");
    await page.waitForFunction(() => /Active RFQs/i.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
    await wait(1200);
  },
  // bid on the seeded fresh RFQ (non-mine, 0 bids → fresh nullifier); fall back to the
  // newest DvP with a Bid button if seeding failed.
  bid: async () => page.evaluate((id) => {
    const pick = id && document.querySelector(`[data-act="bid:${id}"]`);
    const btns = [...document.querySelectorAll('[data-act^="bid:"]')];
    const dvps = btns.filter((b) => b.closest(".rfq-grid")?.querySelector('[title*="delivery leg"]'));
    const el = pick || dvps[dvps.length - 1] || btns[btns.length - 1];
    if (el) { el.scrollIntoView({ block: "center" }); el.click(); return true; } return false;
  }, seedId),
  // REAL write #2: prove in-browser + commit_bid on-chain; assert the success toast
  seal: async () => {
    await clk('[data-act="sealbid"]');
    const t = await waitToast(/sealed|verified on-chain/i, 40000);
    console.log(t ? `   ✅ real commit_bid: "${t.trim()}"` : "   ⚠ bid success toast not seen — check the run");
    await wait(1200);
  },
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
    await cap(TXT(b));
    try { await b.do(page, helpers, b.clipDur * 1000); } catch (e) { console.error("beat warn:", e.message); }
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
