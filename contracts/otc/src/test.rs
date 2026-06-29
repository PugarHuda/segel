#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    symbol_short, Address, BytesN, Env, Vec,
};

// Stub verifier that accepts every proof — lets us unit-test the desk's own logic
// (escrow custody, nullifier set, winner payout, refunds, status machine).
#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify(_e: Env, _p: Groth16Proof, _pi: Vec<Bn254Fr>) -> bool {
        true
    }
}

// Stub SEP-40 oracle returning a fixed XLM/USD mark (matches a real Reflector
// reading at build time: 0.1765 USD, 14 decimals).
#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn lastprice(_e: Env, _asset: OracleAsset) -> Option<PriceData> {
        Some(PriceData { price: 17650630646589, timestamp: 1782484500 })
    }
}

// Minimal SEP-41-shaped token whose `transfer` TRAPS when paying a designated
// `blocked` address — simulates a bidder who dropped their USDC trustline. Lets us
// prove a failing refund is credited as claimable instead of bricking settlement.
#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn __constructor(e: Env, blocked: Address) {
        e.storage().instance().set(&symbol_short!("blocked"), &blocked);
    }
    pub fn unblock(e: Env) {
        e.storage().instance().remove(&symbol_short!("blocked"));
    }
    pub fn mint(e: Env, to: Address, amt: i128) {
        let b: i128 = e.storage().persistent().get(&to).unwrap_or(0);
        e.storage().persistent().set(&to, &(b + amt));
    }
    pub fn balance(e: Env, id: Address) -> i128 {
        e.storage().persistent().get(&id).unwrap_or(0)
    }
    pub fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        let blocked: Option<Address> = e.storage().instance().get(&symbol_short!("blocked"));
        if blocked == Some(to.clone()) {
            panic!("recipient cannot receive (no trustline)");
        }
        let fb: i128 = e.storage().persistent().get(&from).unwrap_or(0);
        e.storage().persistent().set(&from, &(fb - amount));
        let tb: i128 = e.storage().persistent().get(&to).unwrap_or(0);
        e.storage().persistent().set(&to, &(tb + amount));
    }
}

fn b32(env: &Env, k: u8) -> BytesN<32> {
    BytesN::from_array(env, &[k; 32])
}
fn b32_dec(env: &Env, n: u8) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[31] = n;
    BytesN::from_array(env, &a)
}
fn dummy_proof(env: &Env) -> Groth16Proof {
    Groth16Proof {
        a: Bn254G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 64])),
        b: Bn254G2Affine::from_bytes(BytesN::from_array(env, &[0u8; 128])),
        c: Bn254G1Affine::from_bytes(BytesN::from_array(env, &[0u8; 64])),
    }
}

struct Ctx {
    otc: OtcClient<'static>,
    token: TokenClient<'static>,
    sac: StellarAssetClient<'static>,
    maker: Address,
    admin: Address,
    verifier: Address,
}

fn setup(env: &Env) -> Ctx {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let maker = Address::generate(env);
    let v = env.register(MockVerifier, ());
    let oracle = env.register(MockOracle, ());
    let sac_obj = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac_obj.address();
    let id = env.register(
        Otc,
        (admin.clone(), token_addr.clone(), v.clone(), v.clone(), b32(env, 100), oracle.clone()),
    );
    Ctx {
        otc: OtcClient::new(env, &id),
        token: TokenClient::new(env, &token_addr),
        sac: StellarAssetClient::new(env, &token_addr),
        maker,
        admin,
        verifier: v,
    }
}

fn bidder(env: &Env, c: &Ctx, bal: i128) -> Address {
    let a = Address::generate(env);
    c.sac.mint(&a, &bal);
    a
}

// The on-chain Poseidon is bitwise-identical to circomlibjs poseidon([1,2]).
#[test]
fn poseidon_matches_circomlib() {
    let env = Env::default();
    let got = crate::poseidon::hash2(&env, &b32_dec(&env, 1), &b32_dec(&env, 2));
    let want = BytesN::from_array(
        &env,
        &[
            0x11, 0x5c, 0xc0, 0xf5, 0xe7, 0xd6, 0x90, 0x41, 0x3d, 0xf6, 0x4c, 0x6b, 0x96, 0x62,
            0xe9, 0xcf, 0x2a, 0x36, 0x17, 0xf2, 0x74, 0x32, 0x45, 0x51, 0x9e, 0x19, 0x60, 0x7a,
            0x44, 0x17, 0x18, 0x9a,
        ],
    );
    assert_eq!(got, want);
}

#[test]
fn post_rfq_creates_open_rfq() {
    let env = Env::default();
    let c = setup(&env);
    let id = c.otc.post_rfq(
        &c.maker, &symbol_short!("XLMUSDC"), &symbol_short!("SELL"), &1, &100, &500, &1000,
    );
    assert_eq!(id, 0);
    assert_eq!(c.otc.rfq_count(), 1);
    let r = c.otc.get_rfq_view(&0);
    assert_eq!(r.status, ST_OPEN);
    assert_eq!(r.band_max, 500);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")] // InvalidAmount
fn post_rfq_rejects_bad_band() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.post_rfq(&c.maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &500, &100, &1000);
}

#[test]
fn commit_bid_locks_escrow_and_records() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.post_rfq(&c.maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &100, &500, &1000);
    let t = bidder(&env, &c, 1000);
    let idx = c.otc.commit_bid(&t, &0, &b32(&env, 1), &b32(&env, 11), &dummy_proof(&env));
    assert_eq!(idx, 0);
    assert_eq!(c.otc.bid_count(&0), 1);
    assert_eq!(c.token.balance(&t), 500); // 500 escrow locked
    assert_eq!(c.otc.balance(), 500);
    assert!(c.otc.is_nullifier_used(&0, &b32(&env, 11)));
    assert_eq!(c.otc.bids(&0).len(), 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // NullifierUsed
fn commit_bid_rejects_duplicate_nullifier() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.post_rfq(&c.maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &100, &500, &1000);
    let t = bidder(&env, &c, 2000);
    c.otc.commit_bid(&t, &0, &b32(&env, 1), &b32(&env, 11), &dummy_proof(&env));
    c.otc.commit_bid(&t, &0, &b32(&env, 2), &b32(&env, 11), &dummy_proof(&env));
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")] // Expired
fn commit_bid_rejects_after_deadline() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.post_rfq(&c.maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &100, &500, &1000);
    env.ledger().with_mut(|li| li.timestamp = 2000);
    let t = bidder(&env, &c, 1000);
    c.otc.commit_bid(&t, &0, &b32(&env, 1), &b32(&env, 11), &dummy_proof(&env));
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")] // TooManyBids
fn commit_bid_rejects_over_capacity() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.post_rfq(&c.maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &100, &500, &1000);
    // N = 8 slots, the 9th bid is rejected.
    let mut k = 0u8;
    while k < 9 {
        let t = bidder(&env, &c, 1000);
        c.otc.commit_bid(&t, &0, &b32(&env, k + 1), &b32(&env, 100 + k), &dummy_proof(&env));
        k += 1;
    }
}

#[test]
fn settle_pays_winner_refunds_losers() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.post_rfq(&c.maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &100, &500, &1000);
    let w = bidder(&env, &c, 1000);
    let l1 = bidder(&env, &c, 1000);
    let l2 = bidder(&env, &c, 1000);
    c.otc.commit_bid(&w, &0, &b32(&env, 1), &b32(&env, 11), &dummy_proof(&env));
    c.otc.commit_bid(&l1, &0, &b32(&env, 2), &b32(&env, 12), &dummy_proof(&env));
    c.otc.commit_bid(&l2, &0, &b32(&env, 3), &b32(&env, 13), &dummy_proof(&env));
    assert_eq!(c.otc.balance(), 1500); // 3 x 500 escrow

    // Vickrey clearing = 300 (proof is mocked, so we just exercise the money flow).
    c.otc.settle(&0, &dummy_proof(&env), &w, &300);

    assert_eq!(c.token.balance(&c.maker), 300); // winner pays clearing to maker
    assert_eq!(c.token.balance(&w), 1000 - 500 + 200); // surplus 500-300 refunded
    assert_eq!(c.token.balance(&l1), 1000); // loser fully refunded
    assert_eq!(c.token.balance(&l2), 1000);
    assert_eq!(c.otc.balance(), 0);
    let s = c.otc.settlement(&0).unwrap();
    assert_eq!(s.clearing, 300);
    assert_eq!(s.winner, w);
    assert_eq!(c.otc.get_rfq_view(&0).status, ST_SETTLED);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")] // BadClearing
fn settle_rejects_clearing_over_band() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.post_rfq(&c.maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &100, &500, &1000);
    let w = bidder(&env, &c, 1000);
    c.otc.commit_bid(&w, &0, &b32(&env, 1), &b32(&env, 11), &dummy_proof(&env));
    c.otc.settle(&0, &dummy_proof(&env), &w, &600); // > band_max 500
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")] // BadClearing — below reserve (band_min)
fn settle_rejects_clearing_below_reserve() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.post_rfq(&c.maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &100, &500, &1000);
    let w = bidder(&env, &c, 1000);
    c.otc.commit_bid(&w, &0, &b32(&env, 1), &b32(&env, 11), &dummy_proof(&env));
    // a lone bidder's Vickrey runner-up is a padded 0; clearing below band_min (100)
    // — including the degenerate 0 — must be rejected (the reserve).
    c.otc.settle(&0, &dummy_proof(&env), &w, &50);
}

// Finding-1 fix: a bidder who can't receive the refund (no/blocked trustline) does
// NOT brick settlement — their refund is credited as claimable and pulled later.
#[test]
fn failed_refund_becomes_claimable_then_claimed() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let maker = Address::generate(&env);
    let v = env.register(MockVerifier, ());
    let oracle = env.register(MockOracle, ());
    let w = Address::generate(&env);
    let l = Address::generate(&env);
    // token that refuses to pay `l` — simulates l's dropped USDC trustline.
    let tok = env.register(MockToken, (l.clone(),));
    let token = MockTokenClient::new(&env, &tok);
    token.mint(&w, &1000);
    token.mint(&l, &1000);
    let id = env.register(
        Otc,
        (admin, tok.clone(), v.clone(), v.clone(), b32(&env, 100), oracle),
    );
    let otc = OtcClient::new(&env, &id);
    otc.post_rfq(&maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &100, &500, &1000);
    otc.commit_bid(&w, &0, &b32(&env, 1), &b32(&env, 11), &dummy_proof(&env));
    otc.commit_bid(&l, &0, &b32(&env, 2), &b32(&env, 12), &dummy_proof(&env));
    assert_eq!(otc.balance(), 1000); // 2 x 500 escrow

    // l's refund will trap, but settlement must still complete.
    otc.settle(&0, &dummy_proof(&env), &w, &300);
    assert_eq!(otc.get_rfq_view(&0).status, ST_SETTLED);
    assert_eq!(token.balance(&maker), 300); // maker paid
    assert_eq!(token.balance(&w), 700); // winner: 1000 - 500 escrow + 200 surplus
    assert_eq!(otc.claimable(&0, &l), 500); // loser refund CREDITED, not lost
    assert_eq!(token.balance(&l), 500); // not yet refunded (still 1000-500)

    // l fixes their trustline and pulls the refund.
    token.unblock();
    otc.claim(&0, &l);
    assert_eq!(token.balance(&l), 1000);
    assert_eq!(otc.claimable(&0, &l), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")] // NothingToClaim
fn claim_nothing_rejected() {
    let env = Env::default();
    let c = setup(&env);
    let a = Address::generate(&env);
    c.otc.claim(&0, &a);
}

// Two-asset delivery-vs-payment: the maker escrows a sell-side lot at post time;
// at settle the winner receives that lot atomically against paying the clearing
// price. The "OTC desk" is now a real swap, not a one-sided payment.
#[test]
fn dvp_delivers_base_to_winner() {
    let env = Env::default();
    let c = setup(&env);
    // a SECOND asset = the sell-side lot the maker delivers (e.g. XLM-for-USDC).
    let base_obj = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let base_addr = base_obj.address();
    let base = TokenClient::new(&env, &base_addr);
    StellarAssetClient::new(&env, &base_addr).mint(&c.maker, &1000);

    let id = c.otc.post_rfq_dvp(
        &c.maker, &symbol_short!("XLMUSDC"), &symbol_short!("SELL"), &1,
        &100, &500, &1000, &base_addr, &800,
    );
    assert_eq!(base.balance(&c.maker), 200); // 800 lot escrowed at post
    assert_eq!(base.balance(&c.otc.address), 800); // held by the desk
    assert_eq!(c.otc.base_leg(&id).unwrap().amount, 800);

    let w = bidder(&env, &c, 1000);
    let l = bidder(&env, &c, 1000);
    c.otc.commit_bid(&w, &id, &b32(&env, 1), &b32(&env, 11), &dummy_proof(&env));
    c.otc.commit_bid(&l, &id, &b32(&env, 2), &b32(&env, 12), &dummy_proof(&env));
    c.otc.settle(&id, &dummy_proof(&env), &w, &300);

    assert_eq!(c.token.balance(&c.maker), 300); // maker paid clearing in USDC (quote)
    assert_eq!(base.balance(&w), 800); // winner RECEIVED the sell-side lot (delivery)
    assert_eq!(base.balance(&c.otc.address), 0); // desk delivered all base
    assert!(c.otc.base_leg(&id).is_none()); // leg cleared after delivery
    assert_eq!(c.token.balance(&w), 700); // quote: 1000 - 500 escrow + 200 surplus
    assert_eq!(c.token.balance(&l), 1000); // loser refunded
}

#[test]
fn dvp_cancel_returns_base_to_maker() {
    let env = Env::default();
    let c = setup(&env);
    let base_obj = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let base_addr = base_obj.address();
    let base = TokenClient::new(&env, &base_addr);
    StellarAssetClient::new(&env, &base_addr).mint(&c.maker, &1000);

    let id = c.otc.post_rfq_dvp(
        &c.maker, &symbol_short!("XLMUSDC"), &symbol_short!("SELL"), &1,
        &100, &500, &1000, &base_addr, &800,
    );
    let t = bidder(&env, &c, 1000);
    c.otc.commit_bid(&t, &id, &b32(&env, 1), &b32(&env, 11), &dummy_proof(&env));
    env.ledger().with_mut(|li| li.timestamp = 2000);
    c.otc.cancel_expired(&id);
    assert_eq!(base.balance(&c.maker), 1000); // sell-side lot returned to the maker
    assert!(c.otc.base_leg(&id).is_none()); // leg cleared after refund
    assert_eq!(c.token.balance(&t), 1000); // bidder refunded
    assert_eq!(c.otc.get_rfq_view(&id).status, ST_CANCELLED);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")] // AlreadySettled
fn settle_twice_rejected() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.post_rfq(&c.maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &100, &500, &1000);
    let w = bidder(&env, &c, 1000);
    c.otc.commit_bid(&w, &0, &b32(&env, 1), &b32(&env, 11), &dummy_proof(&env));
    c.otc.settle(&0, &dummy_proof(&env), &w, &200);
    c.otc.settle(&0, &dummy_proof(&env), &w, &200);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // NoBids
fn settle_with_no_bids_rejected() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.post_rfq(&c.maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &100, &500, &1000);
    let w = bidder(&env, &c, 1000);
    c.otc.settle(&0, &dummy_proof(&env), &w, &200);
}

#[test]
fn cancel_expired_refunds_everyone() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.post_rfq(&c.maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &100, &500, &1000);
    let t1 = bidder(&env, &c, 1000);
    let t2 = bidder(&env, &c, 1000);
    c.otc.commit_bid(&t1, &0, &b32(&env, 1), &b32(&env, 11), &dummy_proof(&env));
    c.otc.commit_bid(&t2, &0, &b32(&env, 2), &b32(&env, 12), &dummy_proof(&env));
    env.ledger().with_mut(|li| li.timestamp = 2000);
    c.otc.cancel_expired(&0);
    assert_eq!(c.token.balance(&t1), 1000);
    assert_eq!(c.token.balance(&t2), 1000);
    assert_eq!(c.otc.balance(), 0);
    assert_eq!(c.otc.get_rfq_view(&0).status, ST_CANCELLED);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")] // NotExpired
fn cancel_before_deadline_rejected() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.post_rfq(&c.maker, &symbol_short!("X"), &symbol_short!("SELL"), &1, &100, &500, &1000);
    c.otc.cancel_expired(&0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")] // UnknownRfq
fn unknown_rfq_rejected() {
    let env = Env::default();
    let c = setup(&env);
    c.otc.get_rfq_view(&99);
}

// B1: the admin can rotate the (previously immutable) verifiers and hand over the
// admin role, so a buggy verifier can be replaced instead of bricking the desk.
#[test]
fn admin_can_rotate_verifiers_and_admin() {
    let env = Env::default();
    let c = setup(&env);
    assert_eq!(c.otc.admin(), c.admin);
    let (vb, va) = c.otc.verifiers();
    assert_eq!(vb, c.verifier);
    assert_eq!(va, c.verifier);

    let nb = Address::generate(&env);
    let na = Address::generate(&env);
    c.otc.set_verifiers(&nb, &na);
    let (vb2, va2) = c.otc.verifiers();
    assert_eq!(vb2, nb);
    assert_eq!(va2, na);

    let new_admin = Address::generate(&env);
    c.otc.set_admin(&new_admin);
    assert_eq!(c.otc.admin(), new_admin);
}

// Admin can migrate the escrow token (e.g. mock USDC -> Circle's USDC SAC).
#[test]
fn admin_can_set_token() {
    let env = Env::default();
    let c = setup(&env);
    let new_token = Address::generate(&env);
    c.otc.set_token(&new_token);
    assert_eq!(c.otc.token_address(), new_token);
}

// Reflector integration: mark_price() does a real cross-contract SEP-40 read.
#[test]
fn mark_price_reads_oracle() {
    let env = Env::default();
    let c = setup(&env);
    let p = c.otc.mark_price(&symbol_short!("XLM")).unwrap();
    assert_eq!(p.price, 17650630646589);
    assert_eq!(p.timestamp, 1782484500);
}
