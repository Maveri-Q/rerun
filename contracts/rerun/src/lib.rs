//! RERUN market contract: research-claim registry, binary FPMM markets in money or points
//! mode, the reproduction lifecycle with challenges, and the Lab registry.
//!
//! Units: amounts are in the collateral token's smallest unit (points use 6 decimals too),
//! times are Unix seconds.

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, IterableSet, LookupMap, LookupSet};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

pub mod events;
pub mod fpmm;
mod ft;
mod labs;
mod lifecycle;
mod market;
pub mod math;
pub mod spec;
pub mod types;

use events::emit;
use near_sdk::serde_json::json;
use types::*;

/// Price history ring buffer length per market.
pub const PRICE_HISTORY_LEN: usize = 200;
/// Scale for the LP fee-per-share accumulator.
pub const ACC_SCALE: u128 = 1_000_000_000_000_000_000;
pub const BPS: u128 = 10_000;
pub const MAX_LIST: u32 = 100;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Markets,
    Specs,
    Receipts,
    PriceHistory,
    Positions,
    AccountMarkets,
    Balances,
    Points,
    PointsClaimed,
    StorageBalances,
    Labs,
    ApprovedCodehashes,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    config: Config,
    next_market_id: u64,
    markets: LookupMap<u64, Market>,
    specs: LookupMap<u64, String>,
    receipts: LookupMap<u64, Vec<Receipt>>,
    price_history: LookupMap<u64, Vec<PricePoint>>,
    positions: LookupMap<(u64, AccountId), Position>,
    account_markets: LookupMap<AccountId, Vec<u64>>,
    /// Withdrawable collateral-token balances.
    balances: LookupMap<AccountId, u128>,
    /// Points balances (iterable for the leaderboard).
    points: IterableMap<AccountId, u128>,
    points_claimed: LookupSet<AccountId>,
    /// Prepaid NEAR for storage, used when a call carries no deposit (e.g. `ft_on_transfer`).
    storage_balances: LookupMap<AccountId, u128>,
    labs: IterableMap<AccountId, Lab>,
    approved_codehashes: IterableSet<String>,
    stats: Stats,
}

#[near(serializers = [json])]
pub struct MarketView {
    #[serde(flatten)]
    pub market: Market,
    pub yes_price_ppm: u32,
}

#[near(serializers = [json])]
pub struct PositionView {
    #[serde(flatten)]
    pub position: Position,
    pub pending_lp_fees: U128,
}

#[near(serializers = [json])]
pub struct StatsView {
    #[serde(flatten)]
    pub stats: Stats,
    /// REPRODUCED / (REPRODUCED + NOT_REPRODUCED + BROKEN), in basis points; null with no results yet.
    pub reproduction_rate_bps: Option<u32>,
}

#[near(serializers = [json])]
pub struct LeaderboardEntry {
    pub account_id: AccountId,
    pub points: U128,
}

#[near]
impl Contract {
    #[init]
    #[private] // only the contract account itself, so nobody can front-run initialisation
    pub fn new(owner: AccountId, collateral_token: AccountId, treasury: AccountId, lab_fee_recipient: AccountId) -> Self {
        // Defaults sized for a 6-decimal stablecoin; points use the same 6-decimal unit.
        const UNIT: u128 = 1_000_000;
        let params = |bond: u128, fee: u128| ModeParams {
            creation_bond: U128(bond * UNIT),
            repro_fee: U128(fee * UNIT),
            min_liquidity: U128(10 * UNIT),
            challenge_bond_min: U128(5 * UNIT),
            challenge_bond_bps: 500,
        };
        Self {
            config: Config {
                owner,
                pending_owner: None,
                collateral_token,
                treasury,
                lab_fee_recipient,
                fee_bps: 100,
                treasury_fee_share_bps: 2_000,
                challenger_reward_bps: 5_000,
                run_timeout_secs: 3 * 3600,
                min_challenge_window: 60,
                max_challenge_window: 14 * 86_400,
                points_claim_amount: U128(1_000 * UNIT),
                money: params(10, 2),
                points: params(50, 10),
                paused: false,
            },
            next_market_id: 0,
            markets: LookupMap::new(StorageKey::Markets),
            specs: LookupMap::new(StorageKey::Specs),
            receipts: LookupMap::new(StorageKey::Receipts),
            price_history: LookupMap::new(StorageKey::PriceHistory),
            positions: LookupMap::new(StorageKey::Positions),
            account_markets: LookupMap::new(StorageKey::AccountMarkets),
            balances: LookupMap::new(StorageKey::Balances),
            points: IterableMap::new(StorageKey::Points),
            points_claimed: LookupSet::new(StorageKey::PointsClaimed),
            storage_balances: LookupMap::new(StorageKey::StorageBalances),
            labs: IterableMap::new(StorageKey::Labs),
            approved_codehashes: IterableSet::new(StorageKey::ApprovedCodehashes),
            stats: Stats::default(),
        }
    }

    // ---------------------------------------------------------------- admin

    pub fn set_fees(&mut self, fee_bps: u32, treasury_fee_share_bps: u32) {
        self.assert_owner();
        require!(fee_bps <= 500, "fee_bps max 500 (5%)");
        require!(treasury_fee_share_bps as u128 <= BPS, "treasury_fee_share_bps max 10000");
        self.config.fee_bps = fee_bps;
        self.config.treasury_fee_share_bps = treasury_fee_share_bps;
    }

    pub fn set_mode_params(&mut self, mode: Mode, params: ModeParams) {
        self.assert_owner();
        require!(params.challenge_bond_bps as u128 <= BPS, "challenge_bond_bps max 10000");
        match mode {
            Mode::Money => self.config.money = params,
            Mode::Points => self.config.points = params,
        }
    }

    pub fn set_timing(&mut self, run_timeout_secs: u64, min_challenge_window: u64, max_challenge_window: u64) {
        self.assert_owner();
        require!(run_timeout_secs >= 60 && min_challenge_window <= max_challenge_window, "invalid timing");
        self.config.run_timeout_secs = run_timeout_secs;
        self.config.min_challenge_window = min_challenge_window;
        self.config.max_challenge_window = max_challenge_window;
    }

    pub fn set_treasury(&mut self, treasury: AccountId) {
        self.assert_owner();
        self.config.treasury = treasury;
    }

    pub fn set_lab_fee_recipient(&mut self, lab_fee_recipient: AccountId) {
        self.assert_owner();
        self.config.lab_fee_recipient = lab_fee_recipient;
    }

    /// Pausing stops new markets, trading, liquidity and challenges. Redeeming, refunds,
    /// removing liquidity and withdrawals always stay available.
    pub fn pause(&mut self) {
        self.assert_owner();
        self.config.paused = true;
        emit("paused", json!({ "paused": true }));
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.config.paused = false;
        emit("paused", json!({ "paused": false }));
    }

    /// Two-step ownership transfer: the new owner must call `accept_ownership`.
    pub fn transfer_ownership(&mut self, new_owner: AccountId) {
        self.assert_owner();
        self.config.pending_owner = Some(new_owner);
    }

    pub fn accept_ownership(&mut self) {
        let caller = env::predecessor_account_id();
        require!(self.config.pending_owner.as_ref() == Some(&caller), "not the pending owner");
        self.config.owner = caller;
        self.config.pending_owner = None;
    }

    // ---------------------------------------------------------------- storage

    /// Prepays NEAR for storage used by later calls that carry no deposit (FT transfers, trades).
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) -> U128 {
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        let amount = env::attached_deposit().as_yoctonear();
        let before = self.flushed_usage();
        let current = self.storage_balances.get(&account).copied().unwrap_or(0);
        self.storage_balances.insert(account.clone(), current + amount);
        let entry_cost = self.flushed_usage().saturating_sub(before) as u128 * env::storage_byte_cost().as_yoctonear();
        require!(current + amount >= entry_cost, "deposit does not cover its own storage entry");
        let balance = current + amount - entry_cost;
        self.storage_balances.insert(account, balance);
        U128(balance)
    }

    /// Withdraws unused prepaid storage NEAR (all of it by default).
    #[payable]
    pub fn storage_withdraw(&mut self, amount: Option<U128>) -> U128 {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        let balance = self.storage_balances.get(&account).copied().unwrap_or(0);
        let amount = amount.map(|a| a.0).unwrap_or(balance);
        require!(amount <= balance, "amount exceeds storage balance");
        self.storage_balances.insert(account.clone(), balance - amount);
        if amount > 0 {
            // Detached transfer: scheduled when dropped.
            let _ = Promise::new(account).transfer(NearToken::from_yoctonear(amount));
        }
        U128(balance - amount)
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.storage_balances.get(&account_id).copied().unwrap_or(0))
    }

    // ---------------------------------------------------------------- points

    /// Gives the caller their one-time points grant. Attach a little NEAR (~0.01) for storage.
    #[payable]
    pub fn claim_points(&mut self) -> U128 {
        let account = env::predecessor_account_id();
        let before = self.flushed_usage();
        require!(self.points_claimed.insert(account.clone()), "points already claimed");
        let amount = self.config.points_claim_amount.0;
        self.credit(Mode::Points, &account, amount);
        self.settle_storage(&account, before, env::attached_deposit());
        emit("points_claimed", json!({ "account_id": account, "amount": U128(amount) }));
        U128(self.balance_of(Mode::Points, &account))
    }

    // ---------------------------------------------------------------- views

    pub fn get_config(&self) -> &Config {
        &self.config
    }

    pub fn get_market(&self, market_id: u64) -> Option<MarketView> {
        self.markets.get(&market_id).map(Self::view)
    }

    /// Markets by id, newest first when `from` is omitted. Filters are optional.
    pub fn list_markets(&self, state: Option<State>, mode: Option<Mode>, from: Option<u64>, limit: Option<u32>) -> Vec<MarketView> {
        let limit = limit.unwrap_or(20).min(MAX_LIST) as usize;
        let mut id = from.unwrap_or(self.next_market_id.saturating_sub(1)) as i64;
        let mut out = Vec::new();
        while id >= 0 && out.len() < limit {
            if let Some(m) = self.markets.get(&(id as u64)) {
                if state.is_none_or(|s| s == m.state) && mode.is_none_or(|md| md == m.mode) {
                    out.push(Self::view(m));
                }
            }
            id -= 1;
        }
        out
    }

    pub fn get_spec(&self, market_id: u64) -> Option<&String> {
        self.specs.get(&market_id)
    }

    pub fn get_receipts(&self, market_id: u64) -> Vec<Receipt> {
        self.receipts.get(&market_id).cloned().unwrap_or_default()
    }

    pub fn get_price_history(&self, market_id: u64) -> Vec<PricePoint> {
        self.price_history.get(&market_id).cloned().unwrap_or_default()
    }

    pub fn get_position(&self, account_id: AccountId, market_id: u64) -> Option<PositionView> {
        let market = self.markets.get(&market_id)?;
        let position = self.positions.get(&(market_id, account_id))?.clone();
        let pending = pending_fees(market, &position);
        Some(PositionView { position, pending_lp_fees: U128(pending) })
    }

    pub fn get_account_markets(&self, account_id: AccountId) -> Vec<u64> {
        self.account_markets.get(&account_id).cloned().unwrap_or_default()
    }

    pub fn get_balance(&self, account_id: AccountId, mode: Mode) -> U128 {
        U128(self.balance_of(mode, &account_id))
    }

    pub fn get_stats(&self) -> StatsView {
        let s = &self.stats;
        let decided = s.reproduced + s.not_reproduced + s.broken;
        let rate = (decided > 0).then(|| (s.reproduced as u128 * BPS / decided as u128) as u32);
        StatsView { stats: s.clone(), reproduction_rate_bps: rate }
    }

    /// Forecasters ranked by points balance ("reputation for being right").
    pub fn get_points_leaderboard(&self, limit: Option<u32>) -> Vec<LeaderboardEntry> {
        // Fee-receiving system accounts are not forecasters.
        let system = [&self.config.treasury, &self.config.lab_fee_recipient];
        let mut all: Vec<(&AccountId, &u128)> = self.points.iter().filter(|(a, _)| !system.contains(a)).collect();
        all.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
        all.into_iter()
            .take(limit.unwrap_or(20).min(MAX_LIST) as usize)
            .map(|(a, p)| LeaderboardEntry { account_id: a.clone(), points: U128(*p) })
            .collect()
    }
}

// -------------------------------------------------------------------- internals

impl Contract {
    pub(crate) fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.config.owner, "owner only");
    }

    pub(crate) fn assert_not_paused(&self) {
        require!(!self.config.paused, "contract is paused");
    }

    pub(crate) fn params(&self, mode: Mode) -> &ModeParams {
        match mode {
            Mode::Money => &self.config.money,
            Mode::Points => &self.config.points,
        }
    }

    pub(crate) fn market(&self, id: u64) -> Market {
        self.markets.get(&id).cloned().unwrap_or_else(|| env::panic_str("market not found"))
    }

    pub(crate) fn save_market(&mut self, m: Market) {
        self.markets.insert(m.id, m);
    }

    pub(crate) fn balance_of(&self, mode: Mode, account: &AccountId) -> u128 {
        match mode {
            Mode::Money => self.balances.get(account).copied().unwrap_or(0),
            Mode::Points => self.points.get(account).copied().unwrap_or(0),
        }
    }

    pub(crate) fn credit(&mut self, mode: Mode, account: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let new = self.balance_of(mode, account) + amount;
        match mode {
            Mode::Money => self.balances.insert(account.clone(), new),
            Mode::Points => self.points.insert(account.clone(), new),
        };
    }

    pub(crate) fn debit(&mut self, mode: Mode, account: &AccountId, amount: u128) {
        let bal = self.balance_of(mode, account);
        require!(bal >= amount, format!("insufficient {} balance: have {bal}, need {amount}", mode_name(mode)));
        match mode {
            Mode::Money => self.balances.insert(account.clone(), bal - amount),
            Mode::Points => self.points.insert(account.clone(), bal - amount),
        };
    }

    pub(crate) fn position(&self, market_id: u64, account: &AccountId) -> Position {
        self.positions.get(&(market_id, account.clone())).cloned().unwrap_or_default()
    }

    pub(crate) fn save_position(&mut self, market_id: u64, account: &AccountId, p: Position) {
        let key = (market_id, account.clone());
        if !self.positions.contains_key(&key) {
            let mut ids = self.account_markets.get(account).cloned().unwrap_or_default();
            ids.push(market_id);
            self.account_markets.insert(account.clone(), ids);
        }
        self.positions.insert(key, p);
    }

    /// Writes cached collection changes so `env::storage_usage()` is accurate.
    pub(crate) fn flushed_usage(&mut self) -> u64 {
        self.markets.flush();
        self.specs.flush();
        self.receipts.flush();
        self.price_history.flush();
        self.positions.flush();
        self.account_markets.flush();
        self.balances.flush();
        self.points.flush();
        self.storage_balances.flush();
        self.labs.flush();
        self.approved_codehashes.flush();
        env::storage_usage()
    }

    /// Charges the storage this call added to `payer`: first from the attached deposit, then
    /// from their prepaid storage balance. Refunds unused deposit and freed storage.
    pub(crate) fn settle_storage(&mut self, payer: &AccountId, before: u64, attached: NearToken) {
        let after = self.flushed_usage();
        let byte_cost = env::storage_byte_cost().as_yoctonear();
        let mut refund = attached.as_yoctonear();
        if after > before {
            let cost = (after - before) as u128 * byte_cost;
            let from_attached = cost.min(refund);
            refund -= from_attached;
            let rest = cost - from_attached;
            if rest > 0 {
                let bal = self.storage_balances.get(payer).copied().unwrap_or(0);
                if bal < rest {
                    env::panic_str(&format!(
                        "not enough storage deposit: attach or storage_deposit {} more yoctoNEAR",
                        rest - bal
                    ));
                }
                self.storage_balances.insert(payer.clone(), bal - rest);
            }
        } else {
            refund += (before - after) as u128 * byte_cost;
        }
        if refund > 0 {
            let _ = Promise::new(payer.clone()).transfer(NearToken::from_yoctonear(refund));
        }
    }

    pub(crate) fn record_price(&mut self, m: &Market) {
        let mut h = self.price_history.get(&m.id).cloned().unwrap_or_default();
        if h.len() >= PRICE_HISTORY_LEN {
            h.remove(0);
        }
        h.push(PricePoint { t: now(), yes_ppm: yes_price(m) as u32 });
        self.price_history.insert(m.id, h);
    }

    fn view(m: &Market) -> MarketView {
        MarketView { market: m.clone(), yes_price_ppm: yes_price(m) as u32 }
    }
}

pub(crate) fn now() -> u64 {
    env::block_timestamp_ms() / 1000
}

pub(crate) fn mode_name(mode: Mode) -> &'static str {
    match mode {
        Mode::Money => "money",
        Mode::Points => "points",
    }
}

pub(crate) fn pool_of(m: &Market) -> fpmm::Pool {
    fpmm::Pool { yes: m.yes_pool.0, no: m.no_pool.0 }
}

pub(crate) fn yes_price(m: &Market) -> u128 {
    pool_of(m).yes_price()
}

pub(crate) fn pending_fees(m: &Market, p: &Position) -> u128 {
    math::mul_div_floor(p.lp.0, m.lp_fee_per_share.0, ACC_SCALE).saturating_sub(p.fee_debt.0)
}

#[cfg(test)]
mod tests;
