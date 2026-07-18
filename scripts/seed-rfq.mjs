// Seed a live demo RFQ from a SEPARATE maker (not the embedded demo key), so the
// demo key can place a sealed bid on it (the UI hides "Bid" on your own RFQs).
// It's a DvP RFQ: the throwaway maker escrows a 20 XLM sell-side lot (the delivery
// leg the winner receives) — a freshly friendbot-funded key has 10k XLM, plenty.
// Quote band is token stroops (7-decimal USDC): 3.00–5.00.
import * as Sdk from "@stellar/stellar-sdk";

const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const OTC = "CBAJVX6XPPGCMIQRWABO6ZOGQH7PJXTF4XB3MTAC35M4SBRLSIYXBBZM";
const XLM_SAC = Sdk.Asset.native().contractId(PASSPHRASE); // base/sell-side asset
const server = new Sdk.rpc.Server(RPC);

const kp = Sdk.Keypair.random();
console.log("maker (throwaway):", kp.publicKey());
const r = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
if (!r.ok) throw new Error("friendbot fund failed");
console.log("funded via friendbot");

const signer = Sdk.contract.basicNodeSigner(kp, PASSPHRASE);
const c = await Sdk.contract.Client.from({
  contractId: OTC, networkPassphrase: PASSPHRASE, rpcUrl: RPC,
  publicKey: kp.publicKey(), signTransaction: signer.signTransaction, signAuthEntry: signer.signAuthEntry,
});
const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600); // 7 days
// Quote band in USDC stroops (7-dec). Kept small by default so the embedded demo key —
// which holds only ~1 Circle USDC on testnet — can actually afford to escrow a bid.
// Override with BAND_MIN/BAND_MAX (stroops) once the demo key is topped up.
const band_min = BigInt(process.env.BAND_MIN || 2000000); // 0.20 USDC
const band_max = BigInt(process.env.BAND_MAX || 4000000); // 0.40 USDC
const at = await c.post_rfq_dvp({
  maker: kp.publicKey(), pair: "XLMUSDC", side: "SELL", mode: 1,
  band_min, band_max, deadline,
  base: { token: XLM_SAC, amount: 200000000n, symbol: "XLM" }, // 20 XLM delivery lot (+ oracle symbol)
  taker: null, // open to anyone
});
const res = await at.signAndSend();
console.log(`posted RFQ #${at.result} -> https://stellar.expert/explorer/testnet/tx/${res.sendTransactionResponse?.hash}`);
process.exit(0);
