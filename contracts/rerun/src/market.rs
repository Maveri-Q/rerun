//! Market creation, trading and liquidity. Every public method has an `internal_*` twin
//! taking the acting account, so `ft_on_transfer` can run the same logic for the sender.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId};

use crate::events::emit;
use crate::fpmm::{self, Side};
use crate::math::mul_div_floor;
use crate::spec;
use crate::types::*;
use crate::*;

#[near]
impl Contract {
    /// Registers a claim as a Draft market. Attach NEAR for storage (the spec is stored on-chain);
    /// the excess is refunded. Fund it with `fund_market` (or `ft_transfer_call` msg `fund`) to open it.
    #[payable]
    pub fn create_market(&mut self, spec_json: String, lock_time: u64, challenge_window: u64, mode: Mode) -> u64 {
        self.assert_not_paused();
        let creator = env::predecessor_account_id();
        let before = self.flushed_usage();
        let summary = spec::validate(&spec_json).unwrap_or_else(|e| env::panic_str(&e));
        require!(lock_time > now() + 60, "lock_time must be at least 60s in the future");
        require!(
            (self.config.min_challenge_window..=self.config.max_challenge_window).contains(&challenge_window),
            "challenge_window out of range"
        );
        let params = self.params(mode).clone();
        let id = self.next_market_id;
        self.next_market_id += 1;
        let market = Market {
            id,
            creator: creator.clone(),
            mode,
            state: State::Draft,
            spec: summary,
            created_at: now(),
            lock_time,
            challenge_window,
            yes_pool: U128(0),
            no_pool: U128(0),
            lp_supply: U128(0),
            collateral: U128(0),
            lp_fees: U128(0),
            lp_fee_per_share: U128(0),
            creation_bond: params.creation_bond,
            repro_fee: params.repro_fee,
            volume: U128(0),
            trades: 0,
            run_deadline: None,
            challenge_deadline: None,
            outcome: None,
            invalid_reason: None,
            challenge: None,
            finalized_at: None,
        };
        emit(
            "market_created",
            json!({
                "market_id": id, "creator": creator, "mode": mode, "spec_hash": market.spec.spec_hash,
                "lock_time": lock_time, "title": market.spec.title,
            }),
        );
        self.specs.insert(id, spec_json);
        self.save_market(market);
        self.settle_storage(&creator, before, env::attached_deposit());
        id
    }

    /// The creator or the owner deletes a Draft that was never funded. The storage deposit always goes
    /// back to the creator. The owner can do this so a person can stop what the safe approver drafted.
    pub fn cancel_draft(&mut self, market_id: u64) {
        let caller = env::predecessor_account_id();
        let before = self.flushed_usage();
        let m = self.market(market_id);
        require!(m.creator == caller || caller == self.config.owner, "creator or owner only");
        require!(m.state == State::Draft, "only drafts can be cancelled");
        let creator = m.creator;
        self.markets.remove(&market_id);
        self.specs.remove(&market_id);
        emit("draft_cancelled", json!({ "market_id": market_id }));
        self.settle_storage(&creator, before, near_sdk::NearToken::from_yoctonear(0));
    }

    /// Opens a Draft: takes `initial_liquidity` + creation bond + reproduction fee from the
    /// creator's balance in the market's mode.
    #[payable]
    pub fn fund_market(&mut self, market_id: u64, initial_liquidity: U128) {
        let actor = env::predecessor_account_id();
        let before = self.flushed_usage();
        self.internal_fund(&actor, market_id, initial_liquidity.0);
        self.settle_storage(&actor, before, env::attached_deposit());
    }

    /// Buys `outcome` shares for `amount` collateral (fee included) from the caller's balance.
    #[payable]
    pub fn buy(&mut self, market_id: u64, outcome: Side, amount: U128, min_shares_out: U128) -> U128 {
        let actor = env::predecessor_account_id();
        let before = self.flushed_usage();
        let out = self.internal_buy(&actor, market_id, outcome, amount.0, min_shares_out.0);
        self.settle_storage(&actor, before, env::attached_deposit());
        U128(out)
    }

    /// Sells `shares` of `outcome`; the net collateral (after fee) is credited to the caller.
    #[payable]
    pub fn sell(&mut self, market_id: u64, outcome: Side, shares: U128, min_collateral_out: U128) -> U128 {
        let actor = env::predecessor_account_id();
        let before = self.flushed_usage();
        let out = self.internal_sell(&actor, market_id, outcome, shares.0, min_collateral_out.0);
        self.settle_storage(&actor, before, env::attached_deposit());
        U128(out)
    }

    #[payable]
    pub fn add_liquidity(&mut self, market_id: u64, amount: U128) -> U128 {
        let actor = env::predecessor_account_id();
        let before = self.flushed_usage();
        let minted = self.internal_add_liquidity(&actor, market_id, amount.0);
        self.settle_storage(&actor, before, env::attached_deposit());
        U128(minted)
    }

    /// Burns LP shares (all by default) for the pool's YES and NO shares in proportion, and
    /// pays out accrued fees. Allowed in every state after Draft, including while paused.
    #[payable]
    pub fn remove_liquidity(&mut self, market_id: u64, lp: Option<U128>) {
        let actor = env::predecessor_account_id();
        let before = self.flushed_usage();
        let mut m = self.market(market_id);
        require!(m.state != State::Draft, "market not open");
        let mut p = self.position(market_id, &actor);
        let amount = lp.map(|l| l.0).unwrap_or(p.lp.0);
        require!(amount > 0 && amount <= p.lp.0, "invalid LP amount");
        self.remove_lp(&mut m, &actor, &mut p, amount);
        self.save_position(market_id, &actor, p);
        self.save_market(m);
        self.settle_storage(&actor, before, env::attached_deposit());
    }
}

impl Contract {
    pub(crate) fn internal_fund(&mut self, actor: &AccountId, market_id: u64, liquidity: u128) {
        self.assert_not_paused();
        let mut m = self.market(market_id);
        require!(m.creator == *actor, "creator only");
        require!(m.state == State::Draft, "market already funded");
        require!(m.lock_time > now(), "lock_time has passed; create a new market");
        require!(liquidity >= self.params(m.mode).min_liquidity.0, "initial liquidity below minimum");
        let total = liquidity + m.creation_bond.0 + m.repro_fee.0;
        self.debit(m.mode, actor, total);

        let mut p = self.position(market_id, actor);
        self.provide_lp(&mut m, actor, &mut p, liquidity);
        m.state = State::Open;
        self.stats.markets += 1;
        emit(
            "market_opened",
            json!({ "market_id": market_id, "liquidity": U128(liquidity), "bond": m.creation_bond, "repro_fee": m.repro_fee }),
        );
        self.record_price(&m);
        self.save_position(market_id, actor, p);
        self.save_market(m);
    }

    pub(crate) fn internal_buy(&mut self, actor: &AccountId, market_id: u64, side: Side, amount: u128, min_out: u128) -> u128 {
        self.assert_not_paused();
        let mut m = self.market(market_id);
        assert_trading(&m);
        require!(amount > 0, "amount must be positive");
        self.debit(m.mode, actor, amount);
        let (fee_lp, fee_treasury) = self.split_fee(amount);
        let invest = amount - fee_lp - fee_treasury;
        let (out, pool) = fpmm::buy(pool_of(&m), side, invest);
        require!(out >= min_out, format!("slippage: would receive {out} shares, minimum {min_out}"));
        set_pool(&mut m, pool);
        m.collateral.0 += invest;
        self.take_fees(&mut m, fee_lp, fee_treasury);

        let mut p = self.position(market_id, actor);
        match side {
            Side::Yes => p.yes.0 += out,
            Side::No => p.no.0 += out,
        }
        p.spent.0 += amount;
        self.after_trade(&mut m, actor, "buy", side, amount, out);
        self.save_position(market_id, actor, p);
        self.save_market(m);
        out
    }

    pub(crate) fn internal_sell(&mut self, actor: &AccountId, market_id: u64, side: Side, shares: u128, min_out: u128) -> u128 {
        self.assert_not_paused();
        let mut m = self.market(market_id);
        assert_trading(&m);
        let mut p = self.position(market_id, actor);
        let held = match side {
            Side::Yes => &mut p.yes,
            Side::No => &mut p.no,
        };
        require!(shares > 0 && shares <= held.0, "not enough shares");
        held.0 -= shares;
        let (gross, pool) = fpmm::sell(pool_of(&m), side, shares);
        let (fee_lp, fee_treasury) = self.split_fee(gross);
        let net = gross - fee_lp - fee_treasury;
        require!(net >= min_out, format!("slippage: would receive {net}, minimum {min_out}"));
        set_pool(&mut m, pool);
        m.collateral.0 -= gross;
        self.take_fees(&mut m, fee_lp, fee_treasury);
        self.credit(m.mode, actor, net);
        p.received.0 += net;
        self.after_trade(&mut m, actor, "sell", side, net, shares);
        self.save_position(market_id, actor, p);
        self.save_market(m);
        net
    }

    pub(crate) fn internal_add_liquidity(&mut self, actor: &AccountId, market_id: u64, amount: u128) -> u128 {
        self.assert_not_paused();
        let mut m = self.market(market_id);
        assert_trading(&m);
        require!(amount > 0, "amount must be positive");
        self.debit(m.mode, actor, amount);
        let mut p = self.position(market_id, actor);
        let minted = self.provide_lp(&mut m, actor, &mut p, amount);
        self.save_position(market_id, actor, p);
        self.save_market(m);
        minted
    }

    /// Adds liquidity for `p`'s owner. Collateral must already be debited.
    fn provide_lp(&mut self, m: &mut Market, owner: &AccountId, p: &mut Position, amount: u128) -> u128 {
        self.settle_lp_fees(m, owner, p);
        let (minted, back_yes, back_no, pool) = fpmm::add_liquidity(pool_of(m), m.lp_supply.0, amount);
        set_pool(m, pool);
        m.lp_supply.0 += minted;
        m.collateral.0 += amount;
        p.lp.0 += minted;
        p.yes.0 += back_yes;
        p.no.0 += back_no;
        p.fee_debt = U128(mul_div_floor(p.lp.0, m.lp_fee_per_share.0, ACC_SCALE));
        p.spent.0 += amount;
        emit(
            "liquidity",
            json!({ "market_id": m.id, "account_id": owner, "action": "add", "amount": U128(amount), "lp": U128(minted) }),
        );
        minted
    }

    /// Burns `lp` of `p`, moving the pool's shares into the position and paying out fees.
    pub(crate) fn remove_lp(&mut self, m: &mut Market, account: &AccountId, p: &mut Position, lp: u128) {
        self.settle_lp_fees(m, account, p);
        let (yes_out, no_out, pool) = fpmm::remove_liquidity(pool_of(m), m.lp_supply.0, lp);
        set_pool(m, pool);
        m.lp_supply.0 -= lp;
        p.lp.0 -= lp;
        p.yes.0 += yes_out;
        p.no.0 += no_out;
        p.fee_debt = U128(mul_div_floor(p.lp.0, m.lp_fee_per_share.0, ACC_SCALE));
        emit(
            "liquidity",
            json!({ "market_id": m.id, "account_id": account, "action": "remove", "lp": U128(lp), "yes": U128(yes_out), "no": U128(no_out) }),
        );
    }

    /// Pays `account` its accrued LP fees and resets its fee debt.
    pub(crate) fn settle_lp_fees(&mut self, m: &mut Market, account: &AccountId, p: &mut Position) {
        let pending = pending_fees(m, p).min(m.lp_fees.0);
        if pending > 0 {
            m.lp_fees.0 -= pending;
            self.credit(m.mode, account, pending);
            p.received.0 += pending;
        }
        p.fee_debt = U128(mul_div_floor(p.lp.0, m.lp_fee_per_share.0, ACC_SCALE));
    }

    fn split_fee(&self, amount: u128) -> (u128, u128) {
        let fee = amount * self.config.fee_bps as u128 / BPS;
        let treasury = fee * self.config.treasury_fee_share_bps as u128 / BPS;
        (fee - treasury, treasury)
    }

    fn take_fees(&mut self, m: &mut Market, fee_lp: u128, fee_treasury: u128) {
        let treasury = self.config.treasury.clone();
        if m.lp_supply.0 == 0 {
            self.credit(m.mode, &treasury, fee_lp + fee_treasury);
            return;
        }
        m.lp_fees.0 += fee_lp;
        m.lp_fee_per_share.0 += mul_div_floor(fee_lp, ACC_SCALE, m.lp_supply.0);
        self.credit(m.mode, &treasury, fee_treasury);
    }

    fn after_trade(&mut self, m: &mut Market, actor: &AccountId, action: &str, side: Side, collateral: u128, shares: u128) {
        m.volume.0 += collateral;
        m.trades += 1;
        match m.mode {
            Mode::Money => self.stats.volume_money.0 += collateral,
            Mode::Points => self.stats.volume_points.0 += collateral,
        }
        emit(
            "trade",
            json!({
                "market_id": m.id, "account_id": actor, "action": action, "outcome": side,
                "collateral": U128(collateral), "shares": U128(shares), "yes_price_ppm": yes_price(m) as u32,
            }),
        );
        self.record_price(m);
    }
}

pub(crate) fn assert_trading(m: &Market) {
    require!(m.state == State::Open, "market is not open for trading");
    require!(now() < m.lock_time, "market has passed its lock time; call lock()");
}

fn set_pool(m: &mut Market, pool: fpmm::Pool) {
    m.yes_pool = U128(pool.yes);
    m.no_pool = U128(pool.no);
}
