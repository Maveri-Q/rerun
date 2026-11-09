//! Unit tests in near-sdk's mocked blockchain. They cover the full lifecycle per outcome,
//! the challenge paths, attacks the contract must block, stale refunds, pause semantics,
//! storage accounting, points mode, and money mode through `ft_on_transfer`.

use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken, PromiseError};

use crate::fpmm::Side;
use crate::spec::tests::{canonical, sample_spec};
use crate::types::*;
use crate::Contract;

const T0: u64 = 1_800_000_000; // unix seconds
const UNIT: u128 = 1_000_000;
const CODEHASH: &str = "c0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0de";
const LAB_KEY: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const WINDOW: u64 = 600;

fn a(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, deposit: NearToken, now: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(a("rerun.testnet"))
        .predecessor_account_id(a(predecessor))
        .signer_account_id(a(predecessor))
        .attached_deposit(deposit)
        .account_balance(NearToken::from_near(1_000))
        .block_timestamp(now * 1_000_000_000);
    testing_env!(b.build());
}

fn as_(predecessor: &str, now: u64) {
    ctx(predecessor, NearToken::from_yoctonear(0), now);
}

fn paying(predecessor: &str, now: u64) {
    ctx(predecessor, NearToken::from_millinear(500), now);
}

struct World {
    c: Contract,
    id: u64,
    lock: u64,
}

fn contract() -> Contract {
    as_("owner.testnet", T0);
    let mut c = Contract::new(a("owner.testnet"), a("tusdc.testnet"), a("treasury.testnet"), a("labfees.testnet"));
    c.approve_codehash(CODEHASH.into());
    c.register_lab_local(a("lab.testnet"), CODEHASH.into(), LAB_KEY.into());
    c
}

/// A funded points market with alice holding YES and bob holding NO.
fn world() -> World {
    let mut c = contract();
    for who in ["creator.testnet", "alice.testnet", "bob.testnet", "carol.testnet"] {
        paying(who, T0);
        c.claim_points();
    }
    let lock = T0 + 3_600;
    paying("creator.testnet", T0);
    let id = c.create_market(canonical(&sample_spec()), lock, WINDOW, Mode::Points);
    paying("creator.testnet", T0);
    c.fund_market(id, U128(100 * UNIT));
    paying("alice.testnet", T0 + 10);
    c.buy(id, Side::Yes, U128(50 * UNIT), U128(0));
    paying("bob.testnet", T0 + 20);
    c.buy(id, Side::No, U128(20 * UNIT), U128(0));
    World { c, id, lock }
}

fn receipt(w: &World, outcome: Outcome, measured: Option<&str>, run_index: u8, model: &str) -> Receipt {
    let m = w.c.get_market(w.id).unwrap().market;
    Receipt {
        market_id: w.id,
        spec_hash: m.spec.spec_hash.clone(),
        outcome,
        invalid_reason: None,
        measured_value: measured.map(String::from),
        reported_value: m.spec.reported_value.clone(),
        tolerance: format!("{}:{}", m.spec.tolerance_kind, m.spec.tolerance_value),
        commit: m.spec.commit.clone(),
        data_hashes: m.spec.data_hashes.clone(),
        env_lock_hash: "e".repeat(64),
        patches: vec![Patch { file: "requirements.txt".into(), kind: PatchKind::Dependency, diff_hash: "d".repeat(64) }],
        patches_diff_excerpt: "-numpy==1.19\n+numpy==1.26".into(),
        log_hash: "1".repeat(64),
        log_tail: "accuracy=0.915".into(),
        full_log_uri: "https://logs.example/1".into(),
        report_hash: "2".repeat(64),
        report_uri: "https://logs.example/1/report".into(),
        runtime_secs: 42,
        exit_code: 0,
        lab_codehash: CODEHASH.into(),
        lab_account: a("lab.testnet"),
        nearai: NearAiInfo { model_id: model.into(), attestation_digest: "3".repeat(64), response_signature_refs: vec!["chat-1".into()] },
        run_index,
        started_at: w.lock + 1,
        finished_at: w.lock + 50,
    }
}

/// Lock, run, propose. Returns the time just after the proposal.
fn propose(w: &mut World, make: impl FnOnce(&World) -> Receipt) -> u64 {
    let r = make(w);
    as_("anyone.testnet", w.lock);
    w.c.lock(w.id);
    as_("lab.testnet", w.lock + 1);
    w.c.start_run(w.id);
    paying("lab.testnet", w.lock + 60);
    w.c.propose_result(r);
    w.lock + 60
}

fn points(c: &Contract, who: &str) -> u128 {
    c.get_balance(a(who), Mode::Points).0
}

fn state(w: &World) -> State {
    w.c.get_market(w.id).unwrap().market.state
}

fn redeem_all(w: &mut World, t: u64) -> u128 {
    let mut total = 0;
    for who in ["alice.testnet", "bob.testnet", "creator.testnet", "carol.testnet"] {
        paying(who, t);
        total += w.c.redeem(w.id).0;
    }
    total
}

// ------------------------------------------------------------------ happy paths

#[test]
fn reproduced_market_pays_yes_holders() {
    let mut w = world();
    let alice_yes = w.c.get_position(a("alice.testnet"), w.id).unwrap().position.yes.0;
    let creator_before = points(&w.c, "creator.testnet");
    let t = propose(&mut w, |w| receipt(w, Outcome::Reproduced, Some("0.915"), 0, "z-ai/glm-5.3-flash"));
    assert_eq!(state(&w), State::Proposed);
    assert_eq!(points(&w.c, "labfees.testnet"), 10 * UNIT, "reproduction fee paid on proposal");

    as_("anyone.testnet", t + WINDOW);
    w.c.finalize(w.id);
    let m = w.c.get_market(w.id).unwrap().market;
    assert_eq!(m.outcome, Some(Outcome::Reproduced));
    assert_eq!(points(&w.c, "creator.testnet"), creator_before + 50 * UNIT, "creation bond refunded");

    let alice_before = points(&w.c, "alice.testnet");
    paying("alice.testnet", t + WINDOW);
    assert_eq!(w.c.redeem(w.id).0, alice_yes);
    assert_eq!(points(&w.c, "alice.testnet"), alice_before + alice_yes);
    paying("bob.testnet", t + WINDOW);
    assert_eq!(w.c.redeem(w.id).0, 0, "NO holders get nothing");
    let stats = w.c.get_stats();
    assert_eq!(stats.stats.reproduced, 1);
    assert_eq!(stats.reproduction_rate_bps, Some(10_000));
}

#[test]
fn not_reproduced_market_pays_no_holders() {
    let mut w = world();
    let bob_no = w.c.get_position(a("bob.testnet"), w.id).unwrap().position.no.0;
    let t = propose(&mut w, |w| receipt(w, Outcome::NotReproduced, Some("0.85"), 0, "m1"));
    as_("anyone.testnet", t + WINDOW);
    w.c.finalize(w.id);
    paying("bob.testnet", t + WINDOW);
    assert_eq!(w.c.redeem(w.id).0, bob_no);
    paying("alice.testnet", t + WINDOW);
    assert_eq!(w.c.redeem(w.id).0, 0);
}

#[test]
fn broken_market_pays_no_holders() {
    let mut w = world();
    let mut r = receipt(&w, Outcome::Broken, None, 0, "m1");
    r.exit_code = 1;
    let t = propose(&mut w, |_| r);
    as_("anyone.testnet", t + WINDOW);
    w.c.finalize(w.id);
    assert_eq!(w.c.get_market(w.id).unwrap().market.outcome, Some(Outcome::Broken));
    assert_eq!(w.c.get_stats().stats.broken, 1);
}

#[test]
fn payouts_never_exceed_collateral() {
    let mut w = world();
    paying("carol.testnet", T0 + 30);
    w.c.buy(w.id, Side::Yes, U128(7 * UNIT), U128(0));
    let carol_yes = w.c.get_position(a("carol.testnet"), w.id).unwrap().position.yes.0;
    paying("carol.testnet", T0 + 40);
    w.c.sell(w.id, Side::Yes, U128(carol_yes / 2), U128(0));
    paying("carol.testnet", T0 + 50);
    w.c.add_liquidity(w.id, U128(30 * UNIT));
    let t = propose(&mut w, |w| receipt(w, Outcome::Reproduced, Some("0.912"), 0, "m1"));
    as_("anyone.testnet", t + WINDOW);
    w.c.finalize(w.id);
    let collateral = w.c.get_market(w.id).unwrap().market.collateral.0;
    let paid = redeem_all(&mut w, t + WINDOW);
    assert!(paid <= collateral, "paid {paid} of {collateral}");
    assert!(collateral - paid < 10, "only rounding dust is left: {}", collateral - paid);
    assert!(w.c.get_market(w.id).unwrap().market.lp_fees.0 < 10, "LP fees were paid out");
}

#[test]
fn lp_fees_accrue_to_liquidity_providers() {
    let mut w = world();
    let pending = w.c.get_position(a("creator.testnet"), w.id).unwrap().pending_lp_fees.0;
    // 1% fee on 70 traded, 80% of it to LPs = 0.56; the creator is the only LP.
    assert_eq!(pending, 70 * UNIT / 100 * 8 / 10);
    assert_eq!(points(&w.c, "treasury.testnet"), 70 * UNIT / 100 * 2 / 10);
}

#[test]
fn price_moves_and_history_is_recorded() {
    let w = world();
    let m = w.c.get_market(w.id).unwrap();
    assert!(m.yes_price_ppm > 500_000, "net YES buying moved the price up: {}", m.yes_price_ppm);
    assert_eq!(w.c.get_price_history(w.id).len(), 3);
    assert_eq!(w.c.get_account_markets(a("alice.testnet")), vec![w.id]);
}

// ------------------------------------------------------------------ challenge paths

#[test]
fn challenge_with_agreeing_rerun_keeps_result_and_forfeits_bond() {
    let mut w = world();
    let t = propose(&mut w, |w| receipt(w, Outcome::Reproduced, Some("0.915"), 0, "m1"));
    let carol_before = points(&w.c, "carol.testnet");
    paying("carol.testnet", t + 10);
    w.c.challenge(w.id, ChallengeReason::WrongExtraction, "a".repeat(64));
    assert_eq!(state(&w), State::Challenged);
    let bond = carol_before - points(&w.c, "carol.testnet");
    assert!(bond >= 50 * UNIT / 10, "bond is at least the minimum");

    let creator_before = points(&w.c, "creator.testnet");
    paying("lab.testnet", t + 100);
    w.c.propose_rerun_result(receipt(&w, Outcome::Reproduced, Some("0.913"), 1, "m2"));
    let m = w.c.get_market(w.id).unwrap().market;
    assert_eq!((m.state, m.outcome), (State::Final, Some(Outcome::Reproduced)));
    assert_eq!(points(&w.c, "carol.testnet"), carol_before - bond, "challenger loses the bond");
    assert_eq!(points(&w.c, "creator.testnet"), creator_before + bond / 2 + 50 * UNIT, "half the bond + creation bond");
    assert_eq!(w.c.get_receipts(w.id).len(), 2);
}

#[test]
fn challenge_with_disagreeing_rerun_is_invalid_and_rewards_challenger() {
    let mut w = world();
    let t = propose(&mut w, |w| receipt(w, Outcome::Reproduced, Some("0.915"), 0, "m1"));
    let carol_before = points(&w.c, "carol.testnet");
    paying("carol.testnet", t + 10);
    w.c.challenge(w.id, ChallengeReason::Nondeterministic, "a".repeat(64));
    paying("lab.testnet", t + 100);
    w.c.propose_rerun_result(receipt(&w, Outcome::NotReproduced, Some("0.80"), 1, "m2"));
    let m = w.c.get_market(w.id).unwrap().market;
    assert_eq!(m.outcome, Some(Outcome::Invalid));
    assert_eq!(m.invalid_reason, Some(InvalidReason::RunsDisagree));
    assert_eq!(points(&w.c, "carol.testnet"), carol_before + 25 * UNIT, "bond back + 50% of the creation bond");

    let alice = w.c.get_position(a("alice.testnet"), w.id).unwrap().position;
    paying("alice.testnet", t + 200);
    assert_eq!(w.c.redeem(w.id).0, alice.yes.0 / 2 + alice.no.0 / 2, "INVALID redeems at 0.5");
}

#[test]
#[should_panic(expected = "re-run must use a different model")]
fn rerun_with_the_same_model_is_rejected() {
    let mut w = world();
    let t = propose(&mut w, |w| receipt(w, Outcome::Reproduced, Some("0.915"), 0, "m1"));
    paying("carol.testnet", t + 10);
    w.c.challenge(w.id, ChallengeReason::Other, "a".repeat(64));
    paying("lab.testnet", t + 100);
    w.c.propose_rerun_result(receipt(&w, Outcome::Reproduced, Some("0.915"), 1, "m1"));
}

#[test]
#[should_panic(expected = "challenge window closed")]
fn late_challenge_is_rejected() {
    let mut w = world();
    let t = propose(&mut w, |w| receipt(w, Outcome::Reproduced, Some("0.915"), 0, "m1"));
    paying("carol.testnet", t + WINDOW);
    w.c.challenge(w.id, ChallengeReason::Other, "a".repeat(64));
}

#[test]
#[should_panic(expected = "challenge window still open")]
fn early_finalize_is_rejected() {
    let mut w = world();
    let t = propose(&mut w, |w| receipt(w, Outcome::Reproduced, Some("0.915"), 0, "m1"));
    as_("anyone.testnet", t + WINDOW - 1);
    w.c.finalize(w.id);
}

// ------------------------------------------------------------------ attacks

#[test]
#[should_panic(expected = "caller is not a registered Lab")]
fn unregistered_account_cannot_propose() {
    let mut w = world();
    as_("anyone.testnet", w.lock);
    w.c.lock(w.id);
    as_("lab.testnet", w.lock + 1);
    w.c.start_run(w.id);
    let mut r = receipt(&w, Outcome::Reproduced, Some("0.915"), 0, "m1");
    r.lab_account = a("mallory.testnet");
    paying("mallory.testnet", w.lock + 60);
    w.c.propose_result(r);
}

#[test]
#[should_panic(expected = "Lab codehash is not approved")]
fn revoked_codehash_cannot_propose() {
    let mut w = world();
    as_("anyone.testnet", w.lock);
    w.c.lock(w.id);
    as_("lab.testnet", w.lock + 1);
    w.c.start_run(w.id);
    as_("owner.testnet", w.lock + 2);
    w.c.revoke_codehash(CODEHASH.into());
    paying("lab.testnet", w.lock + 60);
    w.c.propose_result(receipt(&w, Outcome::Reproduced, Some("0.915"), 0, "m1"));
}

#[test]
#[should_panic(expected = "spec_hash does not match")]
fn wrong_spec_hash_is_rejected() {
    let mut w = world();
    let mut r = receipt(&w, Outcome::Reproduced, Some("0.915"), 0, "m1");
    r.spec_hash = "f".repeat(64);
    propose(&mut w, |_| r);
}

#[test]
#[should_panic(expected = "outcome contradicts measured_value")]
fn outcome_must_match_the_comparator() {
    let mut w = world();
    // 0.85 is outside 0.912 ± 0.01, so REPRODUCED is a lie.
    propose(&mut w, |w| receipt(w, Outcome::Reproduced, Some("0.85"), 0, "m1"));
}

#[test]
#[should_panic(expected = "data_hashes do not match")]
fn swapped_data_cannot_be_reported_as_reproduced() {
    let mut w = world();
    let mut r = receipt(&w, Outcome::Reproduced, Some("0.915"), 0, "m1");
    r.data_hashes = vec!["9".repeat(64)];
    propose(&mut w, |_| r);
}

#[test]
fn swapped_data_resolves_invalid_and_forfeits_the_creation_bond() {
    let mut w = world();
    let mut r = receipt(&w, Outcome::Invalid, None, 0, "m1");
    r.invalid_reason = Some(InvalidReason::HashMismatch);
    r.data_hashes = vec!["9".repeat(64)];
    let treasury_before = points(&w.c, "treasury.testnet");
    let t = propose(&mut w, |_| r);
    as_("anyone.testnet", t + WINDOW);
    w.c.finalize(w.id);
    assert_eq!(w.c.get_market(w.id).unwrap().market.outcome, Some(Outcome::Invalid));
    assert_eq!(points(&w.c, "treasury.testnet"), treasury_before + 50 * UNIT, "bad spec: bond to treasury");
}

#[test]
fn failed_software_setup_is_invalid_and_keeps_the_creation_bond() {
    let mut w = world();
    let mut r = receipt(&w, Outcome::Invalid, None, 0, "m1");
    r.invalid_reason = Some(InvalidReason::EnvSetupFailed);
    let treasury_before = points(&w.c, "treasury.testnet");
    let t = propose(&mut w, |_| r);
    as_("anyone.testnet", t + WINDOW);
    w.c.finalize(w.id);
    let m = w.c.get_market(w.id).unwrap().market;
    assert_eq!((m.outcome, m.invalid_reason), (Some(Outcome::Invalid), Some(InvalidReason::EnvSetupFailed)));
    assert_eq!(points(&w.c, "treasury.testnet"), treasury_before, "not the creator's fault: no bond is forfeited");
}

#[test]
fn get_verdict_reports_the_result_and_whether_it_is_final() {
    let mut w = world();
    assert_eq!(w.c.get_verdict(w.id).unwrap().outcome, None);
    let r = receipt(&w, Outcome::Reproduced, Some("0.912"), 0, "m1");
    let t = propose(&mut w, |_| r);
    let before = w.c.get_verdict(w.id).unwrap();
    assert_eq!(before.outcome, Some(Outcome::Reproduced));
    assert!(!before.is_final, "still open to challenge");
    assert_eq!(before.measured_value.as_deref(), Some("0.912"));
    as_("anyone.testnet", t + WINDOW);
    w.c.finalize(w.id);
    assert!(w.c.get_verdict(w.id).unwrap().is_final);
    assert!(w.c.get_verdict(9999).is_none());
}

#[test]
#[should_panic(expected = "set by the contract")]
fn lab_cannot_claim_runs_disagree() {
    let mut w = world();
    let mut r = receipt(&w, Outcome::Invalid, None, 0, "m1");
    r.invalid_reason = Some(InvalidReason::RunsDisagree);
    propose(&mut w, |_| r);
}

#[test]
#[should_panic(expected = "market is not running")]
fn cannot_propose_before_the_run_starts() {
    let mut w = world();
    paying("lab.testnet", w.lock + 60);
    w.c.propose_result(receipt(&w, Outcome::Reproduced, Some("0.915"), 0, "m1"));
}

// ------------------------------------------------------------------ stale, pause, trading rules

#[test]
fn silent_lab_is_refunded_as_invalid() {
    let mut w = world();
    let creator_before = points(&w.c, "creator.testnet");
    as_("anyone.testnet", w.lock + 3 * 3_600 + 1);
    w.c.refund_stale(w.id);
    let m = w.c.get_market(w.id).unwrap().market;
    assert_eq!((m.outcome, m.invalid_reason), (Some(Outcome::Invalid), Some(InvalidReason::Stale)));
    assert_eq!(points(&w.c, "creator.testnet"), creator_before + 50 * UNIT + 10 * UNIT, "bond and unearned fee refunded");
    let t = w.lock + 4 * 3_600;
    let paid = redeem_all(&mut w, t);
    assert!(paid <= m.collateral.0);
}

#[test]
#[should_panic(expected = "market is not stale")]
fn stale_refund_needs_the_deadline_to_pass() {
    let mut w = world();
    as_("anyone.testnet", w.lock + 10);
    w.c.refund_stale(w.id);
}

#[test]
fn pause_blocks_trading_but_not_redemption() {
    let mut w = world();
    let t = propose(&mut w, |w| receipt(w, Outcome::Reproduced, Some("0.915"), 0, "m1"));
    as_("anyone.testnet", t + WINDOW);
    w.c.finalize(w.id);
    as_("owner.testnet", t + WINDOW);
    w.c.pause();
    paying("alice.testnet", t + WINDOW);
    assert!(w.c.redeem(w.id).0 > 0);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn pause_blocks_buying() {
    let mut w = world();
    as_("owner.testnet", T0 + 30);
    w.c.pause();
    paying("carol.testnet", T0 + 31);
    w.c.buy(w.id, Side::Yes, U128(UNIT), U128(0));
}

#[test]
#[should_panic(expected = "passed its lock time")]
fn trading_stops_at_lock_time() {
    let mut w = world();
    paying("carol.testnet", w.lock);
    w.c.buy(w.id, Side::Yes, U128(UNIT), U128(0));
}

#[test]
#[should_panic(expected = "slippage")]
fn slippage_guard_rejects_bad_fills() {
    let mut w = world();
    paying("carol.testnet", T0 + 30);
    w.c.buy(w.id, Side::Yes, U128(10 * UNIT), U128(100 * UNIT));
}

#[test]
#[should_panic(expected = "owner only")]
fn only_owner_registers_labs() {
    let mut c = contract();
    as_("mallory.testnet", T0);
    c.register_lab_local(a("mallory.testnet"), CODEHASH.into(), LAB_KEY.into());
}

#[test]
fn ownership_transfer_is_two_step() {
    let mut c = contract();
    as_("owner.testnet", T0);
    c.transfer_ownership(a("new.testnet"));
    assert_eq!(c.get_config().owner, a("owner.testnet"));
    as_("new.testnet", T0);
    c.accept_ownership();
    assert_eq!(c.get_config().owner, a("new.testnet"));
}

// ------------------------------------------------------------------ points, drafts, storage

#[test]
#[should_panic(expected = "points already claimed")]
fn points_are_claimed_once() {
    let mut c = contract();
    paying("alice.testnet", T0);
    c.claim_points();
    paying("alice.testnet", T0);
    c.claim_points();
}

#[test]
fn leaderboard_ranks_forecasters_and_hides_system_accounts() {
    let mut w = world();
    let t = propose(&mut w, |w| receipt(w, Outcome::Reproduced, Some("0.915"), 0, "m1"));
    as_("anyone.testnet", t + WINDOW);
    w.c.finalize(w.id);
    redeem_all(&mut w, t + WINDOW);
    let board = w.c.get_points_leaderboard(None);
    assert_eq!(board[0].account_id, a("alice.testnet"), "the right forecaster leads");
    assert!(board.iter().all(|e| e.account_id != a("treasury.testnet") && e.account_id != a("labfees.testnet")));
}

#[test]
fn drafts_can_be_cancelled_by_their_creator() {
    let mut c = contract();
    paying("creator.testnet", T0);
    let id = c.create_market(canonical(&sample_spec()), T0 + 3_600, WINDOW, Mode::Points);
    assert_eq!(c.get_market(id).unwrap().market.state, State::Draft);
    as_("creator.testnet", T0);
    c.cancel_draft(id);
    assert!(c.get_market(id).is_none() && c.get_spec(id).is_none());
}

#[test]
fn the_owner_can_cancel_anyone_elses_draft() {
    let mut c = contract();
    paying("creator.testnet", T0);
    let id = c.create_market(canonical(&sample_spec()), T0 + 3_600, WINDOW, Mode::Points);
    let owner = c.get_config().owner.clone();
    as_(owner.as_str(), T0);
    c.cancel_draft(id);
    assert!(c.get_market(id).is_none() && c.get_spec(id).is_none());
}

#[test]
#[should_panic(expected = "creator or owner only")]
fn nobody_else_can_cancel_a_draft() {
    let mut c = contract();
    paying("creator.testnet", T0);
    let id = c.create_market(canonical(&sample_spec()), T0 + 3_600, WINDOW, Mode::Points);
    as_("stranger.testnet", T0);
    c.cancel_draft(id);
}

#[test]
#[should_panic(expected = "not enough storage deposit")]
fn creating_a_market_requires_storage_deposit() {
    let mut c = contract();
    as_("creator.testnet", T0);
    c.create_market(canonical(&sample_spec()), T0 + 3_600, WINDOW, Mode::Points);
}

#[test]
fn spec_is_stored_verbatim_and_hash_matches() {
    let mut c = contract();
    let json = canonical(&sample_spec());
    paying("creator.testnet", T0);
    let id = c.create_market(json.clone(), T0 + 3_600, WINDOW, Mode::Points);
    assert_eq!(c.get_spec(id), Some(&json));
    let hash = crate::spec::hex(&near_sdk::env::sha256(json.as_bytes()));
    assert_eq!(c.get_market(id).unwrap().market.spec.spec_hash, hash);
}

// ------------------------------------------------------------------ money mode

fn money_world() -> (Contract, u64) {
    let mut c = contract();
    for who in ["creator.testnet", "alice.testnet"] {
        paying(who, T0);
        c.storage_deposit(None);
    }
    paying("creator.testnet", T0);
    let id = c.create_market(canonical(&sample_spec()), T0 + 3_600, WINDOW, Mode::Money);
    as_("tusdc.testnet", T0);
    let msg = format!(r#"{{"action":"fund","market_id":{id},"initial_liquidity":"{}"}}"#, 20 * UNIT);
    c.ft_on_transfer(a("creator.testnet"), U128(32 * UNIT), msg);
    (c, id)
}

#[test]
fn money_market_funds_and_trades_through_ft_transfer_call() {
    let (mut c, id) = money_world();
    assert_eq!(c.get_market(id).unwrap().market.state, State::Open);
    assert_eq!(c.get_balance(a("creator.testnet"), Mode::Money).0, 0, "liquidity + bond + fee consumed");
    as_("tusdc.testnet", T0 + 5);
    let msg = format!(r#"{{"action":"buy","market_id":{id},"outcome":"YES","min_shares_out":"0"}}"#);
    c.ft_on_transfer(a("alice.testnet"), U128(5 * UNIT), msg);
    assert!(c.get_position(a("alice.testnet"), id).unwrap().position.yes.0 > 5 * UNIT);
}

#[test]
#[should_panic(expected = "unsupported token")]
fn other_tokens_are_rejected() {
    let (mut c, _) = money_world();
    as_("fake-usdc.testnet", T0);
    c.ft_on_transfer(a("alice.testnet"), U128(UNIT), String::new());
}

#[test]
#[should_panic(expected = "not enough storage deposit")]
fn ft_deposits_need_prepaid_storage() {
    let (mut c, _) = money_world();
    as_("tusdc.testnet", T0);
    c.ft_on_transfer(a("stranger.testnet"), U128(UNIT), String::new());
}

#[test]
#[should_panic(expected = "not a money market")]
fn ft_actions_cannot_target_points_markets() {
    let mut w = world();
    paying("alice.testnet", T0 + 30);
    w.c.storage_deposit(None);
    as_("tusdc.testnet", T0 + 30);
    let msg = format!(r#"{{"action":"buy","market_id":{},"outcome":"YES","min_shares_out":"0"}}"#, w.id);
    w.c.ft_on_transfer(a("alice.testnet"), U128(UNIT), msg);
}

#[test]
fn failed_withdrawal_is_recredited() {
    let (mut c, _) = money_world();
    as_("tusdc.testnet", T0);
    c.ft_on_transfer(a("alice.testnet"), U128(5 * UNIT), String::new());
    ctx("alice.testnet", NearToken::from_yoctonear(1), T0);
    let _ = c.withdraw(None);
    assert_eq!(c.get_balance(a("alice.testnet"), Mode::Money).0, 0, "debited before the transfer");
    as_("rerun.testnet", T0);
    assert!(!c.on_withdraw(a("alice.testnet"), U128(5 * UNIT), Err(PromiseError::Failed)));
    assert_eq!(c.get_balance(a("alice.testnet"), Mode::Money).0, 5 * UNIT, "restored after failure");
    // Retry succeeds.
    ctx("alice.testnet", NearToken::from_yoctonear(1), T0);
    let _ = c.withdraw(None);
    as_("rerun.testnet", T0);
    assert!(c.on_withdraw(a("alice.testnet"), U128(5 * UNIT), Ok(())));
    assert_eq!(c.get_balance(a("alice.testnet"), Mode::Money).0, 0);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn withdraw_requires_one_yocto() {
    let (mut c, _) = money_world();
    as_("creator.testnet", T0);
    let _ = c.withdraw(None);
}

// ------------------------------------------------------------------ TypeScript <-> Rust agreement

/// Real specs and receipts produced by the TypeScript Lab. Regenerate with the Lab's `export:vectors`.
#[test]
fn lab_output_is_accepted_by_the_contract() {
    #[derive(near_sdk::serde::Deserialize)]
    #[serde(crate = "near_sdk::serde")]
    struct Vector {
        name: String,
        spec_json: String,
        spec_hash: String,
        receipt: Receipt,
    }
    let vectors: Vec<Vector> = near_sdk::serde_json::from_str(include_str!("../test-vectors/lab-output.json")).unwrap();
    assert_eq!(vectors.len(), 6);

    let mut c = contract();
    paying("creator.testnet", T0);
    c.claim_points();
    for v in vectors {
        let code = v.receipt.lab_codehash.clone();
        as_("owner.testnet", T0);
        c.approve_codehash(code.clone());
        c.register_lab_local(v.receipt.lab_account.clone(), code, LAB_KEY.into());
        paying("creator.testnet", T0);
        let id = c.create_market(v.spec_json.clone(), T0 + 3_600, WINDOW, Mode::Points);
        let m = c.get_market(id).unwrap().market;
        assert_eq!(m.spec.spec_hash, v.spec_hash, "{}: Rust and TypeScript disagree on spec_hash", v.name);

        paying("creator.testnet", T0);
        c.fund_market(id, U128(100 * UNIT));
        let lab = v.receipt.lab_account.to_string();
        as_("anyone.testnet", T0 + 3_600);
        c.lock(id);
        as_(&lab, T0 + 3_601);
        c.start_run(id);
        let mut r = v.receipt;
        let expected = r.outcome;
        r.market_id = id;
        paying(&lab, T0 + 3_660);
        c.propose_result(r);
        as_("anyone.testnet", T0 + 3_660 + WINDOW);
        c.finalize(id);
        assert_eq!(c.get_market(id).unwrap().market.outcome, Some(expected), "{}", v.name);
    }
}

// ---------------------------------------------------------------- notes

mod notes {
    use super::*;
    use crate::notes::{NoteKind, NoteRole};

    fn note(w: &mut World, who: &str, kind: NoteKind, text: &str, role: Option<NoteRole>, parent: Option<u32>) -> u32 {
        ctx(who, NearToken::from_millinear(50), T0 + 30);
        w.c.add_note(w.id, kind, text.into(), role, parent)
    }

    #[test]
    fn anyone_can_post_and_it_reads_back() {
        let mut w = world();
        let id = note(&mut w, "alice.testnet", NoteKind::Note, "  The table uses a different year  ", None, None);
        let notes = w.c.get_notes(w.id, None, None);
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, id);
        assert_eq!(notes[0].account, a("alice.testnet"));
        assert_eq!(notes[0].text, "The table uses a different year");
        assert_eq!(notes[0].at, T0 + 30);
    }

    #[test]
    #[should_panic(expected = "write something")]
    fn empty_notes_are_refused() {
        let mut w = world();
        note(&mut w, "alice.testnet", NoteKind::Note, "   ", None, None);
    }

    #[test]
    #[should_panic(expected = "at most 600 bytes")]
    fn long_notes_are_refused() {
        let mut w = world();
        note(&mut w, "alice.testnet", NoteKind::Note, &"x".repeat(601), None, None);
    }

    #[test]
    #[should_panic(expected = "unknown market")]
    fn unknown_claims_are_refused() {
        let mut w = world();
        ctx("alice.testnet", NearToken::from_millinear(50), T0);
        w.c.add_note(999, NoteKind::Note, "hello".into(), None, None);
    }

    #[test]
    #[should_panic(expected = "attach more NEAR")]
    fn the_poster_pays_for_storage() {
        let mut w = world();
        as_("alice.testnet", T0);
        w.c.add_note(w.id, NoteKind::Note, "hello".into(), None, None);
    }

    #[test]
    #[should_panic(expected = "only the account that opened")]
    fn only_the_real_creator_can_declare_as_creator() {
        let mut w = world();
        note(&mut w, "alice.testnet", NoteKind::Declare, "", Some(NoteRole::Creator), None);
    }

    #[test]
    fn a_declaration_marks_later_notes() {
        let mut w = world();
        note(&mut w, "creator.testnet", NoteKind::Declare, "", Some(NoteRole::Creator), None);
        note(&mut w, "carol.testnet", NoteKind::Declare, "I wrote this", Some(NoteRole::Author), None);
        note(&mut w, "carol.testnet", NoteKind::Note, "Context on the data", None, None);
        let notes = w.c.get_notes(w.id, None, None);
        assert_eq!(notes[0].role, Some(NoteRole::Creator));
        assert_eq!(notes[2].role, Some(NoteRole::Author));
    }

    #[test]
    #[should_panic(expected = "already declared")]
    fn one_declaration_per_account() {
        let mut w = world();
        note(&mut w, "carol.testnet", NoteKind::Declare, "", Some(NoteRole::Author), None);
        note(&mut w, "carol.testnet", NoteKind::Declare, "", Some(NoteRole::Author), None);
    }

    #[test]
    fn a_declared_author_can_reply_to_a_note() {
        let mut w = world();
        let first = note(&mut w, "alice.testnet", NoteKind::Note, "Why this year?", None, None);
        note(&mut w, "carol.testnet", NoteKind::Declare, "", Some(NoteRole::Author), None);
        let reply = note(&mut w, "carol.testnet", NoteKind::Reply, "Because of the survey", None, Some(first));
        let notes = w.c.get_notes(w.id, None, None);
        assert_eq!(notes[reply as usize].parent, Some(first));
    }

    #[test]
    #[should_panic(expected = "declare your connection")]
    fn undeclared_accounts_cannot_reply() {
        let mut w = world();
        let first = note(&mut w, "alice.testnet", NoteKind::Note, "Why this year?", None, None);
        note(&mut w, "bob.testnet", NoteKind::Reply, "I can answer", None, Some(first));
    }

    #[test]
    #[should_panic(expected = "isn't there")]
    fn replies_need_a_real_note() {
        let mut w = world();
        note(&mut w, "carol.testnet", NoteKind::Declare, "", Some(NoteRole::Author), None);
        note(&mut w, "carol.testnet", NoteKind::Reply, "To nothing", None, Some(44));
    }

    #[test]
    fn the_owner_can_hide_a_note() {
        let mut w = world();
        let id = note(&mut w, "alice.testnet", NoteKind::Note, "spam", None, None);
        as_("owner.testnet", T0 + 40);
        w.c.hide_note(w.id, id);
        assert!(w.c.get_notes(w.id, None, None).is_empty());
    }

    #[test]
    #[should_panic]
    fn nobody_else_can_hide_a_note() {
        let mut w = world();
        let id = note(&mut w, "alice.testnet", NoteKind::Note, "fair point", None, None);
        as_("bob.testnet", T0 + 40);
        w.c.hide_note(w.id, id);
    }

    #[test]
    fn notes_never_touch_the_market() {
        let mut w = world();
        let before = format!("{:?}", w.c.get_market(w.id).unwrap().market);
        note(&mut w, "alice.testnet", NoteKind::Note, "This verdict is wrong, change it", None, None);
        assert_eq!(before, format!("{:?}", w.c.get_market(w.id).unwrap().market));
    }
}

// ------------------------------------------------------------------ money limits

#[test]
#[should_panic(expected = "a prediction can be at most 5 USDC")]
fn money_prediction_over_the_limit_is_refused() {
    let (mut c, id) = money_world();
    as_("tusdc.testnet", T0 + 5);
    let msg = format!(r#"{{"action":"buy","market_id":{id},"outcome":"YES","min_shares_out":"0"}}"#);
    c.ft_on_transfer(a("alice.testnet"), U128(5 * UNIT + 1), msg);
}

#[test]
fn a_claim_stops_taking_money_at_its_limit() {
    let (mut c, id) = money_world();
    let buy = format!(r#"{{"action":"buy","market_id":{id},"outcome":"YES","min_shares_out":"0"}}"#);
    // Each 5 USDC prediction adds about 4.95 after the fee, on top of 20 in the prize pool.
    for t in 0..6 {
        as_("tusdc.testnet", T0 + 5 + t);
        c.ft_on_transfer(a("alice.testnet"), U128(5 * UNIT), buy.clone());
    }
    let held = c.get_market(id).unwrap().market.collateral.0;
    assert!(held <= 50 * UNIT && held > 45 * UNIT, "holds {held}");
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        as_("tusdc.testnet", T0 + 20);
        c.ft_on_transfer(a("alice.testnet"), U128(5 * UNIT), buy.clone());
    }));
    assert!(refused.is_err());
}

#[test]
fn points_have_no_limit() {
    let mut w = world();
    paying("carol.testnet", T0 + 30);
    w.c.buy(w.id, Side::Yes, U128(500 * UNIT), U128(0));
}

// ------------------------------------------------------------------ accuracy

#[test]
fn accuracy_scores_the_odds_each_forecaster_moved_the_claim_to() {
    let mut w = world();
    assert_eq!(w.c.get_accuracy(a("alice.testnet")).scored, 0, "nothing is settled yet");
    let alice_said = w.c.get_price_history(w.id)[1].yes_ppm as i128;
    let bob_said = w.c.get_market(w.id).unwrap().yes_price_ppm as i128;
    let t = propose(&mut w, |w| receipt(w, Outcome::Reproduced, Some("0.912"), 0, "m1"));
    as_("anyone.testnet", t + WINDOW);
    w.c.finalize(w.id);
    let alice = w.c.get_accuracy(a("alice.testnet"));
    assert_eq!((alice.scored, alice.brier_ppm), (1, Some(((1_000_000 - alice_said).pow(2) / 1_000_000) as u32)));
    let bob = w.c.get_accuracy(a("bob.testnet"));
    assert_eq!(bob.brier_ppm, Some(((1_000_000 - bob_said).pow(2) / 1_000_000) as u32));
    // Bob's forecast sits nearer 50% than Alice's, and the claim held up, so Alice scores better.
    assert!(alice.brier_ppm < bob.brier_ppm);
    assert_eq!(w.c.get_accuracy(a("creator.testnet")).scored, 0, "funding a claim isn't a forecast");
}

#[test]
fn inconclusive_claims_do_not_count_towards_accuracy() {
    let mut w = world();
    let t = propose(&mut w, |w| {
        let mut r = receipt(w, Outcome::Invalid, None, 0, "m1");
        r.invalid_reason = Some(InvalidReason::EnvSetupFailed);
        r
    });
    as_("anyone.testnet", t + WINDOW);
    w.c.finalize(w.id);
    let alice = w.c.get_accuracy(a("alice.testnet"));
    assert_eq!((alice.scored, alice.brier_ppm), (0, None));
}

// ------------------------------------------------------------------ Labs in secure hardware

#[test]
fn an_attested_lab_can_propose_and_its_attestation_is_on_record() {
    let mut w = world();
    as_("owner.testnet", T0);
    w.c.register_lab_attested(a("tee-lab.testnet"), CODEHASH.into(), LAB_KEY.into(), "e".repeat(64));
    assert_eq!(w.c.get_lab_attestation(a("tee-lab.testnet")), Some("e".repeat(64)));
    assert!(!w.c.get_lab(a("tee-lab.testnet")).unwrap().local);
    assert_eq!(w.c.get_lab_attestation(a("lab.testnet")), None, "a local Lab has no attestation");
    as_("owner.testnet", T0);
    w.c.remove_lab(a("tee-lab.testnet"));
    assert_eq!(w.c.get_lab_attestation(a("tee-lab.testnet")), None);
}

#[test]
#[should_panic(expected = "owner only")]
fn only_the_owner_registers_an_attested_lab() {
    let mut w = world();
    as_("mallory.testnet", T0);
    w.c.register_lab_attested(a("tee-lab.testnet"), CODEHASH.into(), LAB_KEY.into(), "e".repeat(64));
}

// ------------------------------------------------------------------ points top-up for demo claims

#[test]
fn the_owner_can_top_up_points_for_demo_claims() {
    let mut w = world();
    as_("owner.testnet", T0);
    // On testnet the owner is also the treasury, which the leaderboard leaves out.
    let before = w.c.get_balance(a("treasury.testnet"), Mode::Points).0;
    let after = w.c.grant_points(a("treasury.testnet"), U128(crate::MAX_POINTS_GRANT)).0;
    assert_eq!(after, before + crate::MAX_POINTS_GRANT);
    assert!(w.c.get_points_leaderboard(None).iter().all(|e| e.account_id != a("treasury.testnet")), "a system account never ranks");
}

#[test]
#[should_panic(expected = "owner only")]
fn nobody_else_can_grant_points() {
    let mut w = world();
    as_("alice.testnet", T0);
    w.c.grant_points(a("alice.testnet"), U128(1));
}

#[test]
#[should_panic(expected = "grant must be between 1 and 5,000 points")]
fn a_grant_is_capped() {
    let mut w = world();
    as_("owner.testnet", T0);
    w.c.grant_points(a("owner.testnet"), U128(crate::MAX_POINTS_GRANT + 1));
}
