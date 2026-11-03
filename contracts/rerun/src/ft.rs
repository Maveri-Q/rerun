//! NEP-141 collateral: deposits via `ft_transfer_call` (with an optional action in `msg`)
//! and withdrawals with a refund callback if the transfer fails.

use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, json};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseError, PromiseOrValue};

use crate::events::emit;
use crate::fpmm::Side;
use crate::types::{ChallengeReason, Mode};
use crate::*;

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_ON_WITHDRAW: Gas = Gas::from_tgas(10);

/// `msg` of `ft_transfer_call`. Empty msg = plain deposit. The transferred amount is
/// credited first; actions then spend from the balance and any remainder stays withdrawable.
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", tag = "action", rename_all = "snake_case")]
enum TransferMsg {
    Deposit,
    /// Opens a Draft market: `initial_liquidity` + creation bond + reproduction fee.
    Fund { market_id: u64, initial_liquidity: U128 },
    /// Spends the whole transferred amount on `outcome`.
    Buy { market_id: u64, outcome: Side, min_shares_out: U128 },
    /// Adds the whole transferred amount as liquidity.
    AddLiquidity { market_id: u64 },
    Challenge { market_id: u64, reason: ChallengeReason, note_hash: String },
}

#[near]
impl Contract {
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.config.collateral_token, "unsupported token");
        let before = self.flushed_usage();
        let parsed: TransferMsg = if msg.is_empty() {
            TransferMsg::Deposit
        } else {
            serde_json::from_str(&msg).unwrap_or_else(|e| env::panic_str(&format!("invalid msg: {e}")))
        };
        self.credit(Mode::Money, &sender_id, amount.0);
        // Actions must target a money market; a panic here makes the token contract refund.
        let money_market = |c: &Self, id: u64| require!(c.market(id).mode == Mode::Money, "not a money market");
        match parsed {
            TransferMsg::Deposit => {}
            TransferMsg::Fund { market_id, initial_liquidity } => {
                money_market(self, market_id);
                self.internal_fund(&sender_id, market_id, initial_liquidity.0);
            }
            TransferMsg::Buy { market_id, outcome, min_shares_out } => {
                money_market(self, market_id);
                self.internal_buy(&sender_id, market_id, outcome, amount.0, min_shares_out.0);
            }
            TransferMsg::AddLiquidity { market_id } => {
                money_market(self, market_id);
                self.internal_add_liquidity(&sender_id, market_id, amount.0);
            }
            TransferMsg::Challenge { market_id, reason, note_hash } => {
                money_market(self, market_id);
                self.internal_challenge(&sender_id, market_id, reason, note_hash);
            }
        }
        emit("deposited", json!({ "account_id": sender_id, "amount": amount }));
        self.settle_storage(&sender_id, before, NearToken::from_yoctonear(0));
        PromiseOrValue::Value(U128(0))
    }

    /// Sends collateral-token balance (all by default) to the caller. Requires 1 yoctoNEAR.
    #[payable]
    pub fn withdraw(&mut self, amount: Option<U128>) -> Promise {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        let amount = amount.map(|a| a.0).unwrap_or_else(|| self.balance_of(Mode::Money, &account));
        require!(amount > 0, "nothing to withdraw");
        // Debit first: no re-entrancy window. The callback restores it if the transfer fails.
        self.debit(Mode::Money, &account, amount);
        Promise::new(self.config.collateral_token.clone())
            .function_call(
                "ft_transfer".to_string(),
                json!({ "receiver_id": account, "amount": U128(amount) }).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_FT_TRANSFER,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_WITHDRAW).on_withdraw(account, U128(amount)))
    }

    #[private]
    pub fn on_withdraw(&mut self, account: AccountId, amount: U128, #[callback_result] result: Result<(), PromiseError>) -> bool {
        if result.is_ok() {
            emit("withdrawn", json!({ "account_id": account, "amount": amount }));
            true
        } else {
            self.credit(Mode::Money, &account, amount.0);
            emit("withdraw_failed", json!({ "account_id": account, "amount": amount }));
            false
        }
    }
}
