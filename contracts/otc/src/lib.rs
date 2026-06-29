#![no_std]

//! Segel — the confidential sealed-bid OTC desk contract.
//!
//! A maker posts an RFQ (pair, public size band, hidden-min, deadline). Takers
//! seal bids as Poseidon commitments and lock a good-faith USDC escrow; each bid
//! carries a `bidValidity` proof (in-band, funded, allow-listed, fresh nullifier)
//! that the contract verifies on-chain BEFORE recording it. At settlement the
//! maker submits one `auctionResult` proof that the announced winner + Vickrey
//! clearing price are correct over exactly the recorded commitments — every
//! losing bid stays hidden. The contract then pays the winner's clearing price to
//! the maker, refunds the winner's surplus, and refunds every loser in full.
//!
//! **Binding (the key security property).** The contract never accepts a
//! pre-built `Vec<Bn254Fr>`. For each proof it *builds* the public-input vector
//! itself, in circuit order, from typed values it controls — the bidder it
//! authenticated, the RFQ's band (which also pins the proof-of-funds input), and
//! the commitments it actually recorded. A caller cannot present a valid proof while
//! bidding a different amount, spoofing funds, or settling over a different bid
//! set: any mismatch changes the public inputs and verification fails.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    symbol_short, token::TokenClient, vec, Address, BytesN, Env, IntoVal, Symbol, Vec,
};

mod poseidon;
mod poseidon_constants;

const VERIFY: Symbol = symbol_short!("verify");

/// Fixed bid-slot count of the auctionResult circuit (empty slots are padded).
const N: u32 = 8;

/// Poseidon(0,0,0) — the canonical empty-slot commitment used to pad the auction
/// proof up to N. The prover pads identically. (circomlibjs poseidon([0,0,0]).)
const EMPTY_COMMIT: [u8; 32] = [
    0x0b, 0xc1, 0x88, 0xd2, 0x7d, 0xcc, 0xea, 0xdc, 0x1d, 0xcf, 0xb6, 0xaf, 0x0a, 0x7a, 0xf0, 0x8f,
    0xe2, 0x86, 0x4e, 0xec, 0xec, 0x96, 0xc5, 0xae, 0x7c, 0xee, 0x6d, 0xb3, 0x1b, 0xa5, 0x99, 0xaa,
];

// status codes
const ST_OPEN: u32 = 0;
const ST_SETTLED: u32 = 1;
const ST_CANCELLED: u32 = 2;

const TTL_THRESHOLD: u32 = 17_280;
const TTL_EXTEND: u32 = 535_680;

/// Groth16 proof — identical layout to the verifier's `Groth16Proof`.
#[contracttype]
#[derive(Clone)]
pub struct Groth16Proof {
    pub a: Bn254G1Affine,
    pub b: Bn254G2Affine,
    pub c: Bn254G1Affine,
}

/// SEP-40 oracle asset selector — layout-identical to Reflector's `Asset`.
#[contracttype]
#[derive(Clone)]
pub enum OracleAsset {
    Stellar(Address),
    Other(Symbol),
}

/// SEP-40 price record — layout-identical to Reflector's `PriceData`.
/// `price` is scaled by 10^decimals() (14 on the Reflector feeds).
#[contracttype]
#[derive(Clone)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Rfq {
    pub maker: Address,
    pub pair: Symbol,
    pub side: Symbol, // BUY / SELL
    pub mode: u32,    // 0 DIRECT, 1 RFQ
    pub band_min: i128,
    pub band_max: i128, // = the good-faith escrow each bidder locks
    pub deadline: u64,  // unix timestamp
    pub status: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct BidEntry {
    pub commit: BytesN<32>,
    pub bidder: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct Settlement {
    pub winner: Address,
    pub clearing: i128,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OtcError {
    UnknownRfq = 1,
    RfqClosed = 2,
    Expired = 3,
    NotExpired = 4,
    NullifierUsed = 5,
    TooManyBids = 6,
    InvalidAmount = 7,
    ProofRejected = 8,
    NotMaker = 9,
    BadClearing = 10,
    NoBids = 11,
    AlreadySettled = 12,
}

#[contracttype]
enum DataKey {
    Admin,
    Token,
    BidVerifier,
    AuctionVerifier,
    AspRoot,
    RfqCount,
    Oracle,
    Rfq(u32),
    BidCount(u32),
    Bid(u32, u32),
    Nullifier(u32, BytesN<32>),
    Settled(u32),
}

#[contract]
pub struct Otc;

#[contractimpl]
impl Otc {
    pub fn __constructor(
        env: Env,
        admin: Address,
        token: Address,
        bid_verifier: Address,
        auction_verifier: Address,
        asp_root: BytesN<32>,
        oracle: Address,
    ) {
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Token, &token);
        s.set(&DataKey::BidVerifier, &bid_verifier);
        s.set(&DataKey::AuctionVerifier, &auction_verifier);
        s.set(&DataKey::AspRoot, &asp_root);
        s.set(&DataKey::Oracle, &oracle);
        s.set(&DataKey::RfqCount, &0u32);
        Self::bump_instance(&env);
    }

    /// Admin-only: rotate the verifier contracts (e.g. replace a buggy verifier or
    /// migrate to an upgraded circuit). Without this the verifiers were immutable —
    /// a bad verifier could never be fixed. Guarded by the stored admin's auth.
    pub fn set_verifiers(env: Env, bid_verifier: Address, auction_verifier: Address) {
        Self::require_admin(&env);
        let s = env.storage().instance();
        s.set(&DataKey::BidVerifier, &bid_verifier);
        s.set(&DataKey::AuctionVerifier, &auction_verifier);
        Self::bump_instance(&env);
        env.events().publish((symbol_short!("setverif"),), (bid_verifier, auction_verifier));
    }

    /// Admin-only: hand the admin role to a new address (e.g. a multisig).
    pub fn set_admin(env: Env, new_admin: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Self::bump_instance(&env);
        env.events().publish((symbol_short!("setadmin"),), new_admin);
    }

    /// Admin-only: switch the escrow/settlement token (e.g. migrate the desk from
    /// the demo mock USDC to Circle's canonical USDC SAC). Only safe when no escrow
    /// is mid-flight in the previous token.
    pub fn set_token(env: Env, token: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Token, &token);
        Self::bump_instance(&env);
        env.events().publish((symbol_short!("settoken"),), token);
    }

    pub fn token_address(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    /// Admin-only: point the desk at a different SEP-40 oracle.
    pub fn set_oracle(env: Env, oracle: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        Self::bump_instance(&env);
        env.events().publish((symbol_short!("setoracle"),), oracle);
    }

    /// Admin-only: upgrade the contract WASM in place (keeps the same contract id,
    /// so logic fixes no longer require a fresh deployment + id migration).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::require_admin(&env);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Live market mark from the Reflector SEP-40 oracle: the USD price of `symbol`
    /// (e.g. "XLM" or "USDC"), scaled by 10^14. Lets makers/takers sanity-check a
    /// sealed auction against the real market, and is the basis for a future
    /// oracle-derived maker reserve. Read-only cross-contract call; returns None if
    /// no oracle is configured or the feed has no price for the symbol.
    pub fn mark_price(env: Env, symbol: Symbol) -> Option<PriceData> {
        let oracle: Address = env.storage().instance().get(&DataKey::Oracle)?;
        let asset = OracleAsset::Other(symbol);
        env.invoke_contract(
            &oracle,
            &Symbol::new(&env, "lastprice"),
            vec![&env, asset.into_val(&env)],
        )
    }

    pub fn oracle(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Oracle).unwrap()
    }

    /// Maker posts an RFQ. `band_max` doubles as the per-bidder good-faith escrow,
    /// so locking it leaks nothing (it is public). Returns the new RFQ id.
    pub fn post_rfq(
        env: Env,
        maker: Address,
        pair: Symbol,
        side: Symbol,
        mode: u32,
        band_min: i128,
        band_max: i128,
        deadline: u64,
    ) -> u32 {
        maker.require_auth();
        if band_min <= 0 || band_max <= band_min || band_max >= (1i128 << 64) {
            soroban_sdk::panic_with_error!(&env, OtcError::InvalidAmount);
        }
        let id: u32 = env.storage().instance().get(&DataKey::RfqCount).unwrap_or(0);
        let rfq = Rfq {
            maker,
            pair,
            side,
            mode,
            band_min,
            band_max,
            deadline,
            status: ST_OPEN,
        };
        env.storage().persistent().set(&DataKey::Rfq(id), &rfq);
        env.storage().persistent().set(&DataKey::BidCount(id), &0u32);
        env.storage().instance().set(&DataKey::RfqCount, &(id + 1));
        Self::bump_instance(&env);
        Self::bump(&env, &DataKey::Rfq(id));
        env.events().publish((symbol_short!("post"), id), rfq.maker);
        id
    }

    /// Seal a bid: verify the `bidValidity` proof, record the commitment, and lock
    /// the good-faith escrow. The contract pins the proof's public inputs itself —
    /// `availBal` is pinned to `band_max` and the escrow transfer below MUST
    /// succeed, so the hidden bid is bound to real funds (proof-of-funds); `bidder`
    /// is the authenticated account, so the commitment can't be forged for someone
    /// else.
    pub fn commit_bid(
        env: Env,
        from: Address,
        rfq_id: u32,
        commit: BytesN<32>,
        nullifier: BytesN<32>,
        proof: Groth16Proof,
    ) -> u32 {
        from.require_auth();
        let rfq: Rfq = Self::get_rfq(&env, rfq_id);
        if rfq.status != ST_OPEN {
            soroban_sdk::panic_with_error!(&env, OtcError::RfqClosed);
        }
        if env.ledger().timestamp() > rfq.deadline {
            soroban_sdk::panic_with_error!(&env, OtcError::Expired);
        }
        // one bid per identity per RFQ
        let nf_key = DataKey::Nullifier(rfq_id, nullifier.clone());
        if env.storage().persistent().has(&nf_key) {
            soroban_sdk::panic_with_error!(&env, OtcError::NullifierUsed);
        }

        // Proof-of-funds: availBal is pinned to band_max — the escrow the bidder
        // is about to lock. The token.transfer below MUST succeed, which proves the
        // bidder actually holds >= band_max >= bid. (Pinning to the live balance is
        // unstable: the proof is built off a balance read that can drift before the
        // contract re-reads it; the escrow transfer is the robust, atomic witness.)
        let avail = rfq.band_max;

        // public inputs in circuit order:
        // [commit, bandMin, bandMax, availBal, bidder, aspRoot, rfqId, nullifier]
        let asp_root: BytesN<32> = env.storage().instance().get(&DataKey::AspRoot).unwrap();
        let pi = vec![
            &env,
            Self::fr(&env, &commit),
            Self::field_u(&env, rfq.band_min),
            Self::field_u(&env, rfq.band_max),
            Self::field_u(&env, avail),
            Self::addr_field(&env, &from),
            Self::fr(&env, &asp_root),
            Self::field_u(&env, rfq_id as i128),
            Self::fr(&env, &nullifier),
        ];
        Self::verify(&env, DataKey::BidVerifier, &proof, &pi);

        let n: u32 = env.storage().persistent().get(&DataKey::BidCount(rfq_id)).unwrap_or(0);
        if n >= N {
            soroban_sdk::panic_with_error!(&env, OtcError::TooManyBids);
        }

        // Lock the good-faith escrow (= band_max).
        Self::token(&env).transfer(&from, &env.current_contract_address(), &rfq.band_max);

        env.storage().persistent().set(&nf_key, &());
        let entry = BidEntry { commit: commit.clone(), bidder: from.clone() };
        env.storage().persistent().set(&DataKey::Bid(rfq_id, n), &entry);
        env.storage().persistent().set(&DataKey::BidCount(rfq_id), &(n + 1));
        Self::bump_instance(&env);
        Self::bump(&env, &DataKey::Bid(rfq_id, n));
        Self::bump(&env, &DataKey::Nullifier(rfq_id, nullifier.clone()));
        env.events().publish((symbol_short!("bid"), rfq_id), (commit, n));
        n
    }

    /// Settle: verify ONE `auctionResult` proof that `winner`/`clearing` are the
    /// correct Vickrey outcome over exactly the recorded commitments, then move
    /// the money: winner pays `clearing` to the maker, gets `band_max - clearing`
    /// back, every loser is refunded `band_max`. Losing bid *amounts* never
    /// appear (winner address + clearing price are public).
    pub fn settle(
        env: Env,
        rfq_id: u32,
        proof: Groth16Proof,
        winner: Address,
        clearing: i128,
    ) {
        let mut rfq: Rfq = Self::get_rfq(&env, rfq_id);
        rfq.maker.require_auth();
        if rfq.status != ST_OPEN {
            soroban_sdk::panic_with_error!(&env, OtcError::AlreadySettled);
        }
        let count: u32 = env.storage().persistent().get(&DataKey::BidCount(rfq_id)).unwrap_or(0);
        if count == 0 {
            soroban_sdk::panic_with_error!(&env, OtcError::NoBids);
        }
        if clearing < 0 || clearing > rfq.band_max {
            soroban_sdk::panic_with_error!(&env, OtcError::BadClearing);
        }

        // Build the auction public inputs from the RECORDED set (binding), padded
        // to N with the canonical empty slot:
        // [rfqId, winnerAddr, clearing, commit[0..N], bidder[0..N]]
        let mut pi = vec![
            &env,
            Self::field_u(&env, rfq_id as i128),
            Self::addr_field(&env, &winner),
            Self::field_u(&env, clearing),
        ];
        let empty_commit = BytesN::from_array(&env, &EMPTY_COMMIT);
        let zero = BytesN::from_array(&env, &[0u8; 32]);
        let mut i = 0u32;
        while i < N {
            if i < count {
                let e: BidEntry = env.storage().persistent().get(&DataKey::Bid(rfq_id, i)).unwrap();
                pi.push_back(Self::fr(&env, &e.commit));
            } else {
                pi.push_back(Self::fr(&env, &empty_commit));
            }
            i += 1;
        }
        i = 0;
        while i < N {
            if i < count {
                let e: BidEntry = env.storage().persistent().get(&DataKey::Bid(rfq_id, i)).unwrap();
                pi.push_back(Self::addr_field(&env, &e.bidder));
            } else {
                pi.push_back(Self::fr(&env, &zero));
            }
            i += 1;
        }
        Self::verify(&env, DataKey::AuctionVerifier, &proof, &pi);

        // Move the money.
        let contract = env.current_contract_address();
        let token = Self::token(&env);
        if clearing > 0 {
            token.transfer(&contract, &rfq.maker, &clearing);
        }
        let surplus = rfq.band_max - clearing;
        if surplus > 0 {
            token.transfer(&contract, &winner, &surplus);
        }
        // refund every non-winner in full
        let mut j = 0u32;
        while j < count {
            let e: BidEntry = env.storage().persistent().get(&DataKey::Bid(rfq_id, j)).unwrap();
            if e.bidder != winner {
                token.transfer(&contract, &e.bidder, &rfq.band_max);
            }
            j += 1;
        }

        rfq.status = ST_SETTLED;
        env.storage().persistent().set(&DataKey::Rfq(rfq_id), &rfq);
        env.storage().persistent().set(
            &DataKey::Settled(rfq_id),
            &Settlement { winner: winner.clone(), clearing },
        );
        Self::bump_instance(&env);
        Self::bump(&env, &DataKey::Settled(rfq_id));
        env.events().publish((symbol_short!("settle"), rfq_id), (winner, clearing));
    }

    /// Anyone may clean up an expired, unsettled RFQ: refund every bidder's escrow
    /// and mark it cancelled.
    pub fn cancel_expired(env: Env, rfq_id: u32) {
        let mut rfq: Rfq = Self::get_rfq(&env, rfq_id);
        if rfq.status != ST_OPEN {
            soroban_sdk::panic_with_error!(&env, OtcError::RfqClosed);
        }
        if env.ledger().timestamp() <= rfq.deadline {
            soroban_sdk::panic_with_error!(&env, OtcError::NotExpired);
        }
        let count: u32 = env.storage().persistent().get(&DataKey::BidCount(rfq_id)).unwrap_or(0);
        let contract = env.current_contract_address();
        let token = Self::token(&env);
        let mut j = 0u32;
        while j < count {
            let e: BidEntry = env.storage().persistent().get(&DataKey::Bid(rfq_id, j)).unwrap();
            token.transfer(&contract, &e.bidder, &rfq.band_max);
            j += 1;
        }
        rfq.status = ST_CANCELLED;
        env.storage().persistent().set(&DataKey::Rfq(rfq_id), &rfq);
        Self::bump_instance(&env);
        env.events().publish((symbol_short!("cancel"), rfq_id), count);
    }

    /// On-chain Poseidon(2) computed with BN254 host field ops — returns the SAME
    /// hash circomlib/the circuits use, so the commitment scheme is verifiable
    /// on-chain rather than merely asserted. (Shown on the Audit surface.)
    pub fn poseidon_hash(env: Env, a: BytesN<32>, b: BytesN<32>) -> BytesN<32> {
        poseidon::hash2(&env, &a, &b)
    }

    // ---------- views ----------
    pub fn rfq_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::RfqCount).unwrap_or(0)
    }
    pub fn get_rfq_view(env: Env, id: u32) -> Rfq {
        Self::get_rfq(&env, id)
    }
    pub fn bid_count(env: Env, rfq_id: u32) -> u32 {
        env.storage().persistent().get(&DataKey::BidCount(rfq_id)).unwrap_or(0)
    }
    /// Recorded sealed-bid commitments for an RFQ (reconstruct the desk from state).
    pub fn bids(env: Env, rfq_id: u32) -> Vec<BytesN<32>> {
        let n: u32 = env.storage().persistent().get(&DataKey::BidCount(rfq_id)).unwrap_or(0);
        let mut out = vec![&env];
        let mut i = 0u32;
        while i < n {
            let e: BidEntry = env.storage().persistent().get(&DataKey::Bid(rfq_id, i)).unwrap();
            out.push_back(e.commit);
            i += 1;
        }
        out
    }
    pub fn is_nullifier_used(env: Env, rfq_id: u32, nullifier: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Nullifier(rfq_id, nullifier))
    }
    pub fn settlement(env: Env, rfq_id: u32) -> Option<Settlement> {
        env.storage().persistent().get(&DataKey::Settled(rfq_id))
    }
    pub fn balance(env: Env) -> i128 {
        Self::token(&env).balance(&env.current_contract_address())
    }
    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }
    /// Currently wired verifier contracts (bid, auction).
    pub fn verifiers(env: Env) -> (Address, Address) {
        let s = env.storage().instance();
        (s.get(&DataKey::BidVerifier).unwrap(), s.get(&DataKey::AuctionVerifier).unwrap())
    }

    // ---------- internals ----------
    fn get_rfq(env: &Env, id: u32) -> Rfq {
        match env.storage().persistent().get(&DataKey::Rfq(id)) {
            Some(r) => r,
            None => soroban_sdk::panic_with_error!(env, OtcError::UnknownRfq),
        }
    }
    fn token(env: &Env) -> TokenClient {
        let addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        TokenClient::new(env, &addr)
    }
    fn fr(_env: &Env, b: &BytesN<32>) -> Bn254Fr {
        Bn254Fr::from_bytes(b.clone())
    }
    /// 32-byte big-endian field encoding of a non-negative i128.
    fn field_u(env: &Env, v: i128) -> Bn254Fr {
        let mut buf = [0u8; 32];
        let be = v.to_be_bytes(); // 16 bytes
        let mut i = 0;
        while i < 16 {
            buf[16 + i] = be[i];
            i += 1;
        }
        Bn254Fr::from_bytes(BytesN::from_array(env, &buf))
    }
    /// field(addr) = keccak256(addr XDR) reduced mod r — the bidder key pinned into
    /// the proof. The browser derives it identically.
    fn addr_field(env: &Env, addr: &Address) -> Bn254Fr {
        use soroban_sdk::xdr::ToXdr;
        let h = env.crypto().keccak256(&addr.clone().to_xdr(env));
        Bn254Fr::from_bytes(h.to_bytes())
    }
    fn bump(env: &Env, key: &DataKey) {
        env.storage().persistent().extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND);
    }
    /// Extend the instance TTL so the contract's config (admin, token, verifiers,
    /// asp_root, rfq_count) never expires while the desk is in use. Previously the
    /// instance was never bumped — on a live network it could expire and brick.
    fn bump_instance(env: &Env) {
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
    }
    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }
    fn verify(env: &Env, which: DataKey, proof: &Groth16Proof, public_inputs: &Vec<Bn254Fr>) {
        let verifier: Address = env.storage().instance().get(&which).unwrap();
        let ok: bool = env.invoke_contract(
            &verifier,
            &VERIFY,
            vec![env, proof.into_val(env), public_inputs.into_val(env)],
        );
        if !ok {
            soroban_sdk::panic_with_error!(env, OtcError::ProofRejected);
        }
    }
}

#[cfg(test)]
mod test;
