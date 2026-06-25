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
}

fn setup(env: &Env) -> Ctx {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let maker = Address::generate(env);
    let v = env.register(MockVerifier, ());
    let sac_obj = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac_obj.address();
    let id = env.register(
        Otc,
        (admin, token_addr.clone(), v.clone(), v.clone(), b32(env, 100)),
    );
    Ctx {
        otc: OtcClient::new(env, &id),
        token: TokenClient::new(env, &token_addr),
        sac: StellarAssetClient::new(env, &token_addr),
        maker,
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
