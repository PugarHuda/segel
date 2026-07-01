// Passkey smart-wallet connect for Segel (EXPERIMENTAL — branch `passkey`, not merged).
// "No seed phrase" login via a Stellar secp256r1/WebAuthn smart wallet (passkey-kit).
//
// Status (see docs/PASSKEY.md): the import + API are VERIFIED to work in-browser via
// esm.sh `?bundle-deps`. The transaction-submission path needs Launchtube (or a
// funded fee-source), which is network-blocked from the dev environment this was built
// in, and WebAuthn needs a real authenticator — so this ships DISABLED and unverified
// end-to-end. Set PASSKEY_CONFIG.enabled + the two blanks in an unblocked env to finish.

const PASSKEY_CONFIG = {
  enabled: false, // flip to true once walletWasmHash + Launchtube are set (never on the live demo until verified)
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  walletWasmHash: "", // deployed testnet smart-wallet WASM hash (required)
  launchtubeUrl: "https://testnet.launchtube.xyz",
  launchtubeToken: "", // JWT from https://testnet.launchtube.xyz/gen (required to submit)
  appName: "Segel",
};
const LS_KEYID = "segel.passkey.keyId";

export function passkeyEnabled() {
  return PASSKEY_CONFIG.enabled && !!PASSKEY_CONFIG.walletWasmHash && !!PASSKEY_CONFIG.launchtubeToken;
}

let _kit = null, _server = null;
async function load() {
  if (_kit) return { kit: _kit, server: _server };
  // VERIFIED: default esm.sh entry fails (stellar-sdk /minimal/contract Client export);
  // `?bundle-deps` bundles the deps and resolves it.
  const { PasskeyKit, PasskeyServer } = await import("https://esm.sh/passkey-kit?bundle-deps");
  _kit = new PasskeyKit({ rpcUrl: PASSKEY_CONFIG.rpcUrl, networkPassphrase: PASSKEY_CONFIG.networkPassphrase, walletWasmHash: PASSKEY_CONFIG.walletWasmHash });
  _server = new PasskeyServer({ rpcUrl: PASSKEY_CONFIG.rpcUrl, launchtubeUrl: PASSKEY_CONFIG.launchtubeUrl, launchtubeJwt: PASSKEY_CONFIG.launchtubeToken });
  return { kit: _kit, server: _server };
}

// Connect: reuse a stored passkey if present, else register a new one. Returns the
// smart-wallet contract id (the Segel account) + the keyId to persist.
export async function connect() {
  if (!passkeyEnabled()) throw new Error("Passkey login is not configured yet (see docs/PASSKEY.md)");
  const { kit, server } = await load();
  const stored = localStorage.getItem(LS_KEYID);
  if (stored) {
    const { contractId } = await kit.connectWallet({ keyId: stored, getContractId: (kid) => server.getContractId(kid) });
    return { address: contractId, keyId: stored };
  }
  const { keyIdBase64, contractId, signedTx } = await kit.createWallet(PASSKEY_CONFIG.appName, "user");
  if (signedTx) await server.send(signedTx); // deploy the wallet (sponsored by Launchtube)
  localStorage.setItem(LS_KEYID, keyIdBase64);
  return { address: contractId, keyId: keyIdBase64 };
}

export function disconnect() { localStorage.removeItem(LS_KEYID); _kit = null; _server = null; }

// Sign a Segel AssembledTransaction's smart-wallet auth with the passkey, then submit
// via Launchtube. This replaces Freighter's signTransaction/signAuthEntry for passkey
// sessions. NOTE: wire this into stellar.js writeClient for passkey mode — the exact
// AssembledTransaction hand-off is the piece to validate once Launchtube is reachable.
export async function signAndSend(assembledTx) {
  const { kit, server } = await load();
  const keyId = localStorage.getItem(LS_KEYID);
  const signed = await kit.sign(assembledTx.built ?? assembledTx, { keyId });
  return server.send(signed);
}
