//! Lock → Running → Proposed → (Challenged → re-run) → Final → redeem, plus stale refunds.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId};

use crate::events::emit;
use crate::math::{mul_div_floor, parse_decimal, within_tolerance};
use crate::spec::is_hex;
use crate::types::*;
use crate::*;

const MAX_TAIL: usize = 4 * 1024;
const MAX_PATCHES: usize = 32;
const MAX_SIG_REFS: usize = 16;
const MAX_URI: usize = 300;

#[near]
impl Contract {
    /// Anyone may lock a market once its lock time has passed.
    pub fn lock(&mut self, market_id: u64) {
        let mut m = self.market(market_id);
        require!(m.state == State::Open, "market is not open");
        require!(now() >= m.lock_time, "lock time not reached");
        m.state = State::Locked;
        emit("locked", json!({ "market_id": market_id, "yes_price_ppm": yes_price(&m) as u32 }));
        self.save_market(m);
    }

    /// A registered Lab claims a locked market and starts the reproduction run.
    pub fn start_run(&mut self, market_id: u64) {
        let lab_account = env::predecessor_account_id();
        self.assert_lab(&lab_account);
        let mut m = self.market(market_id);
        if m.state == State::Open && now() >= m.lock_time {
            m.state = State::Locked;
            emit("locked", json!({ "market_id": market_id, "yes_price_ppm": yes_price(&m) as u32 }));
        }
        require!(m.state == State::Locked, "market is not locked");
        m.state = State::Running;
        m.run_deadline = Some(now() + self.config.run_timeout_secs);
        emit("run_started", json!({ "market_id": market_id, "lab_account": lab_account, "run_index": 0 }));
        self.save_market(m);
    }

    /// The Lab posts its Reproduction Receipt; the challenge window opens and the reproduction
    /// fee goes to the Lab fee recipient. Attach NEAR for the receipt's storage.
    #[payable]
    pub fn propose_result(&mut self, receipt: Receipt) {
        let lab_account = env::predecessor_account_id();
        let before = self.flushed_usage();
        let lab = self.assert_lab(&lab_account);
        let mut m = self.market(receipt.market_id);
        require!(m.state == State::Running, "market is not running");
        check_receipt(&m, &receipt, 0, &lab_account, &lab);

        m.state = State::Proposed;
        m.challenge_deadline = Some(now() + m.challenge_window);
        let recipient = self.config.lab_fee_recipient.clone();
        self.credit(m.mode, &recipient, m.repro_fee.0);
        emit(
            "result_proposed",
            json!({ "market_id": m.id, "outcome": receipt.outcome, "measured_value": receipt.measured_value, "run_index": 0 }),
        );
        self.receipts.insert(m.id, vec![receipt]);
        self.save_market(m);
        self.settle_storage(&lab_account, before, env::attached_deposit());
    }

    /// Anyone may challenge a proposed result during the window by posting a bond. The Lab
    /// then performs an independent second run.
    #[payable]
    pub fn challenge(&mut self, market_id: u64, reason: ChallengeReason, note_hash: String) {
        let actor = env::predecessor_account_id();
        let before = self.flushed_usage();
        self.internal_challenge(&actor, market_id, reason, note_hash);
        self.settle_storage(&actor, before, env::attached_deposit());
    }

    /// The Lab's independent re-run after a challenge (fresh environment, different model).
    /// Same outcome: the result stands and the challenger's bond is forfeited. Different
    /// outcome: the market is INVALID and the challenger is rewarded.
    #[payable]
    pub fn propose_rerun_result(&mut self, receipt: Receipt) {
        let lab_account = env::predecessor_account_id();
        let before = self.flushed_usage();
        let lab = self.assert_lab(&lab_account);
        let mut m = self.market(receipt.market_id);
        require!(m.state == State::Challenged, "market is not challenged");
        check_receipt(&m, &receipt, 1, &lab_account, &lab);
        let mut receipts = self.receipts.get(&m.id).cloned().unwrap_or_default();
        let first = receipts[0].clone();
        require!(receipt.nearai.model_id != first.nearai.model_id, "re-run must use a different model");

        emit(
            "rerun_proposed",
            json!({ "market_id": m.id, "outcome": receipt.outcome, "measured_value": receipt.measured_value, "run_index": 1 }),
        );
        let agree = receipt.outcome == first.outcome;
        receipts.push(receipt);
        self.receipts.insert(m.id, receipts);
        let challenge = m.challenge.clone().expect("challenged market has a challenge");
        if agree {
            // Challenger loses the bond: half to the creator, half to the treasury.
            let to_creator = challenge.bond.0 / 2;
            let creator = m.creator.clone();
            let treasury = self.config.treasury.clone();
            self.credit(m.mode, &creator, to_creator);
            self.credit(m.mode, &treasury, challenge.bond.0 - to_creator);
            self.finalize_market(&mut m, first.outcome, first.invalid_reason);
        } else {
            self.credit(m.mode, &challenge.challenger, challenge.bond.0);
            self.finalize_market(&mut m, Outcome::Invalid, Some(InvalidReason::RunsDisagree));
        }
        self.save_market(m);
        self.settle_storage(&lab_account, before, env::attached_deposit());
    }

    /// Anyone may finalize an unchallenged result after the challenge window.
    pub fn finalize(&mut self, market_id: u64) {
        let mut m = self.market(market_id);
        require!(m.state == State::Proposed, "market has no unchallenged proposal");
        require!(now() >= m.challenge_deadline.unwrap(), "challenge window still open");
        let first = self.receipts.get(&market_id).unwrap()[0].clone();
        self.finalize_market(&mut m, first.outcome, first.invalid_reason);
        self.save_market(m);
    }

    /// If the Lab misses its deadline, anyone can resolve the market INVALID (0.5 per share)
    /// so funds are never stuck. Bonds are returned; an unearned reproduction fee is refunded.
    pub fn refund_stale(&mut self, market_id: u64) {
        let mut m = self.market(market_id);
        let t = now();
        let timeout = self.config.run_timeout_secs;
        let stale = match m.state {
            State::Open | State::Locked => t > m.lock_time + timeout,
            State::Running | State::Challenged => t > m.run_deadline.unwrap(),
            _ => false,
        };
        require!(stale, "market is not stale");
        let has_receipt = self.receipts.get(&market_id).is_some_and(|r| !r.is_empty());
        let creator = m.creator.clone();
        if !has_receipt {
            self.credit(m.mode, &creator, m.repro_fee.0);
        }
        if let Some(c) = m.challenge.clone() {
            self.credit(m.mode, &c.challenger, c.bond.0);
        }
        self.finalize_market(&mut m, Outcome::Invalid, Some(InvalidReason::Stale));
        self.save_market(m);
    }

    /// Pays out the caller's position in a Final market: 1 per winning share, or 0.5 per share
    /// of either side if INVALID. Any LP position is withdrawn first.
    #[payable]
    pub fn redeem(&mut self, market_id: u64) -> U128 {
        let actor = env::predecessor_account_id();
        let before = self.flushed_usage();
        let mut m = self.market(market_id);
        require!(m.state == State::Final, "market is not final");
        let mut p = self.position(market_id, &actor);
        if p.lp.0 > 0 {
            let lp = p.lp.0;
            self.remove_lp(&mut m, &actor, &mut p, lp);
        }
        let payout = match m.outcome.unwrap() {
            Outcome::Reproduced => p.yes.0,
            Outcome::NotReproduced | Outcome::Broken => p.no.0,
            Outcome::Invalid => p.yes.0 / 2 + p.no.0 / 2,
        };
        require!(payout <= m.collateral.0, "payout exceeds collateral");
        m.collateral.0 -= payout;
        p.yes = U128(0);
        p.no = U128(0);
        p.received.0 += payout;
        self.credit(m.mode, &actor, payout);
        emit("redeemed", json!({ "market_id": market_id, "account_id": actor, "payout": U128(payout) }));
        self.save_position(market_id, &actor, p);
        self.save_market(m);
        self.settle_storage(&actor, before, env::attached_deposit());
        U128(payout)
    }
}

impl Contract {
    pub(crate) fn internal_challenge(&mut self, actor: &AccountId, market_id: u64, reason: ChallengeReason, note_hash: String) {
        self.assert_not_paused();
        let mut m = self.market(market_id);
        require!(m.state == State::Proposed, "no proposal to challenge");
        require!(now() < m.challenge_deadline.unwrap(), "challenge window closed");
        require!(is_hex(&note_hash, 64), "note_hash must be a sha256 hex string");
        let bond = self.challenge_bond(&m);
        self.debit(m.mode, actor, bond);
        m.challenge = Some(Challenge { challenger: actor.clone(), bond: U128(bond), reason, note_hash, at: now() });
        m.state = State::Challenged;
        m.run_deadline = Some(now() + self.config.run_timeout_secs);
        emit("challenged", json!({ "market_id": market_id, "challenger": actor, "reason": reason, "bond": U128(bond) }));
        self.save_market(m);
    }

    pub(crate) fn challenge_bond(&self, m: &Market) -> u128 {
        let p = self.params(m.mode);
        mul_div_floor(m.collateral.0, p.challenge_bond_bps as u128, BPS).max(p.challenge_bond_min.0)
    }

    /// Settles the creation bond and records the outcome.
    fn finalize_market(&mut self, m: &mut Market, outcome: Outcome, reason: Option<InvalidReason>) {
        let bond = m.creation_bond.0;
        let creator = m.creator.clone();
        let treasury = self.config.treasury.clone();
        match reason {
            Some(r) if r.is_spec_fault() => self.credit(m.mode, &treasury, bond),
            Some(InvalidReason::RunsDisagree) => {
                let reward = mul_div_floor(bond, self.config.challenger_reward_bps as u128, BPS);
                let challenger = m.challenge.as_ref().unwrap().challenger.clone();
                self.credit(m.mode, &challenger, reward);
                self.credit(m.mode, &creator, bond - reward);
            }
            _ => self.credit(m.mode, &creator, bond),
        }
        m.state = State::Final;
        m.outcome = Some(outcome);
        m.invalid_reason = reason;
        m.finalized_at = Some(now());
        match outcome {
            Outcome::Reproduced => self.stats.reproduced += 1,
            Outcome::NotReproduced => self.stats.not_reproduced += 1,
            Outcome::Broken => self.stats.broken += 1,
            Outcome::Invalid => self.stats.invalid += 1,
        }
        emit("finalized", json!({ "market_id": m.id, "outcome": outcome, "invalid_reason": reason }));
    }
}

/// Everything a receipt must satisfy before it can settle a market.
pub(crate) fn check_receipt(m: &Market, r: &Receipt, run_index: u8, lab_account: &AccountId, lab: &Lab) {
    let s = &m.spec;
    require!(r.run_index == run_index, format!("expected run_index {run_index}"));
    require!(r.spec_hash == s.spec_hash, "receipt spec_hash does not match the market");
    require!(r.commit == s.commit, "receipt commit does not match the spec");
    require!(r.reported_value == s.reported_value, "receipt reported_value does not match the spec");
    require!(r.tolerance == format!("{}:{}", s.tolerance_kind, s.tolerance_value), "receipt tolerance does not match the spec");
    require!(r.lab_account == *lab_account, "receipt lab_account must be the caller");
    require!(r.lab_codehash == lab.codehash, "receipt lab_codehash does not match the registered Lab");
    require!(r.started_at <= r.finished_at && r.finished_at <= now(), "receipt timestamps are inconsistent");

    require!(is_hex(&r.log_hash, 64), "log_hash must be sha256 hex");
    require!(is_hex(&r.report_hash, 64), "report_hash must be sha256 hex");
    require!(r.env_lock_hash.is_empty() || is_hex(&r.env_lock_hash, 64), "env_lock_hash must be sha256 hex or empty");
    require!(r.log_tail.len() <= MAX_TAIL && r.patches_diff_excerpt.len() <= MAX_TAIL, "log_tail / diff excerpt max 4 KB");
    require!(r.full_log_uri.len() <= MAX_URI && r.report_uri.len() <= MAX_URI, "URIs max 300 chars");
    require!(r.patches.len() <= MAX_PATCHES, "too many patches");
    for p in &r.patches {
        require!(is_hex(&p.diff_hash, 64) && !p.file.is_empty() && p.file.len() <= 200, "invalid patch entry");
    }
    require!(r.data_hashes.len() <= 16 && r.data_hashes.iter().all(|h| is_hex(h, 64)), "invalid data_hashes");
    let ai = &r.nearai;
    require!(!ai.model_id.is_empty() && ai.model_id.len() <= 100, "nearai.model_id required");
    require!(is_hex(&ai.attestation_digest, 64), "nearai.attestation_digest must be sha256 hex");
    require!(ai.response_signature_refs.len() <= MAX_SIG_REFS, "too many response_signature_refs");
    require!(ai.response_signature_refs.iter().all(|x| !x.is_empty() && x.len() <= 200), "invalid response_signature_refs");

    match r.outcome {
        Outcome::Reproduced | Outcome::NotReproduced => {
            require!(r.invalid_reason.is_none(), "invalid_reason only allowed for INVALID");
            require!(r.data_hashes == s.data_hashes, "receipt data_hashes do not match the spec");
            let measured = r.measured_value.as_deref().unwrap_or_else(|| env::panic_str("measured_value required"));
            let measured = parse_decimal(measured).unwrap_or_else(|e| env::panic_str(&e));
            let reported = parse_decimal(&s.reported_value).unwrap();
            let (kind, tol) = s.tolerance();
            // The deterministic comparator decides, on-chain as well as in the Lab.
            let expected = if within_tolerance(measured, reported, kind, tol) { Outcome::Reproduced } else { Outcome::NotReproduced };
            require!(r.outcome == expected, "outcome contradicts measured_value and tolerance");
        }
        Outcome::Broken => {
            require!(r.invalid_reason.is_none(), "invalid_reason only allowed for INVALID");
            require!(r.data_hashes == s.data_hashes, "receipt data_hashes do not match the spec");
        }
        Outcome::Invalid => {
            let reason = r.invalid_reason.unwrap_or_else(|| env::panic_str("INVALID requires invalid_reason"));
            require!(
                !matches!(reason, InvalidReason::RunsDisagree | InvalidReason::Stale),
                "RUNS_DISAGREE and STALE are set by the contract"
            );
        }
    }
}
