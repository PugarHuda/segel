# Confidential Tokens — feedback / engagement post (ready to paste)

> For the Stellar Developer Discord thread inviting feedback on the Confidential
> Tokens developer preview. Written from the Segel team (Stellar Hacks: Real-World
> ZK). Honest, technical, complementary — not spam. Trim to taste; the short version
> is the one to post first.

---

## Short version (paste this)

Really excited to see Confidential Tokens land — the privacy stack on Stellar is
starting to feel complete. We built **Segel** for the Real-World ZK hackathon: a
**confidential sealed-bid OTC desk** (Circom/Groth16/BN254, both circuits verified
on-chain via the P25/26 host functions). It sits in a slot that's complementary to
CT: CT and SPP are **payment** primitives (hide amounts / parties); Segel is
confidential **price discovery** — a sealed auction where losing bids are proven
valid but never revealed, and the Vickrey clearing price is proven, not trusted.

The obvious next step for us is to **settle the winning leg through a Confidential
Token** so the notional/size stays private while the price stays publicly proven —
which raises a concrete question for the CT design (below).

Live desk + repo if useful as a reference integration: https://segel.vercel.app ·
https://github.com/PugarHuda/segel

## The one piece of feedback / question that matters for us

For an OTC/settlement use case, the key thing is **third-party (contract) movement of
a confidential balance**. In our flow a *desk contract* holds escrow and pays out at
settlement — it isn't the account holder. So:

- Can a **contract** move CT-wrapped tokens on a user's behalf (delegated transfer
  inside the wrapper), the way a SAC `transfer` from a contract works today — or is
  every confidential transfer necessarily initiated by the balance owner?
- If delegated movement isn't in scope, is the intended pattern "user withdraws to
  the SAC → contract settles in the SAC → winner re-wraps"? That works but leaks the
  settled amount at the SAC boundary, which is exactly what we'd want to keep private.
- The **auditor view key + selective disclosure** primitives look perfect for a
  regulated desk. We already do selective disclosure on our *own* Poseidon
  commitments (a bidder can prove their exact bid to an auditor without it being
  public); being able to compose that with CT's auditor view at the settlement layer
  would be a strong "compliant confidential settlement" story.

## Smaller notes (from building adjacent ZK on Soroban)

- The **P25/26 BN254 host functions** are the thing that makes on-chain verification
  practical — we hand-rolled Poseidon on the BN254 field ops and verify Groth16 in
  the contract; great to see UltraHonk/Noir taking the same on-chain-verify path
  rather than stopping at off-chain proofs.
- Cross-proof-system composability is the interesting frontier: we're Circom/Groth16,
  CT is Noir/UltraHonk. A shared "confidential-amount" interface a Groth16 contract
  could consume would let mechanisms (auctions, order books) plug into CT balances.

Will try the OpenZeppelin demo on testnet and follow up with concrete notes. Happy to
pair or compare designs with anyone doing compliance-focused privacy on Stellar.

---

### Notes for us (not for the post)
- The blog: https://stellar.org/blog/developers/developer-preview-confidential-tokens-on-stellar
- CT = OpenZeppelin contract suite + Nethermind UltraHonk verifier + Noir proofs; Pedersen-commitment balances; auditor view key, selective disclosure, account freeze, policy engine.
- Our honest positioning is already in SUBMISSION.md ("Where Segel fits in Stellar's privacy stack") — keep the two consistent.
- If we actually run stellar-confidential-token-demo, replace "will try" with real findings before posting the long version.
