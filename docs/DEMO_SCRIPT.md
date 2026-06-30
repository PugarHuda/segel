# Segel — 3-minute demo script (per-shot, voice-over ready)

Goal: land ONE feeling — **the losing bids are mathematically gone** — and show it's
real ZK + real money on Stellar. You don't need to be on camera; screen-record the
desk (`/app.html`) with a **stellar.expert/explorer/testnet** tab open on the OTC
contract `CBAJVX6X…`. Each beat below = one shot: the **bold time**, the **action**
(what you click/show), and the `>` **line** (read it aloud, ~natural pace).

Pre-flight: Faucet tab → confirm the demo key is funded. Have an open DvP RFQ ready
(the seeded showcase RFQ shows a green **20 XLM** lot chip).

---

**0:00 — Hook (15s)** · *Action:* landing page `/`, slow scroll hero → "How it works".
> "A ten-million-dollar OTC block trade leaks the moment its bids are visible — the
> market front-runs you. So price discovery for size hides in chat rooms you have to
> trust. Segel is a sealed-bid OTC desk on Stellar where the losing bids are never
> revealed, and the fair price is *proven*, not trusted."

**0:15 — The live desk (15s)** · *Action:* click **Open the desk** → point at the
**Active RFQs** table; hover the row with the green **20 XLM** chip.
> "These RFQs are read live from a Soroban contract. Size bands are public — bid
> amounts are encrypted. This one's a delivery-vs-payment swap: the maker has
> escrowed a 20-XLM lot that the winner receives against payment."

**0:30 — Seal a bid — the ZK moment (45s)** · *Action:* click **Bid**, move the
slider; point at the commitment line, then **Prove & seal bid**; show the
"Generating bidValidity proof…" spinner → success toast.
> "I pick a bid. The commitment is Poseidon of my bid, a nonce, and my address.
> When I seal, my **browser** generates a zero-knowledge proof that my bid is in
> band, that I have the funds, that I'm on the KYC allow-list, and that I haven't
> bid before — without revealing the amount."

*Action:* open the tx on stellar.expert → point at the contract-call args.
> "Real transaction. The on-chain verifier checked the Groth16 proof and recorded
> only the commitment. The amount never left my browser."

*Action:* seal **2 more** bids at different slider values (distinct ZK identities).

**1:15 — Settle — the payoff (35s)** · *Action:* as maker, click **Settle**; show
the "Generating auctionResult proof…" spinner → settle tx on stellar.expert.
> "One auction proof shows the winner and the **Vickrey second-highest price** are
> correct — computed inside the circuit over exactly the sealed commitments. Then,
> atomically: the winner pays the clearing price, the 20-XLM lot is delivered to
> them, and the losers are refunded."

**1:50 — The reveal: the losers are GONE (25s)** · *Action:* on stellar.expert,
open the settle tx's events / contract state. Point deliberately.
> "Here's the whole point. Winner — public. Clearing price — public. Now look for
> the two losing bid amounts. They are **not here**. Not in the event, not in
> storage, not in the calldata. They were proven valid and proven to lose, and they
> are mathematically unrecoverable. That's the guarantee a chat-room desk can't give."

**2:15 — Don't trust me, check the chain (25s)** · *Action:* Audit tab → click
**Run poseidon_hash(1,2)** (matches circomlib), then point at the **oracle row**.
> "The contract runs Poseidon on-chain, bit-identical to the circuit. And the
> Reflector oracle isn't just a badge — settle reads the live mark and rejects a
> clearing wildly off-market. Every verifier and a real verify tx are linked right
> here."

*Optional tamper beat (10s), if you ran it:* show `npm run test:negative` output.
> "Flip one number in the proof — the winner, the price — and the on-chain verifier
> rejects it. A false statement has no valid proof."

**2:40 — AI can audit it too (15s)** · *Action:* show a Claude/Cursor window calling
the MCP `read_settlement` and `mark_price` tools against the live desk.
> "And because it's all on-chain, an AI agent can read the settlement outcome and
> the live mark itself through our MCP server — read-only, no keys."

**2:55 — Close (10s)**
> "Segel: bids sealed, settlement proven, losers never seen — real zero-knowledge,
> real USDC, real delivery, on Stellar."

---

### Honesty notes (so the voice-over stays true)
- Say **"proven, not trusted"** — not "trustless"; the settle prover does see the
  openings (a normal auctioneer property), which we disclose.
- The oracle guard is a **sanity circuit-breaker** (fat-finger net), *not* an
  anti-manipulation control — the ZK proof is the real binding on the price. Don't
  claim more.
- MCP `read_settlement` **reads** the verified outcome; it doesn't re-run the proof.
  Phrase it as "read the settlement," not "re-verify."

### Tips
- Pre-fund via **Faucet** before recording; proofs take ~3–8s — cut to the success
  state if it drags.
- Keep the stellar.expert contract tab open the whole time to show state changing.
- The single demo key plays maker + bidders via distinct ZK identities (disclosed) —
  if you want a clean "someone else's RFQ to bid on," run `node scripts/seed-rfq.mjs`.
