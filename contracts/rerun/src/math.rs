//! Deterministic fixed-point maths: decimal strings for metrics and the reproduction
//! comparator. The Lab runs the same comparator off-chain; the contract re-runs it so a
//! receipt can never claim an outcome its own numbers contradict.

use uint::construct_uint;

construct_uint! {
    /// 256-bit unsigned integer for intermediate products.
    pub struct U256(4);
}

/// Decimal strings carry at most this many fractional digits.
pub const DECIMAL_PLACES: u32 = 18;
const SCALE: i128 = 1_000_000_000_000_000_000;
/// Integer part must be below 1e20 so the scaled value fits comfortably in an i128.
const MAX_INT_DIGITS: usize = 20;

/// Parses `-?digits(.digits)?` into an i128 scaled by 1e18. No exponents, no `+`, no
/// whitespace, so every accepted string has one meaning in Rust, TypeScript and Python.
pub fn parse_decimal(s: &str) -> Result<i128, String> {
    let (neg, body) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s),
    };
    let (int_part, frac_part) = match body.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (body, None),
    };
    let digits = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit());
    if !digits(int_part) || int_part.len() > MAX_INT_DIGITS {
        return Err(format!("invalid decimal '{s}'"));
    }
    let frac = match frac_part {
        Some(f) if !digits(f) || f.len() > DECIMAL_PLACES as usize => {
            return Err(format!("invalid decimal '{s}' (max {DECIMAL_PLACES} fractional digits)"));
        }
        Some(f) => f,
        None => "",
    };
    let int: i128 = int_part.parse().map_err(|_| format!("invalid decimal '{s}'"))?;
    let mut frac_scaled: i128 = if frac.is_empty() { 0 } else { frac.parse().unwrap() };
    frac_scaled *= 10i128.pow(DECIMAL_PLACES - frac.len() as u32);
    let v = int * SCALE + frac_scaled;
    Ok(if neg { -v } else { v })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToleranceKind {
    Abs,
    Rel,
}

/// `|measured - reported| <= tol` (abs) or `<= tol * |reported|` (rel), computed exactly.
pub fn within_tolerance(measured: i128, reported: i128, kind: ToleranceKind, tol: i128) -> bool {
    let diff = measured.abs_diff(reported);
    let tol = tol.unsigned_abs();
    match kind {
        ToleranceKind::Abs => diff <= tol,
        // diff/S <= (tol/S) * (|r|/S)  <=>  diff * S <= tol * |r|
        ToleranceKind::Rel => {
            U256::from(diff) * U256::from(SCALE as u128) <= U256::from(tol) * U256::from(reported.unsigned_abs())
        }
    }
}

pub fn mul_div_floor(a: u128, b: u128, d: u128) -> u128 {
    to_u128(U256::from(a) * U256::from(b) / U256::from(d))
}

pub fn mul_div_ceil(a: u128, b: u128, d: u128) -> u128 {
    let p = U256::from(a) * U256::from(b);
    let d = U256::from(d);
    to_u128((p + d - U256::one()) / d)
}

pub fn to_u128(v: U256) -> u128 {
    assert!(v <= U256::from(u128::MAX), "u128 overflow");
    v.low_u128()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_decimals() {
        assert_eq!(parse_decimal("0.912").unwrap(), 912_000_000_000_000_000);
        assert_eq!(parse_decimal("-1.5").unwrap(), -1_500_000_000_000_000_000);
        assert_eq!(parse_decimal("3").unwrap(), 3 * SCALE);
        assert_eq!(parse_decimal("0.000000000000000001").unwrap(), 1);
        for bad in ["", "-", ".5", "5.", "1e3", "+1", " 1", "1.0000000000000000001", "0x10", "1,5", "--1"] {
            assert!(parse_decimal(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn absolute_tolerance_is_inclusive() {
        let r = parse_decimal("0.912").unwrap();
        let t = parse_decimal("0.01").unwrap();
        assert!(within_tolerance(parse_decimal("0.922").unwrap(), r, ToleranceKind::Abs, t));
        assert!(within_tolerance(parse_decimal("0.902").unwrap(), r, ToleranceKind::Abs, t));
        assert!(!within_tolerance(parse_decimal("0.9221").unwrap(), r, ToleranceKind::Abs, t));
    }

    #[test]
    fn relative_tolerance_scales_with_reported_value() {
        let r = parse_decimal("-200").unwrap();
        let t = parse_decimal("0.05").unwrap(); // 5% of 200 = 10
        assert!(within_tolerance(parse_decimal("-210").unwrap(), r, ToleranceKind::Rel, t));
        assert!(!within_tolerance(parse_decimal("-210.000000000000000001").unwrap(), r, ToleranceKind::Rel, t));
        // Large magnitudes do not overflow.
        let big = parse_decimal("99999999999999999999.999999999999999999").unwrap();
        assert!(within_tolerance(big, big, ToleranceKind::Rel, t));
    }
}
