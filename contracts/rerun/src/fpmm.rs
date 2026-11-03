//! Binary fixed-product market maker (Gnosis/Omen FPMM), integer maths only.
//!
//! One unit of collateral always splits into one YES and one NO share. The pool holds
//! outcome shares with `yes * no = k`. Every rounding step favours the pool, so `k` never
//! decreases. Trading fees are taken in collateral *outside* the pool (see `market.rs`),
//! so they never move the price.

use crate::math::{mul_div_ceil, mul_div_floor, to_u128, U256};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pool {
    pub yes: u128,
    pub no: u128,
}

#[near_sdk::near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum Side {
    Yes,
    No,
}

impl Pool {
    pub fn k(&self) -> U256 {
        U256::from(self.yes) * U256::from(self.no)
    }

    fn get(&self, side: Side) -> (u128, u128) {
        match side {
            Side::Yes => (self.yes, self.no),
            Side::No => (self.no, self.yes),
        }
    }

    fn set(side: Side, this: u128, other: u128) -> Pool {
        match side {
            Side::Yes => Pool { yes: this, no: other },
            Side::No => Pool { yes: other, no: this },
        }
    }

    /// Marginal YES price scaled by `PRICE_SCALE`: `no / (yes + no)`.
    pub fn yes_price(&self) -> u128 {
        if self.yes == 0 && self.no == 0 {
            return PRICE_SCALE / 2;
        }
        mul_div_floor(self.no, PRICE_SCALE, self.yes + self.no)
    }
}

pub const PRICE_SCALE: u128 = 1_000_000;

/// Buying `side` with `x` collateral (fees already removed). Returns (shares out, new pool).
pub fn buy(pool: Pool, side: Side, x: u128) -> (u128, Pool) {
    assert!(x > 0, "amount must be positive");
    let (this, other) = pool.get(side);
    assert!(this > 0 && other > 0, "pool has no liquidity");
    // Split x into x YES + x NO, add both to the pool, then remove bought shares so k holds.
    let other_after = other + x;
    let this_after = mul_div_ceil(this, other, other_after); // ceil: pool keeps the dust
    let out = this + x - this_after;
    (out, Pool::set(side, this_after, other_after))
}

/// Selling `s` shares of `side`. Returns (gross collateral out, new pool).
///
/// Solves `(this + s - c) * (other - c) = this * other` for the smaller root
/// `c = (a - sqrt(a^2 - 4 s other)) / 2` with `a = this + s + other`.
pub fn sell(pool: Pool, side: Side, s: u128) -> (u128, Pool) {
    assert!(s > 0, "amount must be positive");
    let (this, other) = pool.get(side);
    assert!(this > 0 && other > 0, "pool has no liquidity");
    let a = U256::from(this) + U256::from(s) + U256::from(other);
    let disc = a * a - U256::from(4u8) * U256::from(s) * U256::from(other);
    let root = ceil_sqrt(disc); // ceil root -> smaller c: pool keeps the dust
    let mut c = to_u128((a - root) / U256::from(2u8));
    let k = pool.k();
    // Integer rounding can still leave k one unit short; step c down until it holds.
    while c > 0 && U256::from(this + s - c) * U256::from(other - c) < k {
        c -= 1;
    }
    (c, Pool::set(side, this + s - c, other - c))
}

/// Adding `x` collateral of liquidity. Returns (LP shares minted, YES sent back, NO sent back, new pool).
///
/// The pool keeps its price: the scarcer outcome is added in proportion and the surplus
/// of the other outcome goes back to the provider (Omen `addFunding`).
pub fn add_liquidity(pool: Pool, lp_supply: u128, x: u128) -> (u128, u128, u128, Pool) {
    assert!(x > 0, "amount must be positive");
    if lp_supply == 0 {
        return (x, 0, 0, Pool { yes: pool.yes + x, no: pool.no + x });
    }
    let weight = pool.yes.max(pool.no);
    let add_yes = mul_div_floor(x, pool.yes, weight);
    let add_no = mul_div_floor(x, pool.no, weight);
    let minted = mul_div_floor(x, lp_supply, weight);
    (minted, x - add_yes, x - add_no, Pool { yes: pool.yes + add_yes, no: pool.no + add_no })
}

/// Burning `lp` of `lp_supply`. Returns (YES out, NO out, new pool).
pub fn remove_liquidity(pool: Pool, lp_supply: u128, lp: u128) -> (u128, u128, Pool) {
    assert!(lp > 0 && lp <= lp_supply, "invalid LP amount");
    let yes_out = mul_div_floor(pool.yes, lp, lp_supply);
    let no_out = mul_div_floor(pool.no, lp, lp_supply);
    (yes_out, no_out, Pool { yes: pool.yes - yes_out, no: pool.no - no_out })
}

fn ceil_sqrt(n: U256) -> U256 {
    let r = n.integer_sqrt();
    if r * r == n { r } else { r + U256::one() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const M: u128 = 1_000_000; // 1 unit of a 6-decimal token

    #[test]
    fn opening_price_is_one_half() {
        let (_, _, _, pool) = add_liquidity(Pool { yes: 0, no: 0 }, 0, 100 * M);
        assert_eq!(pool.yes_price(), PRICE_SCALE / 2);
    }

    #[test]
    fn buying_yes_raises_yes_price() {
        let pool = Pool { yes: 100 * M, no: 100 * M };
        let (out, after) = buy(pool, Side::Yes, 10 * M);
        assert!(out > 10 * M, "buyer gets more than 1 share per collateral below price 1");
        assert!(after.yes_price() > pool.yes_price());
        assert!(after.k() >= pool.k());
    }

    #[test]
    fn sell_inverts_buy() {
        let pool = Pool { yes: 100 * M, no: 100 * M };
        let (shares, after_buy) = buy(pool, Side::No, 25 * M);
        let (back, after_sell) = sell(after_buy, Side::No, shares);
        assert!(back <= 25 * M && 25 * M - back <= 2, "round trip loses at most rounding dust: {back}");
        assert!(after_sell.k() >= pool.k());
    }

    #[test]
    fn add_liquidity_keeps_price_and_returns_surplus() {
        let pool = Pool { yes: 50 * M, no: 200 * M };
        let (minted, back_yes, back_no, after) = add_liquidity(pool, 100 * M, 20 * M);
        assert_eq!(back_no, 0);
        assert_eq!(back_yes, 15 * M);
        assert_eq!(minted, 10 * M);
        assert_eq!(after.yes_price(), pool.yes_price());
    }

    fn pool_strategy() -> impl Strategy<Value = Pool> {
        (1_000u128..1_000_000_000_000_000, 1_000u128..1_000_000_000_000_000).prop_map(|(yes, no)| Pool { yes, no })
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(2_000))]

        #[test]
        fn k_never_decreases_on_buy(pool in pool_strategy(), x in 1u128..1_000_000_000_000_000, yes in any::<bool>()) {
            let side = if yes { Side::Yes } else { Side::No };
            let (out, after) = buy(pool, side, x);
            prop_assert!(after.k() >= pool.k());
            prop_assert!(out > 0);
        }

        #[test]
        fn k_never_decreases_on_sell(pool in pool_strategy(), s in 1u128..1_000_000_000_000_000, yes in any::<bool>()) {
            let side = if yes { Side::Yes } else { Side::No };
            let (c, after) = sell(pool, side, s);
            prop_assert!(after.k() >= pool.k());
            prop_assert!(after.yes > 0 && after.no > 0);
            // Cannot extract more collateral than the shares are worth at most (1 each).
            prop_assert!(c <= s);
        }

        #[test]
        fn no_free_money_from_round_trips(pool in pool_strategy(), x in 1u128..1_000_000_000_000_000, yes in any::<bool>()) {
            let side = if yes { Side::Yes } else { Side::No };
            let (shares, mid) = buy(pool, side, x);
            let (back, end) = sell(mid, side, shares);
            prop_assert!(back <= x, "bought with {} and sold back for {}", x, back);
            prop_assert!(end.k() >= pool.k());
        }

        #[test]
        fn shares_never_exceed_collateral(pool in pool_strategy(), trades in proptest::collection::vec((any::<bool>(), any::<bool>(), 1u128..1_000_000_000_000), 1..20)) {
            // Track total YES/NO shares in existence vs collateral backing them.
            let mut p = pool;
            let mut collateral = pool.yes.max(pool.no); // initial LP funding
            let mut user_yes: u128 = pool.yes.max(pool.no) - pool.yes; // surplus returned to LP
            let mut user_no: u128 = pool.yes.max(pool.no) - pool.no;
            for (is_buy, is_yes, amt) in trades {
                let side = if is_yes { Side::Yes } else { Side::No };
                let held = if is_yes { user_yes } else { user_no };
                if is_buy {
                    let (out, np) = buy(p, side, amt);
                    collateral += amt;
                    if is_yes { user_yes += out } else { user_no += out }
                    p = np;
                } else if held > 0 {
                    let s = amt.min(held);
                    let (c, np) = sell(p, side, s);
                    collateral -= c;
                    if is_yes { user_yes -= s } else { user_no -= s }
                    p = np;
                }
                // Every share is backed: total YES and total NO both fit within the collateral.
                prop_assert!(p.yes + user_yes <= collateral);
                prop_assert!(p.no + user_no <= collateral);
            }
        }
    }
}
