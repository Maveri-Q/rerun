//! Each forecaster's accuracy, as a Brier score. A trade stores what the forecaster moved the odds to,
//! under its own storage keys, so this keeps the stored layout and needs no migration. The forecaster's
//! usual storage settlement pays for it.
//!
//! Brier score: the average of (forecast - result)^2, where the result is 1 if the claim held up and 0 if
//! it didn't. 0 is perfect, and always saying 50% scores 0.25. Inconclusive claims don't count, and nor
//! do trades made before this existed. It's only ever shown to people: nothing that settles a market reads it.

use near_sdk::borsh;
use near_sdk::{env, near, require, AccountId};

use crate::types::{Outcome, State};
use crate::{Contract, ContractExt};

const MAX_ACCOUNTS: usize = 50;
const SCALE: i128 = 1_000_000;

fn key(market_id: u64, account: &AccountId) -> Vec<u8> {
    let mut k = b"__brier/".to_vec();
    k.extend_from_slice(&market_id.to_le_bytes());
    k.extend_from_slice(account.as_bytes());
    k
}

pub(crate) fn record_forecast(market_id: u64, account: &AccountId, yes_price_ppm: u32) {
    let _ = env::storage_write(&key(market_id, account), &borsh::to_vec(&yes_price_ppm).unwrap_or_else(|_| env::panic_str("unwritable forecast")));
}

fn forecast(market_id: u64, account: &AccountId) -> Option<u32> {
    env::storage_read(&key(market_id, account)).and_then(|v| borsh::from_slice(&v).ok())
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Accuracy {
    pub account_id: AccountId,
    /// How many settled claims count towards the score.
    pub scored: u32,
    /// In millionths: 250000 is 0.25. None until a forecast has been scored.
    pub brier_ppm: Option<u32>,
}

#[near]
impl Contract {
    pub fn get_accuracy(&self, account_id: AccountId) -> Accuracy {
        let mut total: i128 = 0;
        let mut scored: u32 = 0;
        for id in self.account_markets.get(&account_id).map(Vec::as_slice).unwrap_or_default() {
            let Some(m) = self.markets.get(id) else { continue };
            let result = match (m.state, m.outcome) {
                (State::Final, Some(Outcome::Reproduced)) => SCALE,
                (State::Final, Some(Outcome::NotReproduced | Outcome::Broken)) => 0,
                _ => continue,
            };
            if let Some(p) = forecast(*id, &account_id) {
                total += (p as i128 - result).pow(2) / SCALE;
                scored += 1;
            }
        }
        Accuracy { account_id, scored, brier_ppm: (scored > 0).then(|| (total / scored as i128) as u32) }
    }

    pub fn get_accuracy_many(&self, accounts: Vec<AccountId>) -> Vec<Accuracy> {
        require!(accounts.len() <= MAX_ACCOUNTS, "ask for at most 50 accounts");
        accounts.into_iter().map(|a| self.get_accuracy(a)).collect()
    }
}
