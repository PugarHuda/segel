// Segel — Stellar-native MCP server (read-only).
// Exposes the live OTC desk to any AI agent (Claude Desktop, Cursor, …) so it can
// query RFQs, sealed-bid counts, clearing prices, settlement outcomes, and the live
// oracle mark without wiring Soroban RPC itself. Every tool is a real on-chain
// `simulateTransaction` read against the live contract — nothing is cached or faked.
// All tools are READ-ONLY: there is no keypair or signing path here; mutations
// require a signed wallet tx and stay out of the MCP surface.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as Sdk from "@stellar/stellar-sdk";

const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const OTC = "CBAJVX6XPPGCMIQRWABO6ZOGQH7PJXTF4XB3MTAC35M4SBRLSIYXBBZM";
// A funded testnet account, used only as the (free) source for read simulations —
// it never signs and is never charged. If testnet reaps it, swap for any funded id.
const SOURCE = "GBJSZAEYQW5GQVJV77KGBPIN246HALRBWZINOQXE7DZ4NNHRVCSZMHAQ";
const server = new Sdk.rpc.Server(RPC);
const u32 = (x) => Sdk.nativeToScVal(x, { type: "u32" });
const sym = (s) => Sdk.nativeToScVal(s, { type: "symbol" });
// On-chain amounts are 7-decimal Circle-USDC stroops; surface human USDC + the raw.
const toUsdc = (stroops) => Number(BigInt(stroops)) / 1e7;
const STATUS = ["open", "settled", "cancelled"];
// reject NaN / floats / negatives before they hit nativeToScVal(u32)
const rfqIdArg = { rfqId: z.number().int().nonnegative() };
const ok = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });

async function sim(method, ...args) {
  const acct = await server.getAccount(SOURCE);
  const c = new Sdk.Contract(OTC);
  const tx = new Sdk.TransactionBuilder(acct, { fee: "100", networkPassphrase: PASSPHRASE })
    .addOperation(c.call(method, ...args)).setTimeout(30).build();
  const s = await server.simulateTransaction(tx);
  if (Sdk.rpc.Api.isSimulationError(s)) throw new Error(s.error);
  return Sdk.scValToNative(s.result.retval);
}

const mcp = new McpServer({ name: "segel", version: "0.2.0" });

mcp.tool("list_rfqs", "List ALL RFQs on the Segel OTC desk (open/settled/cancelled) from live on-chain state, with USDC bands.", {}, async () => {
  const n = Number(await sim("rfq_count"));
  const out = await Promise.all(
    Array.from({ length: n }, (_, i) => Promise.all([sim("get_rfq_view", u32(i)), sim("bid_count", u32(i)), sim("base_leg", u32(i))])
      .then(([r, bids, base]) => ({
        id: i, pair: r.pair, side: r.side, mode: Number(r.mode),
        bandUsdc: [toUsdc(r.band_min), toUsdc(r.band_max)], bandStroops: [r.band_min.toString(), r.band_max.toString()],
        status: STATUS[Number(r.status)] ?? Number(r.status), bids: Number(bids),
        baseLotXlm: base ? Number(base.amount) / 1e7 : null, // DvP delivery lot (null = quote-only)
      })))
  );
  return ok(out);
});

mcp.tool("bid_count", "Number of sealed bids recorded for an RFQ (amounts stay hidden on-chain).", rfqIdArg, async ({ rfqId }) => {
  return ok(String(Number(await sim("bid_count", u32(rfqId)))));
});

mcp.tool("clearing_price", "Public clearing price (USDC) of a settled RFQ; null if unsettled.", rfqIdArg, async ({ rfqId }) => {
  const s = await sim("settlement", u32(rfqId));
  return ok(s ? { clearingUsdc: toUsdc(s.clearing), clearingStroops: s.clearing.toString() } : { clearing: null });
});

mcp.tool(
  "read_settlement",
  "Read the settlement OUTCOME of an RFQ: {settled, winner, clearingUsdc}. NOTE: this reads the result the on-chain auctionResult Groth16 verifier already accepted inside settle() — it reports that verified state, it does not itself re-run the proof (the proof + public inputs live in the historical settle tx calldata, not in contract storage). Also reports whether the clearing sits within the RFQ's public band (a sanity check it can do from state).",
  rfqIdArg,
  async ({ rfqId }) => {
    const s = await sim("settlement", u32(rfqId));
    if (!s) return ok({ settled: false });
    const r = await sim("get_rfq_view", u32(rfqId));
    const clearing = Number(s.clearing);
    return ok({
      settled: true, winner: s.winner, clearingUsdc: toUsdc(s.clearing),
      bandUsdc: [toUsdc(r.band_min), toUsdc(r.band_max)],
      clearingWithinBand: clearing >= Number(r.band_min) && clearing <= Number(r.band_max),
      note: "Vickrey clearing = second-highest sealed bid, proven on-chain at settle time; losing bid amounts are not recoverable from chain state.",
    });
  }
);

mcp.tool("mark_price", "Live market mark (USD) for a symbol (e.g. XLM, USDC) via the desk's on-chain Reflector SEP-40 oracle read.", { symbol: z.string() }, async ({ symbol }) => {
  const p = await sim("mark_price", sym(symbol));
  return ok(p ? { symbol, usd: Number(p.price) / 1e14, raw: p.price.toString(), decimals: 14, timestamp: Number(p.timestamp) } : { symbol, usd: null });
});

await mcp.connect(new StdioServerTransport());
