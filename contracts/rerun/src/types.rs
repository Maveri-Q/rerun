use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

use crate::spec::SpecSummary;

/// Money markets use the NEP-141 collateral token; points markets use free, non-transferable points.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Money,
    Points,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Draft,
    Open,
    Locked,
    Running,
    Proposed,
    Challenged,
    Final,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Outcome {
    Reproduced,
    NotReproduced,
    Broken,
    Invalid,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InvalidReason {
    SpecAmbiguous,
    DataUnavailable,
    HashMismatch,
    ExtractionFailed,
    RunsDisagree,
    Stale,
    /// The Lab couldn't get the software running within its limits. That says nothing about the
    /// research, so nobody wins: shares redeem at half, and the creator keeps the bond.
    EnvSetupFailed,
    /// An independent rebuild got a different number. That could be the rebuild and not the paper,
    /// so it doesn't count against the paper: nobody wins, and shares redeem at half.
    RebuildMismatch,
}

impl InvalidReason {
    /// INVALID because the creator's spec was bad: the creation bond is forfeited.
    pub fn is_spec_fault(self) -> bool {
        matches!(self, Self::SpecAmbiguous | Self::DataUnavailable | Self::HashMismatch | Self::ExtractionFailed)
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChallengeReason {
    WrongExtraction,
    SciencePatched,
    Nondeterministic,
    SpecAmbiguous,
    Other,
}

/// Only environment-level patches exist. There is deliberately no SCIENCE kind.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PatchKind {
    Env,
    Path,
    Dependency,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Patch {
    pub file: String,
    pub kind: PatchKind,
    pub diff_hash: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct NearAiInfo {
    pub model_id: String,
    pub attestation_digest: String,
    pub response_signature_refs: Vec<String>,
}

/// Reproduction Receipt, posted by a registered Lab.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Receipt {
    pub market_id: u64,
    pub spec_hash: String,
    pub outcome: Outcome,
    pub invalid_reason: Option<InvalidReason>,
    /// Decimal string; required for REPRODUCED / NOT_REPRODUCED.
    pub measured_value: Option<String>,
    pub reported_value: String,
    /// "abs:<decimal>" or "rel:<decimal>", copied from the spec.
    pub tolerance: String,
    pub commit: String,
    pub data_hashes: Vec<String>,
    pub env_lock_hash: String,
    pub patches: Vec<Patch>,
    pub patches_diff_excerpt: String,
    pub log_hash: String,
    pub log_tail: String,
    pub full_log_uri: String,
    /// sha256 + location of the AI-written human-readable report (off-chain).
    pub report_hash: String,
    pub report_uri: String,
    pub runtime_secs: u32,
    pub exit_code: i32,
    pub lab_codehash: String,
    pub lab_account: AccountId,
    pub nearai: NearAiInfo,
    pub run_index: u8,
    pub started_at: u64,
    pub finished_at: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Challenge {
    pub challenger: AccountId,
    pub bond: U128,
    pub reason: ChallengeReason,
    pub note_hash: String,
    pub at: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Market {
    pub id: u64,
    pub creator: AccountId,
    pub mode: Mode,
    pub state: State,
    pub spec: SpecSummary,
    /// Unix seconds.
    pub created_at: u64,
    pub lock_time: u64,
    pub challenge_window: u64,
    pub yes_pool: U128,
    pub no_pool: U128,
    pub lp_supply: U128,
    /// Collateral backing outstanding outcome-share sets (1 YES + 1 NO each).
    pub collateral: U128,
    /// Collateral held for LP fees not yet claimed.
    pub lp_fees: U128,
    /// Cumulative LP fee per LP share, scaled by `ACC_SCALE`.
    pub lp_fee_per_share: U128,
    pub creation_bond: U128,
    pub repro_fee: U128,
    pub volume: U128,
    pub trades: u32,
    pub run_deadline: Option<u64>,
    pub challenge_deadline: Option<u64>,
    pub outcome: Option<Outcome>,
    pub invalid_reason: Option<InvalidReason>,
    pub challenge: Option<Challenge>,
    pub finalized_at: Option<u64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Position {
    pub yes: U128,
    pub no: U128,
    pub lp: U128,
    /// lp * lp_fee_per_share at the last settlement.
    pub fee_debt: U128,
    /// Collateral put in (buys, liquidity) and taken out (sells, fees, redemptions), for P&L.
    pub spent: U128,
    pub received: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Lab {
    pub codehash: String,
    /// X25519 public key (hex) private-data owners encrypt to; bound to the attestation in TEE mode.
    pub enc_pubkey: String,
    pub registered_at: u64,
    /// Registered by the owner without TEE attestation (testnet builds only).
    pub local: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct ModeParams {
    pub creation_bond: U128,
    pub repro_fee: U128,
    pub min_liquidity: U128,
    pub challenge_bond_min: U128,
    /// Challenge bond as basis points of the market's collateral (the larger of the two applies).
    pub challenge_bond_bps: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner: AccountId,
    pub pending_owner: Option<AccountId>,
    pub collateral_token: AccountId,
    pub treasury: AccountId,
    /// Receives the reproduction fee when a Lab proposes a result.
    pub lab_fee_recipient: AccountId,
    /// Total trading fee in basis points (default 100 = 1%).
    pub fee_bps: u32,
    /// Share of the trading fee that goes to the treasury, in basis points of the fee (default 2000 = 20%).
    pub treasury_fee_share_bps: u32,
    /// Share of the creation bond paid to a challenger whose challenge proves the runs disagree.
    pub challenger_reward_bps: u32,
    pub run_timeout_secs: u64,
    pub min_challenge_window: u64,
    pub max_challenge_window: u64,
    pub points_claim_amount: U128,
    pub money: ModeParams,
    pub points: ModeParams,
    pub paused: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub markets: u64,
    pub reproduced: u64,
    pub not_reproduced: u64,
    pub broken: u64,
    pub invalid: u64,
    pub volume_money: U128,
    pub volume_points: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PricePoint {
    pub t: u64,
    /// YES price in parts per million.
    pub yes_ppm: u32,
}
