/** Contract view types, plus the display and quote maths the UI needs. */

import { parseDecimal } from "@rerun/shared/browser";

export type Mode = "money" | "points";
export type State = "Draft" | "Open" | "Locked" | "Running" | "Proposed" | "Challenged" | "Final";
export type Outcome = "REPRODUCED" | "NOT_REPRODUCED" | "BROKEN" | "INVALID";
export type Side = "YES" | "NO";

export interface Market {
  id: number;
  creator: string;
  mode: Mode;
  state: State;
  spec: {
    spec_hash: string;
    title: string;
    commit: string;
    data_hashes: string[];
    reported_value: string;
    tolerance_kind: string;
    tolerance_value: string;
    max_minutes: number;
    private_data: boolean;
  };
  created_at: number;
  lock_time: number;
  challenge_window: number;
  yes_pool: string;
  no_pool: string;
  lp_supply: string;
  collateral: string;
  lp_fees: string;
  creation_bond: string;
  repro_fee: string;
  volume: string;
  trades: number;
  run_deadline: number | null;
  challenge_deadline: number | null;
  outcome: Outcome | null;
  invalid_reason: string | null;
  challenge: { challenger: string; bond: string; reason: string; note_hash: string; at: number } | null;
  finalized_at: number | null;
  yes_price_ppm: number;
}

export interface Position {
  yes: string;
  no: string;
  lp: string;
  fee_debt: string;
  spent: string;
  received: string;
  pending_lp_fees: string;
}

export interface Receipt {
  market_id: number;
  spec_hash: string;
  outcome: Outcome;
  invalid_reason: string | null;
  measured_value: string | null;
  reported_value: string;
  tolerance: string;
  commit: string;
  data_hashes: string[];
  env_lock_hash: string;
  patches: { file: string; kind: "ENV" | "PATH" | "DEPENDENCY"; diff_hash: string }[];
  patches_diff_excerpt: string;
  log_hash: string;
  log_tail: string;
  full_log_uri: string;
  report_hash: string;
  report_uri: string;
  runtime_secs: number;
  exit_code: number;
  lab_codehash: string;
  lab_account: string;
  nearai: { model_id: string; attestation_digest: string; response_signature_refs: string[] };
  run_index: number;
  started_at: number;
  finished_at: number;
}

export interface Stats {
  markets: number;
  reproduced: number;
  not_reproduced: number;
  broken: number;
  invalid: number;
  volume_money: string;
  volume_points: string;
  reproduction_rate_bps: number | null;
}

export interface Config {
  owner: string;
  collateral_token: string;
  fee_bps: number;
  treasury_fee_share_bps: number;
  run_timeout_secs: number;
  min_challenge_window: number;
  max_challenge_window: number;
  points_claim_amount: string;
  money: ModeParams;
  points: ModeParams;
  paused: boolean;
}

export interface ModeParams {
  creation_bond: string;
  repro_fee: string;
  min_liquidity: string;
  challenge_bond_min: string;
  challenge_bond_bps: number;
}

export interface Lab {
  codehash: string;
  enc_pubkey: string;
  registered_at: number;
  local: boolean;
}

const UNIT = 1_000_000n;

/** "12.34" from smallest units, without floating point. */
export function fmtUnits(units: string | bigint, digits = 2): string {
  const v = typeof units === "bigint" ? units : BigInt(units);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const scale = 10n ** BigInt(6 - digits);
  const rounded = (abs + scale / 2n) / scale;
  const whole = rounded / 10n ** BigInt(digits);
  const frac = digits ? `.${(rounded % 10n ** BigInt(digits)).toString().padStart(digits, "0")}` : "";
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac}`;
}

/** Smallest units from what someone typed. Null if it is not a positive amount with at most 6 decimals. */
export function parseUnits(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  const v = BigInt(whole) * UNIT + BigInt(frac.padEnd(6, "0"));
  return v > 0n ? v : null;
}

export const modeUnit = (mode: Mode) => (mode === "money" ? "tUSDC" : "points");

export const yesPercent = (m: Pick<Market, "yes_price_ppm">) => m.yes_price_ppm / 10_000;

export function toleranceText(kind: string, value: string): string {
  if (kind === "rel") return `± ${trimZeros((Number(value) * 100).toFixed(4))}%`;
  return `± ${value}`;
}

const trimZeros = (s: string) => s.replace(/\.?0+$/, "");

const SCALE = 10n ** 18n;
const fmtDecimal = (v: bigint): string => {
  const abs = v < 0n ? -v : v;
  const frac = (abs % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return `${v < 0n ? "-" : ""}${abs / SCALE}${frac ? `.${frac}` : ""}`;
};

/** The range a re-run must land in, such as "0.91 to 0.95". */
export function rangeText(reported: string, kind: string, value: string): string {
  const r = parseDecimal(reported);
  const t = parseDecimal(value);
  const margin = kind === "rel" ? ((r < 0n ? -r : r) * t) / SCALE : t;
  return `${fmtDecimal(r - margin)} to ${fmtDecimal(r + margin)}`;
}

const OUTCOME_MEANING: Record<Outcome, string> = {
  REPRODUCED: "The Lab re-ran the authors' code and data and got a number inside the claim's range. YES wins.",
  NOT_REPRODUCED: "The code ran, but the number came out outside the claim's range. NO wins.",
  BROKEN: "The code wouldn't run, even after the AI tried to fix setup problems. NO wins.",
  INVALID: "The test couldn't be run fairly, for example because the data changed. Every share pays back half.",
};
export const outcomeMeaning = (o: Outcome) => OUTCOME_MEANING[o];

const OUTCOME_LABEL: Record<Outcome, string> = {
  REPRODUCED: "Reproduced",
  NOT_REPRODUCED: "Not reproduced",
  BROKEN: "Broken",
  INVALID: "Invalid",
};
export const outcomeLabel = (o: Outcome) => OUTCOME_LABEL[o];

const STATE_LABEL: Record<State, string> = {
  Draft: "Not open yet",
  Open: "Open for forecasts",
  Locked: "Forecasting has ended, waiting for the Lab",
  Running: "The Lab is re-running this",
  Proposed: "Result posted, can still be challenged",
  Challenged: "Challenged, the Lab is checking again",
  Final: "Settled",
};
export const stateLabel = (s: State) => STATE_LABEL[s];

/** "in 6 days", "3 hours ago". */
export function relativeTime(unixSecs: number, nowMs = Date.now()): string {
  const diff = unixSecs - Math.floor(nowMs / 1000);
  const abs = Math.abs(diff);
  const [n, unit] =
    abs < 90 ? [abs, "second"] : abs < 5400 ? [Math.round(abs / 60), "minute"] : abs < 129600 ? [Math.round(abs / 3600), "hour"] : [Math.round(abs / 86400), "day"];
  const text = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

export const shortHash = (h: string, n = 10) => (h.length > n ? `${h.slice(0, n)}…` : h);

// Quotes mirror contracts/rerun/src/fpmm.rs. They only preview; the contract decides the fill.

function pools(m: Pick<Market, "yes_pool" | "no_pool">, side: Side): [bigint, bigint] {
  const yes = BigInt(m.yes_pool);
  const no = BigInt(m.no_pool);
  return side === "YES" ? [yes, no] : [no, yes];
}

export interface Quote {
  /** Shares received when buying, net collateral received when selling. */
  out: bigint;
  yesPriceAfterPpm: number;
}

const priceAfter = (side: Side, thisPool: bigint, other: bigint): number => {
  const [yes, no] = side === "YES" ? [thisPool, other] : [other, thisPool];
  return yes + no === 0n ? 500_000 : Number((no * 1_000_000n) / (yes + no));
};

export function quoteBuy(m: Market, side: Side, amount: bigint, feeBps: number): Quote | null {
  const [thisPool, other] = pools(m, side);
  if (thisPool === 0n || other === 0n || amount <= 0n) return null;
  const x = amount - (amount * BigInt(feeBps)) / 10_000n;
  const otherAfter = other + x;
  const thisAfter = (thisPool * other + otherAfter - 1n) / otherAfter;
  return { out: thisPool + x - thisAfter, yesPriceAfterPpm: priceAfter(side, thisAfter, otherAfter) };
}

function isqrtCeil(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x * x === n ? x : x + 1n;
}

export function quoteSell(m: Market, side: Side, shares: bigint, feeBps: number): Quote | null {
  const [thisPool, other] = pools(m, side);
  if (thisPool === 0n || other === 0n || shares <= 0n) return null;
  const a = thisPool + shares + other;
  const root = isqrtCeil(a * a - 4n * shares * other);
  const gross = (a - root) / 2n;
  return { out: gross - (gross * BigInt(feeBps)) / 10_000n, yesPriceAfterPpm: priceAfter(side, thisPool + shares - gross, other - gross) };
}
