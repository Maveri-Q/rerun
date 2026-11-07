//! A tiny example of another app plugging into RERUN. Two sides bet NEAR on whether one claim holds up.
//! Nobody decides who won: `settle` asks the RERUN contract for its verdict and the bet follows it.
//!
//! It's a demonstration, not a product: a real app would close bets before the claim's forecasting ends,
//! so nobody can bet on a known result.

use near_sdk::store::LookupMap;
use near_sdk::{AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, env, ext_contract, near, require};

/// The part of RERUN's `get_verdict` answer this contract needs. The rest of the answer is ignored.
#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Outcome {
    Reproduced,
    NotReproduced,
    Broken,
    Invalid,
}

#[near(serializers = [json])]
pub struct Verdict {
    pub is_final: bool,
    pub outcome: Option<Outcome>,
}

#[ext_contract(rerun)]
#[allow(dead_code)]
trait Rerun {
    fn get_verdict(&self, claim_id: u64) -> Option<Verdict>;
}

#[ext_contract(this_contract)]
#[allow(dead_code)]
trait ThisContract {
    fn on_verdict(&mut self) -> String;
}

/// A millionth of a NEAR, and the smallest bet is a thousand of them.
const UNIT: u128 = 10u128.pow(18);

/// How the bet ended.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Result_ {
    HoldsUp,
    DoesntHoldUp,
    /// The claim was inconclusive or its code broke, so everyone gets their stake back.
    Void,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct VerdictBet {
    rerun: AccountId,
    claim_id: u64,
    holds_up: LookupMap<AccountId, u128>,
    doesnt: LookupMap<AccountId, u128>,
    total_holds_up: u128,
    total_doesnt: u128,
    result: Option<Result_>,
}

#[near]
impl VerdictBet {
    #[init]
    pub fn new(rerun: AccountId, claim_id: u64) -> Self {
        Self { rerun, claim_id, holds_up: LookupMap::new(b"y"), doesnt: LookupMap::new(b"n"), total_holds_up: 0, total_doesnt: 0, result: None }
    }

    /// Stakes the attached NEAR on one side.
    #[payable]
    pub fn bet(&mut self, holds_up: bool) {
        require!(self.result.is_none(), "this bet is settled");
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount >= 1000 * UNIT, "attach at least 0.001 NEAR to bet");
        let who = env::predecessor_account_id();
        let side = if holds_up { &mut self.holds_up } else { &mut self.doesnt };
        let staked = side.get(&who).copied().unwrap_or(0);
        side.insert(who, staked + amount);
        if holds_up {
            self.total_holds_up += amount;
        } else {
            self.total_doesnt += amount;
        }
    }

    /// Anyone can call this. It reads RERUN's verdict and settles the bet from the answer.
    pub fn settle(&mut self) -> Promise {
        require!(self.result.is_none(), "this bet is already settled");
        rerun::ext(self.rerun.clone())
            .with_static_gas(Gas::from_tgas(10))
            .get_verdict(self.claim_id)
            .then(this_contract::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(20)).on_verdict())
    }

    #[private]
    pub fn on_verdict(&mut self, #[callback_result] answer: Result<Option<Verdict>, PromiseError>) -> Result_ {
        let verdict = answer.ok().flatten().unwrap_or_else(|| env::panic_str("RERUN has no verdict for this claim"));
        require!(verdict.is_final, "the claim isn't final yet");
        let result = match verdict.outcome {
            Some(Outcome::Reproduced) => Result_::HoldsUp,
            Some(Outcome::NotReproduced) => Result_::DoesntHoldUp,
            _ => Result_::Void,
        };
        self.result = Some(result);
        env::log_str(&format!("settled from RERUN claim {}: {:?}", self.claim_id, result));
        result
    }

    /// Pays the caller what they're owed: a share of the whole pot if they won, their stake if it's void.
    pub fn collect(&mut self) -> Promise {
        let result = self.result.unwrap_or_else(|| env::panic_str("this bet isn't settled yet"));
        let who = env::predecessor_account_id();
        let on_yes = self.holds_up.get(&who).copied().unwrap_or(0);
        let on_no = self.doesnt.get(&who).copied().unwrap_or(0);
        let pot = self.total_holds_up + self.total_doesnt;
        let share = |stake: u128, winners: u128| if winners == 0 { 0 } else { share_of_pot(stake, pot, winners) };
        let nobody_won = (result == Result_::HoldsUp && self.total_holds_up == 0) || (result == Result_::DoesntHoldUp && self.total_doesnt == 0);
        let owed = match result {
            _ if nobody_won => on_yes + on_no,
            Result_::Void => on_yes + on_no,
            Result_::HoldsUp => share(on_yes, self.total_holds_up),
            Result_::DoesntHoldUp => share(on_no, self.total_doesnt),
        };
        require!(owed > 0, "nothing to collect");
        self.holds_up.remove(&who);
        self.doesnt.remove(&who);
        Promise::new(who).transfer(NearToken::from_yoctonear(owed))
    }

    pub fn get_state(&self) -> (u64, String, String, Option<Result_>) {
        (self.claim_id, self.total_holds_up.to_string(), self.total_doesnt.to_string(), self.result)
    }
}

/// stake * pot / winners, in millionths of a NEAR, because two amounts in yocto would overflow a u128.
/// It rounds the winners' total up, so the payouts can never add up to more than the pot.
fn share_of_pot(stake: u128, pot: u128, winners: u128) -> u128 {
    (stake / UNIT) * (pot / UNIT) / winners.div_ceil(UNIT) * UNIT
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const NEAR: u128 = 10u128.pow(24);

    fn acting_as(who: &str, deposit: u128) {
        let id: AccountId = who.parse().unwrap();
        testing_env!(
            VMContextBuilder::new()
                .current_account_id("bet.testnet".parse().unwrap())
                .predecessor_account_id(id.clone())
                .signer_account_id(id)
                .attached_deposit(NearToken::from_yoctonear(deposit))
                .account_balance(NearToken::from_near(100))
                .build()
        );
    }

    fn bets() -> VerdictBet {
        acting_as("bet.testnet", 0);
        let mut c = VerdictBet::new("rerun.testnet".parse().unwrap(), 26);
        acting_as("alice.testnet", 3 * NEAR);
        c.bet(true);
        acting_as("bob.testnet", NEAR);
        c.bet(false);
        c
    }

    fn answer(is_final: bool, outcome: Option<Outcome>) -> Result<Option<Verdict>, PromiseError> {
        Ok(Some(Verdict { is_final, outcome }))
    }

    #[test]
    fn follows_the_verdict() {
        let mut c = bets();
        acting_as("bet.testnet", 0);
        assert_eq!(c.on_verdict(answer(true, Some(Outcome::NotReproduced))), Result_::DoesntHoldUp);
        acting_as("bob.testnet", 0);
        let _ = c.collect();
        assert_eq!(c.doesnt.get(&"bob.testnet".parse::<AccountId>().unwrap()), None);
    }

    #[test]
    #[should_panic(expected = "the claim isn't final yet")]
    fn waits_for_a_final_verdict() {
        let mut c = bets();
        acting_as("bet.testnet", 0);
        c.on_verdict(answer(false, Some(Outcome::Reproduced)));
    }

    #[test]
    #[should_panic(expected = "RERUN has no verdict")]
    fn refuses_a_claim_with_no_verdict() {
        let mut c = bets();
        acting_as("bet.testnet", 0);
        c.on_verdict(Ok(None));
    }

    #[test]
    fn an_inconclusive_claim_gives_stakes_back() {
        let mut c = bets();
        acting_as("bet.testnet", 0);
        assert_eq!(c.on_verdict(answer(true, Some(Outcome::Invalid))), Result_::Void);
        acting_as("alice.testnet", 0);
        let _ = c.collect();
    }

    #[test]
    #[should_panic(expected = "nothing to collect")]
    fn the_loser_collects_nothing() {
        let mut c = bets();
        acting_as("bet.testnet", 0);
        c.on_verdict(answer(true, Some(Outcome::NotReproduced)));
        acting_as("alice.testnet", 0);
        let _ = c.collect();
    }

    #[test]
    #[should_panic(expected = "nothing to collect")]
    fn nobody_collects_twice() {
        let mut c = bets();
        acting_as("bet.testnet", 0);
        c.on_verdict(answer(true, Some(Outcome::NotReproduced)));
        acting_as("bob.testnet", 0);
        c.collect();
        let _ = c.collect();
    }

    #[test]
    fn the_winners_split_the_whole_pot() {
        assert_eq!(share_of_pot(NEAR, 4 * NEAR, NEAR), 4 * NEAR);
        assert_eq!(share_of_pot(3 * NEAR, 4 * NEAR, 3 * NEAR), 4 * NEAR);
        assert_eq!(share_of_pot(NEAR, 4 * NEAR, 4 * NEAR), NEAR);
    }

    #[test]
    fn several_winners_never_get_more_than_the_pot() {
        // Whole NEARs on both sides are what would overflow if this multiplied yocto directly.
        let (a, b, pot) = (share_of_pot(NEAR, 4 * NEAR, 3 * NEAR), share_of_pot(2 * NEAR, 4 * NEAR, 3 * NEAR), 4 * NEAR);
        assert_eq!(a, 1_333_333 * UNIT);
        assert!(a + b <= pot && pot - (a + b) < 2 * UNIT);
    }

    #[test]
    #[should_panic(expected = "at least 0.001 NEAR")]
    fn a_bet_too_small_to_count_is_refused() {
        acting_as("bet.testnet", 0);
        let mut c = VerdictBet::new("rerun.testnet".parse().unwrap(), 26);
        acting_as("alice.testnet", 1);
        c.bet(true);
    }
}
