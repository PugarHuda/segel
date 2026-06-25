// Segel — Stellar-native MCP server (read-only).
// Exposes the live OTC desk to any AI agent (Claude Desktop, Cursor, …) so it can
// query open RFQs, sealed-bid counts, clearing prices, and re-verify settlements
// without wiring Soroban RPC itself. All tools are read-only; mutations require a
// signed wallet tx and stay out of the MCP surface.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as Sdk from "@stellar/stellar-sdk";

const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const OTC = "CDN3B3AC6AGNQPLQ2TR654P4YOQBAUJDLQELZXEU42EXZZ6WCHMSD7Y3";
const SOURCE = "GBJSZAEYQW5GQVJV77KGBPIN246HALRBWZINOQXE7DZ4NNHRVCSZMHAQ";
const server = new Sdk.rpc.Server(RPC);
const u32 = (x) => Sdk.nativeToScVal(x, { type: "u32" });

async function sim(method, ...args) {
  const acct = await server.getAccount(SOURCE);
  const c = new Sdk.Contract(OTC);
  const tx = new Sdk.TransactionBuilder(acct, { fee: "100", networkPassphrase: PASSPHRASE })
    .addOperation(c.call(method, ...args)).setTimeout(30).build();
  const s = await server.simulateTransaction(tx);
  if (Sdk.rpc.Api.isSimulationError(s)) throw new Error(s.error);
  return Sdk.scValToNative(s.result.retval);
}

const mcp = new McpServer({ name: "segel", version: "0.1.0" });

mcp.tool("list_rfqs", "List open RFQs on the Segel OTC desk (from on-chain state).", {}, async () => {
  const n = Number(await sim("rfq_count"));
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await sim("get_rfq_view", u32(i));
    out.push({ id: i, pair: r.pair, side: r.side, mode: Number(r.mode), band: [r.band_min.toString(), r.band_max.toString()], status: Number(r.status), bids: Number(await sim("bid_count", u32(i))) });
  }
  return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
});

mcp.tool("bid_count", "Number of sealed bids recorded for an RFQ.", { rfqId: z.number() }, async ({ rfqId }) => {
  const c = Number(await sim("bid_count", u32(rfqId)));
  return { content: [{ type: "text", text: String(c) }] };
});

mcp.tool("clearing_price", "Public clearing price of a settled RFQ (null if unsettled).", { rfqId: z.number() }, async ({ rfqId }) => {
  const s = await sim("settlement", u32(rfqId));
  return { content: [{ type: "text", text: s ? s.clearing.toString() : "null" }] };
});

mcp.tool("verify_settlement", "Check whether an RFQ is settled and return {settled, clearing, winner}.", { rfqId: z.number() }, async ({ rfqId }) => {
  const s = await sim("settlement", u32(rfqId));
  return { content: [{ type: "text", text: JSON.stringify(s ? { settled: true, clearing: s.clearing.toString(), winner: s.winner } : { settled: false }) }] };
});

await mcp.connect(new StdioServerTransport());
