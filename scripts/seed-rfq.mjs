// Seed a live demo RFQ from a SEPARATE maker (not the embedded demo key), so the
// demo key can place a sealed bid on it (the UI hides "Bid" on your own RFQs).
// A maker doesn't escrow — it only signs post_rfq — so a freshly friendbot-funded
// throwaway key is enough. Amounts are token stroops (7-decimal USDC): 3.00–5.00.
import * as Sdk from "@stellar/stellar-sdk";

const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const OTC = "CBAJVX6XPPGCMIQRWABO6ZOGQH7PJXTF4XB3MTAC35M4SBRLSIYXBBZM";
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
const at = await c.post_rfq({
  maker: kp.publicKey(), pair: "XLMUSDC", side: "BUY", mode: 1,
  band_min: 30000000n, band_max: 50000000n, deadline,
});
const res = await at.signAndSend();
console.log(`posted RFQ #${at.result} -> https://stellar.expert/explorer/testnet/tx/${res.sendTransactionResponse?.hash}`);
process.exit(0);
