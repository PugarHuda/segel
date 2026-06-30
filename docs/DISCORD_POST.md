# Stellar Developer Discord — ready-to-paste post

> Context: the Confidential Tokens blog explicitly invites "Stellar Hacks: Real-World
> ZK" participants to share in the Developer Discord. Paste the short version below;
> the long version is a follow-up if people ask. Swap in your handle/links as needed.

---

## Short version (drop in #share-what-youre-building or the hackathon channel)

Built **Segel** for Stellar Hacks: Real-World ZK — a **confidential sealed-bid OTC
desk**. Bids are sealed, the fair **Vickrey clearing price is proven in zero-knowledge**
on-chain, and **losing bids are never revealed**.

Where it fits the new privacy stack: Confidential Tokens and SPP are *payment*
primitives (hide amounts / parties). Segel fills the complementary slot —
confidential **price discovery**. And inspired by the CT preview, I shipped
**selective disclosure** on Segel's own commitments: the winner bid X but pays the
second price, so X is never on-chain — yet they can prove it to an auditor, privately
and bindingly. (`npm run disclose`, or in the UI.)

Everything is live on testnet and reproducible:
- 🌐 Desk: https://segel.vercel.app  ·  💻 https://github.com/PugarHuda/segel
- Two Circom/Groth16/BN254 circuits **verified on-chain** by Soroban (Protocol 25/26
  host fns). Soundness is checked live, not asserted: `npm run test:tamper-onchain`
  rejects a tampered proof on the deployed verifier.
- Real **Circle USDC** escrow + settlement, two-asset **DvP** delivery, a **Reflector**
  oracle price circuit-breaker in `settle`, and a read-only **MCP** server so an AI
  agent can query the live desk.

Would love feedback — especially on the selective-disclosure UX and whether settling
the winning leg through a Confidential Token (size private, price publicly proven) is
worth prototyping next.

---

## Long version (follow-up / thread)

**Problem.** OTC block trades leak: the moment bids are visible, the market front-runs
them, so size trades hide in chat rooms you have to trust.

**Segel.** An on-chain sealed-bid desk where bid amounts are Poseidon commitments, one
`auctionResult` proof shows the winner + Vickrey second price are correct over exactly
the recorded commitments, and losing amounts stay hidden forever. The contract builds
every verifier public-input vector itself (binding), so a proof can't be replayed with
a different bid/identity/set.

**Honest about scope** (because Real-World ZK should be): the settle prover sees the
openings (normal auctioneer property — we hide losers from the public/chain, not the
auctioneer; full MPC is future work); the oracle guard is a fat-finger circuit-breaker,
not an anti-manipulation control (the ZK proof is the real price binding); the ASP
allow-list is test identities, not real KYC; trusted setup is a local phase-1.

**Selective disclosure** turned out to be the most fun bit after reading the
Confidential Tokens post — same compliance primitive, but on the auction's own
commitments, and it's sharpest exactly where Vickrey hides the winner's true bid.

Repo, live desk, and a one-command on-chain soundness check are all in the README.
Happy to pair or compare notes with anyone doing compliance-focused privacy on Stellar.
