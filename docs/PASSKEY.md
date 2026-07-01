# Passkey smart-wallet login — integration status & guide (branch: `passkey`)

Goal: a "no seed phrase" connect option (Touch ID / Windows Hello) that logs a user in
with a **Stellar passkey smart wallet** (secp256r1 / WebAuthn), as a third choice
alongside Freighter + the embedded demo key. Kept on the `passkey` branch — **not
merged to master**, so the live demo stays untouched until it's verified end-to-end.

## What is VERIFIED (probed live from this repo's Chrome)

- **passkey-kit loads in the browser with no bundler** — Segel is a no-build, pure-ESM
  site, and the default `https://esm.sh/passkey-kit` FAILS
  (`@stellar/stellar-sdk/minimal/contract` doesn't export `Client`). The working
  incantation is **`https://esm.sh/passkey-kit?bundle-deps`** (bundles the deps so the
  stellar-sdk subpath resolves). This was the load-bearing risk and it's cleared.
- **The API instantiates + is what we need.** `new PasskeyKit({ rpcUrl,
  networkPassphrase, walletWasmHash })` exposes `createWallet`, `connectWallet`,
  `sign`, `signAuthEntry`, `addSecp256r1`, `addPolicy`, … ; `new PasskeyServer({ rpcUrl,
  launchtubeUrl })` exposes `getSigners`, `getContractId`, `send`.

## What is BLOCKED from THIS environment (not a code problem)

- **Launchtube is unreachable here.** `https://testnet.launchtube.xyz` returns HTTP 000
  / `fetch failed` (the same ISP content-filter that blocks circle.com in this
  network; esm.sh as a control returns 200). Launchtube is how `PasskeyServer.send`
  submits + sponsors the smart-wallet's transactions. Get a token in an unblocked
  network at `https://testnet.launchtube.xyz/gen` (JWT, ~3 months, 100 XLM credit).
  Alternative without Launchtube: submit with a **funded fee-source** (e.g. the demo
  key) as the transaction source while the passkey signs the smart-wallet auth entry.
- **WebAuthn can't be driven headless here.** `createWallet` calls
  `navigator.credentials.create` — it needs a real platform authenticator (Touch ID /
  Windows Hello) or a Playwright **CDP virtual authenticator**
  (`WebAuthn.addVirtualAuthenticator`) to test. A real user on the deployed site just
  uses their device biometric.
- **`walletWasmHash`** — supply the deployed testnet smart-wallet WASM hash (build +
  `stellar contract upload` the passkey-kit wallet contract, or use a published one).

## To finish (in an unblocked network + a real browser)

1. Get a Launchtube token → set `PASSKEY_CONFIG.launchtubeUrl` + `launchtubeToken`
   in `frontend/wallet-passkey.js` (or your env), and the `walletWasmHash`.
2. Un-gate the "Passkey" connect button (it's behind `PASSKEY_CONFIG.enabled`).
3. `createWallet` → the smart-wallet `contractId` becomes the connected address; store
   the `keyId` (localStorage) for `connectWallet` on return.
4. Write path: build the Segel `commit_bid` / `settle` `AssembledTransaction`, sign the
   smart-wallet **auth entry** with `kit.sign(tx, { keyId })`, then submit via
   `server.send(tx)` (Launchtube). This replaces the Freighter `signTransaction` /
   `signAuthEntry` pair for passkey sessions.
5. Test with a real biometric (or a CDP virtual authenticator in CI).

## Honest assessment

The browser integration is **proven viable** (dependency loads + the API is right),
so this is a real, scoped integration — not a dead end. It is **not verifiable from
this environment** (Launchtube network-filtered here; WebAuthn needs a real device), so
it stays on this branch behind a disabled flag rather than shipping untested onto the
fully-green live demo. `frontend/wallet-passkey.js` is the correct-by-construction
scaffold (verified imports + API); the write-path submit is wired to `PasskeyServer`
and marked as the part to validate once Launchtube is reachable.
