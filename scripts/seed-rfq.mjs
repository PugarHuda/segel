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
const at = await c.post_rfq_dvp({
  maker: kp.publicKey(), pair: "XLMUSDC", side: "SELL", mode: 1,
  band_min: 30000000n, band_max: 50000000n, deadline,
  base_token: XLM_SAC, base_amount: 200000000n, base_symbol: "XLM", // 20 XLM delivery lot (+ oracle symbol)
});
const res = await at.signAndSend();
console.log(`posted RFQ #${at.result} -> https://stellar.expert/explorer/testnet/tx/${res.sendTransactionResponse?.hash}`);
process.exit(0);
