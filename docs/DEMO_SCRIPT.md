# Segel — 2–3 minute demo script

Goal: show the sealed-bid OTC flow and make clear **what the ZK is doing**.
You do not have to be on camera. Screen-record the desk + a stellar.expert tab.

---

**0:00 — Hook (15s)**
> "Large OTC trades today leak: post on a DEX and you're front-run; call a desk
> and you trust the spread. Segel is a sealed-bid OTC desk on Stellar where bid
> amounts are hidden, the fair price is *proven* in zero-knowledge, and losing
> bids are never revealed."

Show the landing page (`/`). Scroll the hero → "How it works" → "ZK Stack".

**0:15 — The desk (15s)**
Click **Open the desk** (`/app.html`). Point out the live **Active RFQs** table:
"these are read live from the Soroban contract — size bands are public, bid
amounts are encrypted."

**0:30 — Post an RFQ (20s)**
Sidebar → **Create RFQ** → RFQ Auction → fill pair / band / deadline → **Post**.
> "The maker posts a quote. Escrow opens on-chain." Show the toast + that it
> appears in Active RFQs.

**0:50 — Seal a bid, the ZK moment (45s)**
Click **Bid** on the RFQ. Move the slider.
> "I set a bid. Watch — the commitment is `Poseidon(bid, nonce, address)`. When I
> seal, the browser generates a **bidValidity zero-knowledge proof**: it proves my
> bid is in band, that I have the funds, that I'm on the allow-list, and that I
> haven't bid before — **without revealing the amount**."

Click **Prove & seal bid**. Show the proving spinner ("Generating bidValidity
proof…"), then the success toast. Open the tx on stellar.expert:
> "Real transaction. The on-chain verifier checked the proof and recorded only the
> commitment — the amount never left my browser."

Seal 2 more bids at different amounts (the demo uses distinct ZK identities).

**1:35 — Settle, the payoff (40s)**
As the maker, click **Settle**.
> "Now the magic: one **auctionResult proof** shows the winner and the **Vickrey
> second-highest price** are correct — computed inside the circuit over exactly the
> sealed commitments. The losing bids are never opened."

Show the spinner ("Generating auctionResult proof…"), then the settle tx on
stellar.expert. Point at the contract: winner paid the clearing price, losers
refunded.

**2:15 — Prove it's real (20s)**
Sidebar → **Audit**. Click **Run poseidon_hash(1,2)**:
> "The contract computes Poseidon on-chain — identical to the circuit. Every
> contract and a real verify tx are linked here. Don't trust the deck, check the
> chain."

**2:35 — Close (10s)**
> "Segel: bids sealed, settlement proven, losers never seen — real ZK, real money
> movement, on Stellar."

---

### Tips
- Pre-fund via the **Faucet** tab before recording.
- If proving feels slow on camera, cut to the success state (it's ~3–8s/proof).
- Keep a stellar.expert tab open on the otc contract to show state changing.
